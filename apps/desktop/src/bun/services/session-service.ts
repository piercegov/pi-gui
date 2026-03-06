import { Utils } from "electrobun/bun";
import type {
	AppSettings,
	CheckpointSummaryView,
	DiffScope,
	DiffScopeSummary,
	DiffSnapshotView,
	GitStatusView,
	SessionHydration,
	SessionInspectorView,
	SessionSummary,
} from "../../shared/models";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import { CheckpointService, type CheckpointRecord } from "./checkpoint-service";
import { AppDb } from "./db";
import { GitService } from "./git-service";
import type { HostMessenger } from "./host-messenger";
import { ProjectService } from "./project-service";
import { ReviewService } from "./review-service";
import { SettingsService } from "./settings-service";
import { PiRuntimeManager } from "../pi/runtime-manager";

type SessionRow = {
	id: string;
	project_id: string;
	pi_session_id: string;
	pi_session_file: string | null;
	display_name: string | null;
	cwd_path: string;
	mode: "worktree" | "local";
	worktree_path: string | null;
	worktree_branch: string | null;
	base_ref: string | null;
	status: SessionSummary["status"];
	review_state: SessionSummary["reviewState"];
	created_at: number;
	last_activity_at: number;
	archived_at: number | null;
	metadata_json: string;
	baseline_kind: string;
	baseline_value: string;
	unresolved_comment_count: number;
};

type TurnRow = {
	id: string;
	checkpoint_before_id: string | null;
	checkpoint_after_id: string | null;
};

export class SessionService {
	constructor(
		private readonly db: AppDb,
		private readonly projectService: ProjectService,
		private readonly git: GitService,
		private readonly checkpoints: CheckpointService,
		private readonly review: ReviewService,
		private readonly settings: SettingsService,
		private readonly runtime: PiRuntimeManager,
		private readonly messenger: HostMessenger,
	) {}

	private parseMetadata(json: string | null) {
		try {
			return JSON.parse(json || "{}") as Record<string, unknown>;
		} catch {
			return {};
		}
	}

	private getSessionRow(sessionId: string) {
		return this.db.get<SessionRow>(
			`
			select
				s.*,
				(
					select count(*)
					from comment_threads ct
					where ct.session_id = s.id
					  and ct.status in ('open', 'agent_replied', 'needs_user', 'aligned')
				) as unresolved_comment_count
			from sessions s
			where s.id = ?
			`,
			sessionId,
		);
	}

	private getProjectOrThrow(projectId: string) {
		const project = this.projectService.getProject(projectId);
		if (!project) throw new Error("Project not found.");
		return project;
	}

	private async toSummary(row: SessionRow): Promise<SessionSummary> {
		const metadata = this.parseMetadata(row.metadata_json);
		return {
			id: row.id,
			projectId: row.project_id,
			piSessionId: row.pi_session_id,
			piSessionFile: row.pi_session_file ?? undefined,
			displayName: row.display_name ?? "Untitled session",
			cwdPath: row.cwd_path,
			mode: row.mode,
			worktreePath: row.worktree_path ?? undefined,
			worktreeBranch: row.worktree_branch ?? undefined,
			baseRef: row.base_ref ?? undefined,
			status: row.status,
			reviewState: row.review_state,
			lastActivityAt: row.last_activity_at,
			createdAt: row.created_at,
			archivedAt: row.archived_at ?? undefined,
			unresolvedCommentCount: row.unresolved_comment_count,
			changedFilesCount: Number(metadata.changedFilesCount ?? 0),
			modelLabel:
				typeof metadata.modelLabel === "string"
					? metadata.modelLabel
					: undefined,
			lastError:
				typeof metadata.lastError === "string"
					? metadata.lastError
					: undefined,
			metadata,
		};
	}

	async getSessionSummary(sessionId: string) {
		const row = this.getSessionRow(sessionId);
		return row ? this.toSummary(row) : null;
	}

