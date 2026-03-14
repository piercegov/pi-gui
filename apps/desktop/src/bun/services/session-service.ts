import { Utils } from "electrobun/bun";
import type {
	AppSettings,
	CheckpointSummaryView,
	DiffMode,
	DiffSnapshotView,
	GitStatusView,
	ModelCatalogSummary,
	SessionHydration,
	SessionInspectorView,
	SessionSummary,
} from "../../shared/models";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import {
	CheckpointService,
	type CheckpointRecord,
	toCheckpointSummaryView,
} from "./checkpoint-service";
import { AppDb } from "./db";
import { GitService } from "./git-service";
import type { HostMessenger } from "./host-messenger";
import type { MockWorkflowService } from "./mock-workflow-service";
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
		private readonly mockWorkflow?: MockWorkflowService,
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
					  and ct.status in ('open', 'agent_replied', 'needs_user')
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
		const mockSummary = this.mockWorkflow?.getSessionSummary(sessionId);
		if (mockSummary) return mockSummary;
		const row = this.getSessionRow(sessionId);
		return row ? this.toSummary(row) : null;
	}

	async listSessions(projectId: string) {
		const mockSessions = this.mockWorkflow?.listSessions(
			projectId,
			this.settings.getAppSettings().showArchived,
		);
		if (mockSessions) return mockSessions;
		const rows = this.db.all<SessionRow>(
			`
			select
				s.*,
				(
					select count(*)
					from comment_threads ct
					where ct.session_id = s.id
					  and ct.status in ('open', 'agent_replied', 'needs_user')
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

	async getModelCatalog(projectId: string): Promise<ModelCatalogSummary> {
		const mockCatalog = this.mockWorkflow?.getModelCatalog(projectId);
		if (mockCatalog) return mockCatalog;
		const project = this.getProjectOrThrow(projectId);
		return this.runtime.getModelCatalog(project.rootPath);
	}

	private async refreshAndPublishSession(sessionId: string) {
		const summary = await this.getSessionSummary(sessionId);
		if (!summary) return;
		this.messenger.sessionSummaryUpdated(summary);
	}

	private mapCheckpoint(checkpoint: CheckpointRecord) {
		return toCheckpointSummaryView(checkpoint) satisfies CheckpointSummaryView;
	}

	private emitCheckpointCreated(checkpoint: CheckpointRecord | null | undefined) {
		if (!checkpoint) return;
		this.messenger.sessionEvent({
			type: "checkpoint_created",
			checkpoint: this.mapCheckpoint(checkpoint),
		});
	}

	resetStaleStatuses() {
		this.db.run(
			`UPDATE sessions SET status = 'idle' WHERE status IN ('running', 'starting', 'applying')`,
		);
	}

	async updateRuntimeStatus(
		sessionId: string,
		patch: {
			status?: string;
			modelLabel?: string;
			lastError?: string;
		},
	) {
		if (this.mockWorkflow?.isMockSession(sessionId)) return;
		const row = this.getSessionRow(sessionId);
		if (!row) return;
		const metadata = this.parseMetadata(row.metadata_json);
		if (patch.modelLabel !== undefined) metadata.modelLabel = patch.modelLabel;
		if (patch.lastError !== undefined) metadata.lastError = patch.lastError;
		this.db.run(
			`
			update sessions
			set status = coalesce(?, status),
			    review_state = case when ? = 'running' then 'none' else review_state end,
			    last_activity_at = ?,
			    metadata_json = ?
			where id = ?
			`,
			patch.status ?? null,
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
		if (this.mockWorkflow?.isMockSession(sessionId)) return;
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
		if (this.mockWorkflow?.isMockSession(sessionId)) {
			throw new Error("Mock workflow sessions do not use the live runtime.");
		}
		const row = this.getSessionRow(sessionId);
		if (!row) throw new Error("Session not found.");
		const project = this.getProjectOrThrow(row.project_id);
		const metadata = this.parseMetadata(row.metadata_json);
		const preferredModelProvider =
			typeof metadata.preferredModelProvider === "string"
				? metadata.preferredModelProvider
				: undefined;
		const preferredModelId =
			typeof metadata.preferredModelId === "string"
				? metadata.preferredModelId
				: undefined;
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
			preferredModelProvider,
			preferredModelId,
		});
		return row;
	}

	async createSession(params: {
		projectId: string;
		name?: string;
		mode?: "worktree" | "local";
		baseRef?: string;
		modelProvider?: string;
		modelId?: string;
	}) {
		const mockSession = this.mockWorkflow?.createSession({
			projectId: params.projectId,
			name: params.name,
		});
		if (mockSession) return mockSession;
		const project = this.getProjectOrThrow(params.projectId);
		const settings = this.settings.getAppSettings();
		const sessionId = crypto.randomUUID();
		const now = Date.now();
		const preferredModelProvider = params.modelProvider?.trim() || undefined;
		const preferredModelId = params.modelId?.trim() || undefined;
		if (
			(preferredModelProvider && !preferredModelId) ||
			(!preferredModelProvider && preferredModelId)
		) {
			throw new Error("Model provider and model id must both be provided.");
		}
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
			preferredModelProvider,
			preferredModelId,
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
				preferredModelProvider: preferredModelProvider ?? null,
				preferredModelId: preferredModelId ?? null,
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
		const mockHydration = this.mockWorkflow?.openSession(
			sessionId,
			this.settings.getAppSettings(),
		);
		if (mockHydration) {
			return mockHydration;
		}
		const row = await this.ensureRuntime(sessionId);
		const project = this.getProjectOrThrow(row.project_id);
		await this.refreshGitStatus(sessionId);
		const session = (await this.getSessionSummary(sessionId))!;
		const revisions = this.review.listRevisions(sessionId);
		const activeRevisionNumber = this.review.getActiveRevisionNumber(sessionId);

		// Build initial diff: latest revision's cumulative diff, or session_changes
		let currentDiff: DiffSnapshotView | undefined;
		if (activeRevisionNumber !== undefined) {
			try {
				currentDiff = await this.review.buildRevisionDiff(sessionId, activeRevisionNumber, "incremental");
			} catch {
				// Ignore diff build failures
			}
		} else {
			try {
				currentDiff = await this.buildSessionDiff(sessionId);
			} catch {
				// Ignore diff build failures
			}
		}

		const checkpointRecords = this.checkpoints.listCheckpoints(sessionId);
		const checkpointViews: CheckpointSummaryView[] = checkpointRecords.map((cp) =>
			this.mapCheckpoint(cp),
		);
		return {
			project,
			session,
			conversation: this.runtime.getConversation(sessionId),
			toolActivity: this.runtime.getToolActivity(sessionId),
			checkpoints: checkpointViews,
			revisions,
			activeRevisionNumber,
			currentDiff: currentDiff ?? undefined,
			contextUsage: this.runtime.getContextUsage(sessionId),
			appSettings: this.settings.getAppSettings(),
			supportsEmbeddedTerminal: process.platform !== "win32",
			piConfig: this.runtime.getPiConfigSummary(sessionId),
		};
	}

	async buildSessionDiff(sessionId: string): Promise<DiffSnapshotView | undefined> {
		const mockDiff = this.mockWorkflow?.buildSessionDiff(sessionId);
		if (mockDiff) return mockDiff;
		const row = this.getSessionRow(sessionId);
		if (!row) return undefined;
		const baseline = this.checkpoints.getLatestCheckpoint(sessionId, "baseline");
		if (!baseline?.gitTree) return undefined;
		const diff = await this.git.diffAgainstWorkingTree(row.cwd_path, baseline.gitTree);
		if (!diff.patch.trim()) return undefined;
		return this.checkpoints.buildTransientDiffSnapshot({
			sessionId,
			scope: "session_changes",
			title: "Session changes",
			description: "Changes from the session baseline to the current working state",
			fromLabel: "Baseline",
			toLabel: "Working tree",
			patch: diff.patch,
			stats: diff.stats,
			cacheParts: [
				"session_changes",
				sessionId,
				baseline.gitTree,
				diff.toTree,
				"working_tree",
			],
			fromCheckpointId: baseline.id,
		});
	}

	async buildRevisionDiff(sessionId: string, revisionNumber: number, mode: DiffMode) {
		const mockDiff = this.mockWorkflow?.buildRevisionDiff(
			sessionId,
			revisionNumber,
			mode,
		);
		if (mockDiff) return mockDiff;
		return this.review.buildRevisionDiff(sessionId, revisionNumber, mode);
	}

	async getSessionInspector(sessionId: string): Promise<SessionInspectorView> {
		const mockInspector = this.mockWorkflow?.getSessionInspector(sessionId);
		if (mockInspector) return mockInspector;
		const row = await this.ensureRuntime(sessionId);
		await this.refreshGitStatus(sessionId);
		const summary = await this.getSessionSummary(sessionId);
		if (!summary) throw new Error("Session not found.");
		const checkpoints: CheckpointSummaryView[] = this.checkpoints
			.listCheckpoints(sessionId)
			.map((checkpoint) => this.mapCheckpoint(checkpoint));
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
		if (this.mockWorkflow?.renameSession(sessionId, name)) {
			return;
		}
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
		if (this.mockWorkflow?.archiveSession(sessionId, archived)) {
			return;
		}
		this.db.run(
			"update sessions set archived_at = ?, status = ?, last_activity_at = ? where id = ?",
			archived ? Date.now() : null,
			archived ? "archived" : "idle",
			Date.now(),
			sessionId,
		);
	}

	async repairSessionWorktree(sessionId: string) {
		if (this.mockWorkflow?.repairWorktree(sessionId)) {
			return;
		}
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
		if (this.mockWorkflow?.abort(sessionId)) {
			return;
		}
		await this.runtime.abortSession(sessionId);
		await this.updateRuntimeStatus(sessionId, { status: "idle" });
	}

	async sendPrompt(sessionId: string, text: string) {
		if (await this.mockWorkflow?.replay(sessionId, { promptText: text })) {
			return;
		}
		await this.ensureRuntime(sessionId);
		await this.runtime.sendPrompt(sessionId, text);
	}

	async steerSession(sessionId: string, text: string) {
		if (await this.mockWorkflow?.replay(sessionId, { promptText: text })) {
			return;
		}
		await this.ensureRuntime(sessionId);
		await this.runtime.steerSession(sessionId, text);
	}

	async followUpSession(sessionId: string, text: string) {
		if (await this.mockWorkflow?.replay(sessionId, { promptText: text })) {
			return;
		}
		await this.ensureRuntime(sessionId);
		await this.runtime.followUpSession(sessionId, text);
	}

	async restoreCheckpoint(sessionId: string, checkpointId: string) {
		if (this.mockWorkflow?.restoreCheckpoint(sessionId, checkpointId)) {
			return;
		}
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
		this.emitCheckpointCreated(restored);
		await this.refreshGitStatus(sessionId);
		this.messenger.diffInvalidated({ sessionId });
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
		const mockCheckpoint = this.mockWorkflow?.createManualCheckpoint(sessionId);
		if (mockCheckpoint) {
			this.messenger.toast({
				id: crypto.randomUUID(),
				title: "Manual checkpoint saved",
				description: new Date(mockCheckpoint.createdAt).toLocaleTimeString([], {
					hour: "numeric",
					minute: "2-digit",
				}),
				variant: "success",
			});
			return mockCheckpoint;
		}
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
		this.emitCheckpointCreated(checkpoint);
		this.messenger.toast({
			id: crypto.randomUUID(),
			title: "Manual checkpoint saved",
			description: new Date(checkpoint.createdAt).toLocaleTimeString([], {
				hour: "numeric",
				minute: "2-digit",
			}),
			variant: "success",
		});
		return this.mapCheckpoint(checkpoint);
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
			this.emitCheckpointCreated(checkpoint);
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
			this.emitCheckpointCreated(checkpoint);
		}
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
		// Only transition status if the agent has stopped running.
		// During multi-turn execution, agent_start fires once and agent_end fires
		// at the very end — we must not overwrite "running" on intermediate turns.
		if (!this.runtime.isSessionRunning(sessionId)) {
			const changedFiles = Number(
				this.parseMetadata(this.getSessionRow(sessionId)?.metadata_json ?? "{}")
					.changedFilesCount ?? 0,
			);
			if (changedFiles > 0) {
				this.review.ensureActiveRevision(sessionId);
				this.db.run(
					"update sessions set review_state = 'reviewing', status = 'reviewing', last_activity_at = ? where id = ?",
					Date.now(),
					sessionId,
				);
			} else {
				this.db.run(
					"update sessions set status = 'idle', last_activity_at = ? where id = ?",
					Date.now(),
					sessionId,
				);
			}
		}
		this.messenger.diffInvalidated({ sessionId });
		await this.refreshAndPublishSession(sessionId);
	}

	configureRuntimeHooks() {
		this.runtime.setHooks({
			onStatusPatch: async (sessionId, patch) => {
				// When agent finishes (agent_end → status "idle"), apply review logic
				if (patch.status === "idle") {
					await this.refreshGitStatus(sessionId);
					const changedFiles = Number(
						this.parseMetadata(this.getSessionRow(sessionId)?.metadata_json ?? "{}")
							.changedFilesCount ?? 0,
					);
					if (changedFiles > 0) {
						this.review.ensureActiveRevision(sessionId);
						this.db.run(
							"update sessions set review_state = 'reviewing', last_activity_at = ? where id = ?",
							Date.now(),
							sessionId,
						);
						patch = { ...patch, status: "reviewing" };
					}
				}
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
