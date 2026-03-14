import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DiffScope, DiffSnapshotView, DiffStats } from "../../shared/models";
import { appPaths } from "./app-paths";
import { AppDb } from "./db";
import { GitService } from "./git-service";

export type CheckpointKind =
	| "baseline"
	| "pre_turn"
	| "post_turn"
	| "review_start"
	| "alignment"
	| "revision"
	| "manual";

type CheckpointRow = {
	id: string;
	session_id: string;
	kind: CheckpointKind;
	turn_id: string | null;
	git_head: string | null;
	git_tree: string | null;
	manifest_path: string | null;
	patch_path: string | null;
	stats_json: string;
	created_at: number;
	parent_checkpoint_id: string | null;
};

type DiffSnapshotRow = {
	id: string;
	session_id: string;
	scope: DiffScope;
	from_checkpoint_id: string | null;
	to_checkpoint_id: string | null;
	from_ref: string | null;
	to_ref: string | null;
	patch_path: string;
	stats_json: string;
	created_at: number;
};

export interface CheckpointRecord {
	id: string;
	sessionId: string;
	kind: CheckpointKind;
	turnId?: string;
	gitHead?: string;
	gitTree?: string;
	manifestPath?: string;
	patchPath?: string;
	stats: Record<string, unknown>;
	createdAt: number;
	parentCheckpointId?: string;
}

export function toCheckpointSummaryView(
	checkpoint: Pick<
		CheckpointRecord,
		"id" | "sessionId" | "kind" | "createdAt" | "gitHead" | "gitTree" | "parentCheckpointId"
	>,
) {
	return {
		id: checkpoint.id,
		sessionId: checkpoint.sessionId,
		kind: checkpoint.kind,
		createdAt: checkpoint.createdAt,
		gitHead: checkpoint.gitHead,
		gitTree: checkpoint.gitTree,
		parentCheckpointId: checkpoint.parentCheckpointId,
	};
}

export class CheckpointService {
	private transientDiffCache = new Map<string, DiffSnapshotView>();

	constructor(
		private readonly db: AppDb,
		private readonly git: GitService,
	) {}

	private rememberTransientDiff(snapshot: DiffSnapshotView) {
		if (this.transientDiffCache.has(snapshot.cacheKey)) {
			this.transientDiffCache.delete(snapshot.cacheKey);
		}
		this.transientDiffCache.set(snapshot.cacheKey, snapshot);
		while (this.transientDiffCache.size > 64) {
			const oldestKey = this.transientDiffCache.keys().next().value;
			if (!oldestKey) break;
			this.transientDiffCache.delete(oldestKey);
		}
		return snapshot;
	}

	private buildDiffCacheKey(parts: Array<string | number | undefined>) {
		return `live:${createHash("sha1")
			.update(parts.map((part) => String(part ?? "")).join("\u0001"))
			.digest("hex")}`;
	}

	private toCheckpoint(record: CheckpointRow): CheckpointRecord {
		return {
			id: record.id,
			sessionId: record.session_id,
			kind: record.kind,
			turnId: record.turn_id ?? undefined,
			gitHead: record.git_head ?? undefined,
			gitTree: record.git_tree ?? undefined,
			manifestPath: record.manifest_path ?? undefined,
			patchPath: record.patch_path ?? undefined,
			stats: JSON.parse(record.stats_json || "{}") as Record<string, unknown>,
			createdAt: record.created_at,
			parentCheckpointId: record.parent_checkpoint_id ?? undefined,
		};
	}

	async createCheckpoint(params: {
		sessionId: string;
		cwd: string;
		kind: CheckpointKind;
		turnId?: string;
		parentCheckpointId?: string;
	}) {
		const capture = await this.git.captureWorkingTree(params.cwd);
		const recordId = crypto.randomUUID();
		this.db.run(
			`
			insert into checkpoints (
				id, session_id, kind, turn_id, git_head, git_tree, stats_json, created_at, parent_checkpoint_id
			) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
			`,
			recordId,
			params.sessionId,
			params.kind,
			params.turnId ?? null,
			capture.head ?? null,
			capture.tree,
			JSON.stringify({}),
			Date.now(),
			params.parentCheckpointId ?? null,
		);
		return this.getCheckpoint(recordId);
	}

	getCheckpoint(checkpointId: string) {
		const row = this.db.get<CheckpointRow>(
			"select * from checkpoints where id = ?",
			checkpointId,
		);
		return row ? this.toCheckpoint(row) : null;
	}

	getLatestCheckpoint(sessionId: string, kind: CheckpointKind) {
		const row = this.db.get<CheckpointRow>(
			`
			select * from checkpoints
			where session_id = ? and kind = ?
			order by created_at desc
			limit 1
			`,
			sessionId,
			kind,
		);
		return row ? this.toCheckpoint(row) : null;
	}