	async listSessions(projectId: string) {
		const rows = this.db.all<SessionRow>(
			`
			select
				s.*,
				(
					select count(*)
					from comment_threads ct
					where ct.session_id = s.id
					  and ct.status in ('open', 'agent_replied', 'needs_user', 'aligned')
				) as unresolved_comment_count
			from sessions s
			where s.project_id = ?
			  and (? = 1 or s.archived_at is null)
			order by coalesce(s.last_activity_at, 0) desc
			`,
			projectId,
			this.settings.getAppSettings().showArchived ? 1 : 0,
		);
		return Promise.all(rows.map((row) => this.toSummary(row)));
	}

	private async refreshAndPublishSession(sessionId: string) {
		const summary = await this.getSessionSummary(sessionId);
		if (!summary) return;
		this.messenger.sessionSummaryUpdated(summary);
	}

	async updateRuntimeStatus(
		sessionId: string,
		patch: {
			status?: string;
			modelLabel?: string;
			lastError?: string;
		},
	) {
		const row = this.getSessionRow(sessionId);
		if (!row) return;
		const metadata = this.parseMetadata(row.metadata_json);
		if (patch.modelLabel !== undefined) metadata.modelLabel = patch.modelLabel;
		if (patch.lastError !== undefined) metadata.lastError = patch.lastError;
		this.db.run(
			`
			update sessions
			set status = coalesce(?, status),
			    last_activity_at = ?,
			    metadata_json = ?
			where id = ?
			`,
			patch.status ?? null,
			Date.now(),
			JSON.stringify(metadata),
			sessionId,
		);
		await this.refreshAndPublishSession(sessionId);
	}

		async openProjectInEditor(projectId: string, settings: AppSettings) {
			const project = this.getProjectOrThrow(projectId);
			if (!settings.defaultEditor) {
				Utils.openPath(project.rootPath);
				return;
			}
		const proc = Bun.spawn([settings.defaultEditor, project.rootPath], {
			stdout: "ignore",
			stderr: "ignore",
		});
		void proc.exited;
	}

	revealProject(projectId: string) {
		const project = this.getProjectOrThrow(projectId);
		Utils.showItemInFolder(project.rootPath);
	}

	private async refreshGitStatus(sessionId: string) {
		const row = this.getSessionRow(sessionId);
		if (!row) return;
		const metadata = this.parseMetadata(row.metadata_json);
		const status = await this.git.getGitStatus(row.cwd_path);
		metadata.changedFilesCount = status.changedFiles;
		metadata.worktreeMissing = row.worktree_path
			? await this.git.revealMissingWorktree(row.worktree_path)
			: false;
		this.db.run(
			"update sessions set metadata_json = ?, last_activity_at = ? where id = ?",
			JSON.stringify(metadata),
			Date.now(),
			sessionId,
		);
		const payload: GitStatusView = {
			sessionId,
			changedFiles: status.changedFiles,
			stagedFiles: status.stagedFiles,
			unstagedFiles: status.unstagedFiles,
			hasMissingWorktree: Boolean(metadata.worktreeMissing),
		};
		this.messenger.gitStatusUpdated(payload);
		await this.refreshAndPublishSession(sessionId);
	}

	private async ensureRuntime(sessionId: string) {
		const row = this.getSessionRow(sessionId);
		if (!row) throw new Error("Session not found.");
		const project = this.getProjectOrThrow(row.project_id);
		if (row.mode === "worktree" && row.worktree_path && row.worktree_branch) {
			await this.git.ensureWorktree({
				repoRoot: project.rootPath,
				worktreePath: row.worktree_path,
				baseRef: row.base_ref ?? "HEAD",
				branchName: row.worktree_branch,
			});
		}
		await this.runtime.openSession({
			id: row.id,
			cwdPath: row.cwd_path,
			piSessionFile: row.pi_session_file ?? undefined,
			displayName: row.display_name ?? "Untitled session",
			project,
			baseRef: row.base_ref ?? undefined,
		});
		return row;
	}

	async createSession(params: {
		projectId: string;
		name?: string;
		mode?: "worktree" | "local";
		baseRef?: string;
	}) {
		const project = this.getProjectOrThrow(params.projectId);
		const settings = this.settings.getAppSettings();
		const sessionId = crypto.randomUUID();
		const now = Date.now();
		const mode =
			project.isGit && (params.mode ?? settings.defaultSessionMode) === "worktree"
				? "worktree"
				: "local";
		const baseRef =
			params.baseRef ??
			project.defaultBaseRef ??
			(project.isGit ? await this.git.getDefaultBaseRef(project.rootPath) : undefined);
		let cwdPath = project.rootPath;
		let worktreePath: string | undefined;
		let worktreeBranch: string | undefined;
		if (mode === "worktree" && project.isGit && baseRef) {
			worktreeBranch = this.git.buildSessionBranchName(project.name, sessionId);
			worktreePath = this.git.getManagedWorktreePath(
				project.id,
				sessionId,
				project.name,
			);
			await this.git.createWorktree({
				repoRoot: project.rootPath,
				worktreePath,
				baseRef,
				branchName: worktreeBranch,
			});
			cwdPath = worktreePath;
		}
		const session = await this.runtime.createSession({
			id: sessionId,
			cwdPath,
			displayName: params.name ?? `${project.name} session`,
			project,
			baseRef,
		});
		if (params.name) {
			session.setSessionName(params.name);
		}
		this.db.run(
			`
			insert into sessions (
				id, project_id, pi_session_id, pi_session_file, display_name, cwd_path, mode,
				worktree_path, worktree_branch, base_ref, baseline_kind, baseline_value,
				status, review_state, created_at, last_activity_at, metadata_json
			) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', 'none', ?, ?, ?)
			`,
			sessionId,
			project.id,
			session.sessionId,
			session.sessionFile ?? null,
			params.name ?? session.sessionName ?? `${project.name} session`,
			cwdPath,
			mode,
			worktreePath ?? null,
			worktreeBranch ?? null,
			baseRef ?? null,
			"snapshot",
			"local",
			now,
			now,
			JSON.stringify({
				changedFilesCount: 0,
				modelLabel: session.model
					? `${session.model.provider}/${session.model.id}`
					: null,
			}),
		);
		if (project.isGit) {
			const baseline = await this.checkpoints.createCheckpoint({
				sessionId,
				cwd: cwdPath,
				kind: "baseline",
			});
			if (baseline?.gitTree) {
				this.db.run(
					`
					update sessions
					set baseline_kind = ?, baseline_value = ?
					where id = ?
					`,
					"git_tree",
					baseline.gitTree,
					sessionId,
				);
			}
		}
		this.projectService.markOpened(project.id);
		await this.refreshGitStatus(sessionId);
		return (await this.getSessionSummary(sessionId))!;
	}

	async openSession(sessionId: string): Promise<SessionHydration> {
		const row = await this.ensureRuntime(sessionId);
		const project = this.getProjectOrThrow(row.project_id);
		await this.refreshGitStatus(sessionId);
		if (row.review_state === "pending") {
			this.review.ensureDraftRound(sessionId);
		}
		const session = (await this.getSessionSummary(sessionId))!;
		const diffScopes = await this.listDiffScopes(sessionId);
		const initialDiffScope =
			diffScopes.find((scope) => scope.available && scope.scope === "session_changes")
				?.scope ??
			diffScopes.find((scope) => scope.available)?.scope;
		const currentDiff = initialDiffScope
			? await this.buildDiff(sessionId, initialDiffScope)
			: undefined;
		const checkpointRecords = this.checkpoints.listCheckpoints(sessionId);
		const checkpointViews: CheckpointSummaryView[] = checkpointRecords.map((cp) => ({
			id: cp.id,
			sessionId: cp.sessionId,
			kind: cp.kind,
			createdAt: cp.createdAt,
			gitHead: cp.gitHead,
			gitTree: cp.gitTree,
			parentCheckpointId: cp.parentCheckpointId,
		}));
		return {
			project,
			session,
			conversation: this.runtime.getConversation(sessionId),
			toolActivity: this.runtime.getToolActivity(sessionId),
			checkpoints: checkpointViews,
			reviewRounds: this.review.listReviewRounds(sessionId),
			activeReviewRoundId: this.review.getActiveReviewRoundId(sessionId),
			diffScopes,
			currentDiff: currentDiff ?? undefined,
			appSettings: this.settings.getAppSettings(),
			supportsEmbeddedTerminal: process.platform !== "win32",
			piConfig: this.runtime.getPiConfigSummary(sessionId),
		};
	}