	listCheckpoints(sessionId: string, limit?: number) {
		const rows =
			typeof limit === "number"
				? this.db.all<CheckpointRow>(
						`
						select *
						from checkpoints
						where session_id = ?
						order by created_at desc
						limit ?
						`,
						sessionId,
						limit,
					)
				: this.db.all<CheckpointRow>(
						`
						select *
						from checkpoints
						where session_id = ?
						order by created_at desc
						`,
						sessionId,
					);
		return rows.map((row) => this.toCheckpoint(row));
	}

	getLatestTurnPair(sessionId: string) {
		return this.db.get<{
			checkpoint_before_id: string | null;
			checkpoint_after_id: string | null;
		}>(
			`
			select checkpoint_before_id, checkpoint_after_id
			from turns
			where session_id = ? and checkpoint_before_id is not null and checkpoint_after_id is not null
			order by turn_index desc
			limit 1
			`,
			sessionId,
		);
	}

	storeDiffSnapshot(params: {
		sessionId: string;
		scope: DiffScope;
		fromCheckpointId?: string;
		toCheckpointId?: string;
		fromRef?: string;
		toRef?: string;
		title: string;
		description: string;
		fromLabel: string;
		toLabel: string;
		patch: string;
		stats: DiffStats;
	}) {
		const id = crypto.randomUUID();
		const patchPath = join(appPaths.diffsDir, `${id}.patch`);
		writeFileSync(patchPath, params.patch);
		const createdAt = Date.now();
		this.db.run(
			`
			insert into diff_snapshots (
				id, session_id, scope, from_checkpoint_id, to_checkpoint_id, from_ref, to_ref, patch_path, stats_json, created_at
			) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`,
			id,
			params.sessionId,
			params.scope,
			params.fromCheckpointId ?? null,
			params.toCheckpointId ?? null,
			params.fromRef ?? null,
			params.toRef ?? null,
			patchPath,
			JSON.stringify({
				title: params.title,
				description: params.description,
				fromLabel: params.fromLabel,
				toLabel: params.toLabel,
				stats: params.stats,
			}),
			createdAt,
		);
		return {
			id,
			cacheKey: id,
			sessionId: params.sessionId,
			scope: params.scope,
			title: params.title,
			description: params.description,
			fromLabel: params.fromLabel,
			toLabel: params.toLabel,
			fromCheckpointId: params.fromCheckpointId,
			toCheckpointId: params.toCheckpointId,
			patch: params.patch,
			stats: params.stats,
			files: params.stats.fileStats,
			createdAt,
		} satisfies DiffSnapshotView;
	}

	buildTransientDiffSnapshot(params: {
		sessionId: string;
		scope: DiffScope;
		title: string;
		description: string;
		fromLabel: string;
		toLabel: string;
		patch: string;
		stats: DiffStats;
		cacheParts: Array<string | number | undefined>;
		fromCheckpointId?: string;
		toCheckpointId?: string;
		revisionNumber?: number;
		diffMode?: DiffSnapshotView["diffMode"];
	}) {
		const cacheKey = this.buildDiffCacheKey(params.cacheParts);
		const cached = this.transientDiffCache.get(cacheKey);
		if (cached) {
			return this.rememberTransientDiff(cached);
		}
		return this.rememberTransientDiff({
			id: cacheKey,
			cacheKey,
			sessionId: params.sessionId,
			scope: params.scope,
			title: params.title,
			description: params.description,
			fromLabel: params.fromLabel,
			toLabel: params.toLabel,
			fromCheckpointId: params.fromCheckpointId,
			toCheckpointId: params.toCheckpointId,
			patch: params.patch,
			stats: params.stats,
			files: params.stats.fileStats,
			createdAt: Date.now(),
			revisionNumber: params.revisionNumber,
			diffMode: params.diffMode,
		} satisfies DiffSnapshotView);
	}

	getDiffSnapshot(id: string): DiffSnapshotView | null {
		const row = this.db.get<DiffSnapshotRow>(
			"select * from diff_snapshots where id = ?",
			id,
		);
		if (!row) return null;
		const payload = JSON.parse(row.stats_json) as {
			title: string;
			description: string;
			fromLabel: string;
			toLabel: string;
			stats: DiffStats;
		};
		return {
			id: row.id,
			cacheKey: row.id,
			sessionId: row.session_id,
			scope: row.scope,
			title: payload.title,
			description: payload.description,
			fromLabel: payload.fromLabel,
			toLabel: payload.toLabel,
			fromCheckpointId: row.from_checkpoint_id ?? undefined,
			toCheckpointId: row.to_checkpoint_id ?? undefined,
			patch: readFileSync(row.patch_path, "utf8"),
			stats: payload.stats,
			files: payload.stats.fileStats,
			createdAt: row.created_at,
		};
	}
}