	async getSessionInspector(sessionId: string): Promise<SessionInspectorView> {
		const row = await this.ensureRuntime(sessionId);
		await this.refreshGitStatus(sessionId);
		const summary = await this.getSessionSummary(sessionId);
		if (!summary) throw new Error("Session not found.");
		const checkpoints: CheckpointSummaryView[] = this.checkpoints
			.listCheckpoints(sessionId)
			.map((checkpoint) => ({
				id: checkpoint.id,
				sessionId: checkpoint.sessionId,
				kind: checkpoint.kind,
				createdAt: checkpoint.createdAt,
				gitHead: checkpoint.gitHead,
				gitTree: checkpoint.gitTree,
				parentCheckpointId: checkpoint.parentCheckpointId,
			}));
		return {
			sessionId,
			sessionFile: row.pi_session_file ?? undefined,
			parentSessionPath: this.runtime.getParentSessionPath(sessionId),
			worktreeMissing: Boolean(summary.metadata.worktreeMissing),
			checkpoints,
			tree: this.runtime.getSessionTree(sessionId),
		};
	}

	async renameSession(sessionId: string, name: string) {
		this.db.run(
			"update sessions set display_name = ?, last_activity_at = ? where id = ?",
			name,
			Date.now(),
			sessionId,
		);
		await this.runtime.renameSession(sessionId, name);
		await this.refreshAndPublishSession(sessionId);
	}

	async archiveSession(sessionId: string, archived: boolean) {
		this.db.run(
			"update sessions set archived_at = ?, status = ?, last_activity_at = ? where id = ?",
			archived ? Date.now() : null,
			archived ? "archived" : "idle",
			Date.now(),
			sessionId,
		);
		await this.refreshAndPublishSession(sessionId);
	}

	async repairSessionWorktree(sessionId: string) {
		const row = this.getSessionRow(sessionId);
		if (!row) throw new Error("Session not found.");
		if (row.mode !== "worktree" || !row.worktree_path || !row.worktree_branch) {
			return;
		}
		const project = this.getProjectOrThrow(row.project_id);
		await this.git.ensureWorktree({
			repoRoot: project.rootPath,
			worktreePath: row.worktree_path,
			baseRef: row.base_ref ?? "HEAD",
			branchName: row.worktree_branch,
		});
		await this.refreshGitStatus(sessionId);
		this.messenger.toast({
			id: crypto.randomUUID(),
			title: "Worktree repaired",
			description: row.worktree_path,
			variant: "success",
		});
	}

	async abortSession(sessionId: string) {
		await this.runtime.abortSession(sessionId);
		await this.updateRuntimeStatus(sessionId, { status: "idle" });
	}

	async sendPrompt(sessionId: string, text: string) {
		await this.ensureRuntime(sessionId);
		await this.runtime.sendPrompt(sessionId, text);
	}

	async steerSession(sessionId: string, text: string) {
		await this.ensureRuntime(sessionId);
		await this.runtime.steerSession(sessionId, text);
	}

	async followUpSession(sessionId: string, text: string) {
		await this.ensureRuntime(sessionId);
		await this.runtime.followUpSession(sessionId, text);
	}

	async restoreCheckpoint(sessionId: string, checkpointId: string) {
		const row = this.getSessionRow(sessionId);
		if (!row) throw new Error("Session not found.");
		if (row.status === "running" || row.status === "applying") {
			throw new Error("Cannot restore while the session is running.");
		}
		const checkpoint = this.checkpoints.getCheckpoint(checkpointId);
		if (!checkpoint) throw new Error("Checkpoint not found.");
		if (!checkpoint.gitTree) throw new Error("Checkpoint has no git tree to restore.");
		await this.git.restoreToTree(row.cwd_path, checkpoint.gitTree);
		const restored = await this.checkpoints.createCheckpoint({
			sessionId,
			cwd: row.cwd_path,
			kind: "manual",
			parentCheckpointId: checkpointId,
		});
		await this.refreshGitStatus(sessionId);
		this.messenger.diffInvalidated({ sessionId, scope: "session_changes" });
		this.messenger.toast({
			id: crypto.randomUUID(),
			title: "Checkpoint restored",
			description: `Restored to ${checkpoint.kind} checkpoint from ${new Date(checkpoint.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`,
			variant: "success",
		});
		await this.refreshAndPublishSession(sessionId);
		return restored;
	}

	async createManualCheckpoint(sessionId: string) {
		const row = this.getSessionRow(sessionId);
		if (!row) throw new Error("Session not found.");
		if (!(await this.git.isGitRepo(row.cwd_path))) {
			throw new Error("Manual checkpoints are currently only supported for Git-backed sessions.");
		}
		const parent = this.checkpoints.listCheckpoints(sessionId, 1)[0];
		const checkpoint = await this.checkpoints.createCheckpoint({
			sessionId,
			cwd: row.cwd_path,
			kind: "manual",
			parentCheckpointId: parent?.id,
		});
		if (!checkpoint) throw new Error("Failed to create manual checkpoint.");
		this.messenger.toast({
			id: crypto.randomUUID(),
			title: "Manual checkpoint saved",
			description: new Date(checkpoint.createdAt).toLocaleTimeString([], {
				hour: "numeric",
				minute: "2-digit",
			}),
			variant: "success",
		});
		return {
			id: checkpoint.id,
			sessionId: checkpoint.sessionId,
			kind: checkpoint.kind,
			createdAt: checkpoint.createdAt,
			gitHead: checkpoint.gitHead,
			gitTree: checkpoint.gitTree,
			parentCheckpointId: checkpoint.parentCheckpointId,
		} satisfies CheckpointSummaryView;
	}

	private async resolveCheckpointPair(
		sessionId: string,
		scope: DiffScope,
		row: SessionRow,
	): Promise<{
		title: string;
		description: string;
		fromLabel: string;
		toLabel: string;
		diff:
			| {
					patch: string;
					stats: DiffSnapshotView["stats"];
					files: DiffSnapshotView["files"];
					fromCheckpointId?: string;
					toCheckpointId?: string;
					fromRef?: string;
					toRef?: string;
				}
			| undefined;
	}> {
		if (scope === "staged") {
			const diff = await this.git.stagedDiff(row.cwd_path);
			return {
				title: "Staged",
				description: "Git staged changes",
				fromLabel: "Index",
				toLabel: "Staged",
				diff: {
					patch: diff.patch,
					stats: diff.stats,
					files: diff.files,
				},
			};
		}
		if (scope === "unstaged") {
			const diff = await this.git.unstagedDiff(row.cwd_path);
			return {
				title: "Unstaged",
				description: "Git unstaged changes",
				fromLabel: "Index",
				toLabel: "Working tree",
				diff: {
					patch: diff.patch,
					stats: diff.stats,
					files: diff.files,
				},
			};
		}
		if (scope === "branch_vs_base" && row.base_ref) {
			const diff = await this.git.diffAgainstWorkingTree(row.cwd_path, row.base_ref);
			return {
				title: "Branch vs base",
				description: "Current working state against the selected base ref",
				fromLabel: row.base_ref,
				toLabel: "Working tree",
				diff: {
					patch: diff.patch,
					stats: diff.stats,
					files: diff.files,
					fromRef: row.base_ref,
					toRef: diff.toTree,
				},
			};
		}
		if (scope === "session_changes") {
			const baseline = this.checkpoints.getLatestCheckpoint(sessionId, "baseline");
			if (!baseline?.gitTree) return { title: "", description: "", fromLabel: "", toLabel: "", diff: undefined };
			const diff = await this.git.diffAgainstWorkingTree(row.cwd_path, baseline.gitTree);
			return {
				title: "Session changes",
				description: "Changes from the session baseline to the current working state",
				fromLabel: "Baseline",
				toLabel: "Working tree",
				diff: {
					patch: diff.patch,
					stats: diff.stats,
					files: diff.files,
					fromCheckpointId: baseline.id,
					toRef: diff.toTree,
				},
			};
		}
		if (scope === "last_turn_changes") {
			const pair = this.checkpoints.getLatestTurnPair(sessionId);
			if (!pair?.checkpoint_before_id || !pair.checkpoint_after_id) {
				return { title: "", description: "", fromLabel: "", toLabel: "", diff: undefined };
			}
			const before = this.checkpoints.getCheckpoint(pair.checkpoint_before_id);
			const after = this.checkpoints.getCheckpoint(pair.checkpoint_after_id);
			if (!before?.gitTree || !after?.gitTree) {
				return { title: "", description: "", fromLabel: "", toLabel: "", diff: undefined };
			}
			const diff = await this.git.diffBetweenRefs(
				row.cwd_path,
				before.gitTree,
				after.gitTree,
			);
			return {
				title: "Last turn changes",
				description: "Diff for the most recent completed turn",
				fromLabel: "Turn start",
				toLabel: "Turn end",
				diff: {
					patch: diff.patch,
					stats: diff.stats,
					files: diff.files,
					fromCheckpointId: before.id,
					toCheckpointId: after.id,
				},
			};
		}
		if (scope === "review_round_changes") {
			const start = this.checkpoints.getLatestCheckpoint(sessionId, "review_start");
			if (!start?.gitTree) {
				return { title: "", description: "", fromLabel: "", toLabel: "", diff: undefined };
			}
			const diff = await this.git.diffAgainstWorkingTree(row.cwd_path, start.gitTree);
			return {
				title: "Review round changes",
				description: "Changes since the active review round started",
				fromLabel: "Review start",
				toLabel: "Working tree",
				diff: {
					patch: diff.patch,
					stats: diff.stats,
					files: diff.files,
					fromCheckpointId: start.id,
					toRef: diff.toTree,
				},
			};
		}
		if (scope === "since_alignment") {
			const start = this.checkpoints.getLatestCheckpoint(sessionId, "alignment");
			if (!start?.gitTree) {
				return { title: "", description: "", fromLabel: "", toLabel: "", diff: undefined };
			}
			const diff = await this.git.diffAgainstWorkingTree(row.cwd_path, start.gitTree);
			return {
				title: "Since alignment",
				description: "Changes since the last explicit alignment checkpoint",
				fromLabel: "Alignment",
				toLabel: "Working tree",
				diff: {
					patch: diff.patch,
					stats: diff.stats,
					files: diff.files,
					fromCheckpointId: start.id,
					toRef: diff.toTree,
				},
			};
		}
		return {
			title: "",
			description: "",
			fromLabel: "",
			toLabel: "",
			diff: undefined,
		};
	}

	async listDiffScopes(sessionId: string): Promise<DiffScopeSummary[]> {
		const row = this.getSessionRow(sessionId);
		if (!row) throw new Error("Session not found.");
		const hasBaseline = Boolean(
			this.checkpoints.getLatestCheckpoint(sessionId, "baseline"),
		);
		const hasTurnPair = Boolean(this.checkpoints.getLatestTurnPair(sessionId));
		const hasReviewStart = Boolean(
			this.checkpoints.getLatestCheckpoint(sessionId, "review_start"),
		);
		const hasAlignment = Boolean(
			this.checkpoints.getLatestCheckpoint(sessionId, "alignment"),
		);
		return [
			{
				scope: "session_changes",
				label: "Session changes",
				description: "Baseline to working tree",
				available: hasBaseline,
				reasonUnavailable: hasBaseline ? undefined : "No baseline checkpoint yet.",
			},
			{
				scope: "last_turn_changes",
				label: "Last turn",
				description: "Most recent turn checkpoint pair",
				available: hasTurnPair,
				reasonUnavailable: hasTurnPair ? undefined : "No completed turn yet.",
			},
			{
				scope: "review_round_changes",
				label: "Review round",
				description: "Review start to working tree",
				available: hasReviewStart,
				reasonUnavailable: hasReviewStart
					? undefined
					: "No submitted review round yet.",
			},
			{
				scope: "since_alignment",
				label: "Since alignment",
				description: "Alignment checkpoint to working tree",
				available: hasAlignment,
				reasonUnavailable: hasAlignment
					? undefined
					: "No alignment checkpoint yet.",
			},
			{
				scope: "branch_vs_base",
				label: "Branch vs base",
				description: "Base ref to working tree",
				available: Boolean(row.base_ref),
				reasonUnavailable: row.base_ref ? undefined : "No base ref configured.",
			},
			{
				scope: "staged",
				label: "Staged",
				description: "Git index diff",
				available: true,
			},
			{
				scope: "unstaged",
				label: "Unstaged",
				description: "Working tree diff",
				available: true,
			},
		];
	}

	async buildDiff(sessionId: string, scope: DiffScope) {
		const row = this.getSessionRow(sessionId);
		if (!row) throw new Error("Session not found.");
		const resolved = await this.resolveCheckpointPair(sessionId, scope, row);
		if (!resolved.diff) {
			throw new Error(`Diff scope "${scope}" is not available yet.`);
		}
		const snapshot = this.checkpoints.storeDiffSnapshot({
			sessionId,
			scope,
			title: resolved.title,
			description: resolved.description,
			fromLabel: resolved.fromLabel,
			toLabel: resolved.toLabel,
			patch: resolved.diff.patch,
			stats: resolved.diff.stats,
			fromCheckpointId: resolved.diff.fromCheckpointId,
			toCheckpointId: resolved.diff.toCheckpointId,
			fromRef: resolved.diff.fromRef,
			toRef: resolved.diff.toRef,
		});
		if (!snapshot) {
			throw new Error("Failed to persist diff snapshot.");
		}
		await this.review.reanchorThreads(sessionId, snapshot);
		return snapshot;
	}

	async onTurnStart(sessionId: string, turnIndex: number, event: AgentSessionEvent) {
		const row = this.getSessionRow(sessionId);
		if (!row) return;
		const safeTurnIndex =
			turnIndex ??
			((this.db.get<{ m: number | null }>(
				"select max(turn_index) as m from turns where session_id = ?",
				sessionId,
			)?.m ?? -1) + 1);
		let checkpoint: CheckpointRecord | null = null;
		if (await this.git.isGitRepo(row.cwd_path)) {
			checkpoint = await this.checkpoints.createCheckpoint({
				sessionId,
				cwd: row.cwd_path,
				kind: "pre_turn",
			});
			if (checkpoint) {
				this.messenger.sessionEvent({
					type: "checkpoint_created",
					checkpoint: {
						id: checkpoint.id,
						sessionId: checkpoint.sessionId,
						kind: checkpoint.kind,
						createdAt: checkpoint.createdAt,
						gitHead: checkpoint.gitHead,
						gitTree: checkpoint.gitTree,
						parentCheckpointId: checkpoint.parentCheckpointId,
					},
				});
			}
		}
		this.db.run(
			`
			insert into turns (
				id, session_id, turn_index, started_at, agent_start_event_json, checkpoint_before_id
			) values (?, ?, ?, ?, ?, ?)
			on conflict(session_id, turn_index) do update set
				started_at = excluded.started_at,
				agent_start_event_json = excluded.agent_start_event_json,
				checkpoint_before_id = excluded.checkpoint_before_id
			`,
			crypto.randomUUID(),
			sessionId,
			safeTurnIndex,
			Date.now(),
			JSON.stringify(event),
			checkpoint?.id ?? null,
		);
	}

	async onTurnEnd(sessionId: string, turnIndex: number, event: AgentSessionEvent) {
		const row = this.getSessionRow(sessionId);
		if (!row) return;
		const safeTurnIndex =
			turnIndex ??
			(this.db.get<{ m: number | null }>(
				"select max(turn_index) as m from turns where session_id = ?",
				sessionId,
			)?.m ?? 0);
		let checkpoint: CheckpointRecord | null = null;
		if (await this.git.isGitRepo(row.cwd_path)) {
			checkpoint = await this.checkpoints.createCheckpoint({
				sessionId,
				cwd: row.cwd_path,
				kind: "post_turn",
			});
			if (checkpoint) {
				this.messenger.sessionEvent({
					type: "checkpoint_created",
					checkpoint: {
						id: checkpoint.id,
						sessionId: checkpoint.sessionId,
						kind: checkpoint.kind,
						createdAt: checkpoint.createdAt,
						gitHead: checkpoint.gitHead,
						gitTree: checkpoint.gitTree,
						parentCheckpointId: checkpoint.parentCheckpointId,
					},
				});
			}
		}
		const turn = this.db.get<TurnRow>(
			"select id, checkpoint_before_id, checkpoint_after_id from turns where session_id = ? and turn_index = ?",
			sessionId,
			safeTurnIndex,
		);
		this.db.run(
			`
			update turns
			set ended_at = ?, turn_end_event_json = ?, checkpoint_after_id = ?
			where session_id = ? and turn_index = ?
			`,
			Date.now(),
			JSON.stringify(event),
			checkpoint?.id ?? null,
			sessionId,
			safeTurnIndex,
		);
		await this.refreshGitStatus(sessionId);
		const changedFiles = Number(
			this.parseMetadata(this.getSessionRow(sessionId)?.metadata_json ?? "{}")
				.changedFilesCount ?? 0,
		);
		if (changedFiles > 0) {
			this.db.run(
				"update sessions set review_state = 'pending', status = 'waiting_for_review', last_activity_at = ? where id = ?",
				Date.now(),
				sessionId,
			);
			this.review.ensureDraftRound(sessionId);
		} else {
			this.db.run(
				"update sessions set status = 'idle', last_activity_at = ? where id = ?",
				Date.now(),
				sessionId,
			);
		}
		if (turn?.checkpoint_before_id && checkpoint?.id) {
			this.messenger.diffInvalidated({
				sessionId,
				scope: "last_turn_changes",
			});
		}
		this.messenger.diffInvalidated({
			sessionId,
			scope: "session_changes",
		});
		await this.review.markRoundAppliedForSession(sessionId);
		await this.refreshAndPublishSession(sessionId);
	}

	configureRuntimeHooks() {
		this.runtime.setHooks({
			onStatusPatch: async (sessionId, patch) => {
				await this.updateRuntimeStatus(sessionId, patch);
			},
			onTurnStart: async (sessionId, turnIndex, event) => {
				await this.onTurnStart(sessionId, turnIndex, event);
			},
			onTurnEnd: async (sessionId, turnIndex, event) => {
				await this.onTurnEnd(sessionId, turnIndex, event);
			},
		});
	}
}
