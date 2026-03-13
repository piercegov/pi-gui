import type {
	AppSettings,
	CheckpointSummaryView,
	ContextUsageView,
	ConversationEntryView,
	DiffMode,
	DiffSnapshotView,
	ModelCatalogSummary,
	PiConfigSummary,
	ProjectSummary,
	RevisionView,
	SessionHydration,
	SessionInspectorView,
	SessionSummary,
	ToolActivityView,
} from "../../shared/models";
import { appPaths } from "./app-paths";
import type { HostMessenger } from "./host-messenger";

export const MOCK_WORKFLOW_ENV_VAR = "PI_GUI_MOCK_WORKFLOW";
export const CURSOR_CLOUD_DEMO_WORKFLOW_ID = "cursor-cloud-demo";

const DEFAULT_TIMELINE_STEP_MS = 140;
const MOCK_MODEL_LABEL = "mock/cursor-cloud-demo";
const MOCK_WORKFLOW_BADGE = "Mock workflow";

type MockSessionState = {
	projectId: string;
	session: SessionSummary;
	conversation: ConversationEntryView[];
	toolActivity: ToolActivityView[];
	checkpoints: CheckpointSummaryView[];
	inspector: SessionInspectorView;
	contextUsage?: ContextUsageView;
	revisions: RevisionView[];
	currentDiff: DiffSnapshotView;
	autoReplayPending: boolean;
	runVersion: number;
	timers: Set<ReturnType<typeof setTimeout>>;
};

function clone<T>(value: T): T {
	return structuredClone(value);
}

function chunkText(text: string) {
	return text.match(/.{1,48}(\s|$)/g)?.map((chunk) => chunk) ?? [text];
}

function makeCheckpoint(
	sessionId: string,
	id: string,
	kind: CheckpointSummaryView["kind"],
	createdAt: number,
	parentCheckpointId?: string,
): CheckpointSummaryView {
	return {
		id,
		sessionId,
		kind,
		createdAt,
		gitHead: "mock-head",
		gitTree: `mock-tree:${id}`,
		parentCheckpointId,
	};
}

function makeDiff(sessionId: string): DiffSnapshotView {
	const patch = [
		"diff --git a/apps/desktop/src/ui/app.tsx b/apps/desktop/src/ui/app.tsx",
		"index 1111111..2222222 100644",
		"--- a/apps/desktop/src/ui/app.tsx",
		"+++ b/apps/desktop/src/ui/app.tsx",
		"@@ -182,10 +182,15 @@ export function App() {",
		"\tconst [newSessionDialogOpen, setNewSessionDialogOpen] = useState(false);",
		"\tconst [modelCatalog, setModelCatalog] = useState<ModelCatalogSummary | undefined>(",
		"\t\tundefined,",
		"\t);",
		"+\tconst [mockWorkflowActive, setMockWorkflowActive] = useState(false);",
		" ",
		"\tuseEffect(() => {",
		"+\t\tif (import.meta.env.DEV && window.location.search.includes(\"mock-workflow\")) {",
		"+\t\t\tsetMockWorkflowActive(true);",
		"+\t\t}",
		"\t\tvoid loadProjects();",
		"\t\tvoid loadSettings();",
		"\t}, [loadProjects, loadSettings]);",
	].join("\n");
	return {
		id: `mock-diff:${sessionId}:session`,
		cacheKey: `mock-diff:${sessionId}:session`,
		sessionId,
		scope: "session_changes",
		title: "Mock session changes",
		description: "A deterministic diff used for cloud-agent demo recordings.",
		fromLabel: "Baseline",
		toLabel: "Working tree",
		fromCheckpointId: `mock-cp:${sessionId}:baseline`,
		toCheckpointId: `mock-cp:${sessionId}:post-turn`,
		patch,
		stats: {
			filesChanged: 1,
			additions: 4,
			deletions: 0,
			fileStats: [
				{
					path: "apps/desktop/src/ui/app.tsx",
					additions: 4,
					deletions: 0,
					type: "modify",
				},
			],
		},
		files: [
			{
				path: "apps/desktop/src/ui/app.tsx",
				additions: 4,
				deletions: 0,
				type: "modify",
			},
		],
		createdAt: Date.now(),
	};
}

function makeRevision(sessionId: string, diffId: string, checkpointId: string): RevisionView {
	return {
		id: `mock-revision:${sessionId}:1`,
		sessionId,
		revisionNumber: 1,
		state: "discussing",
		startedAt: Date.now(),
		checkpointId,
		baselineCheckpointId: `mock-cp:${sessionId}:baseline`,
		addressThisCount: 1,
		noChangesCount: 0,
		unresolvedCount: 1,
		summaryMarkdown: "Mock review state seeded for cloud-agent debugging demos.",
		metadata: {
			mockWorkflowId: CURSOR_CLOUD_DEMO_WORKFLOW_ID,
		},
		threads: [
			{
				id: `mock-thread:${sessionId}:1`,
				reviewRoundId: `mock-revision:${sessionId}:1`,
				sessionId,
				filePath: "apps/desktop/src/ui/app.tsx",
				anchor: {
					filePath: "apps/desktop/src/ui/app.tsx",
					side: "new",
					line: 183,
					hunkHeader: "@@ -182,10 +182,15 @@ export function App() {",
					beforeContext: [
						"\tconst [newSessionDialogOpen, setNewSessionDialogOpen] = useState(false);",
						"\tconst [modelCatalog, setModelCatalog] = useState<ModelCatalogSummary | undefined>(",
						"\t\tundefined,",
					],
					targetLineText: "\tconst [mockWorkflowActive, setMockWorkflowActive] = useState(false);",
					afterContext: [
						"",
						"\tuseEffect(() => {",
						"\t\tvoid loadProjects();",
					],
					checkpointId,
					diffSnapshotId: diffId,
				},
				status: "needs_user",
				resolution: "address_this",
				createdAt: Date.now(),
				updatedAt: Date.now(),
				metadata: {
					mockWorkflowId: CURSOR_CLOUD_DEMO_WORKFLOW_ID,
				},
				messages: [
					{
						id: `mock-message:${sessionId}:review-user`,
						threadId: `mock-thread:${sessionId}:1`,
						authorType: "user",
						bodyMarkdown:
							"Make the mock workflow explicit in the UI so recordings are self-explanatory.",
						createdAt: Date.now(),
						deliveryMode: "immediate",
						metadata: {},
					},
					{
						id: `mock-message:${sessionId}:review-agent`,
						threadId: `mock-thread:${sessionId}:1`,
						authorType: "agent",
						bodyMarkdown:
							"I can add a compact badge in the title bar and keep the feature behind an environment gate.",
						createdAt: Date.now() + 1,
						deliveryMode: "system",
						metadata: {
							disposition: "proposed_change",
							plan: ["Add a mock workflow badge", "Document the env variable for cloud agents"],
						},
					},
				],
			},
		],
	};
}

function makeInspector(sessionId: string): SessionInspectorView {
	return {
		sessionId,
		sessionFile: `mock://sessions/${sessionId}.jsonl`,
		parentSessionPath: "mock://sessions/root.jsonl",
		worktreeMissing: false,
		checkpoints: [
			makeCheckpoint(sessionId, `mock-cp:${sessionId}:post-turn`, "post_turn", Date.now(), `mock-cp:${sessionId}:baseline`),
			makeCheckpoint(sessionId, `mock-cp:${sessionId}:baseline`, "baseline", Date.now() - 5_000),
		],
		tree: [
			{
				id: `mock-tree:${sessionId}:root`,
				type: "message",
				timestamp: Date.now() - 10_000,
				label: "turn-0-start",
				summary: "User: Add a cloud-agent-friendly mock workflow for demo recordings.",
				isCurrent: false,
				children: [
					{
						id: `mock-tree:${sessionId}:assistant`,
						type: "message",
						timestamp: Date.now() - 8_000,
						label: "turn-0-end",
						summary: "Assistant: Added deterministic mock playback and documentation hooks.",
						isCurrent: true,
						children: [
							{
								id: `mock-tree:${sessionId}:review`,
								type: "custom_message",
								timestamp: Date.now() - 7_500,
								label: "pi-review-discussion",
								summary: "Injected context: pi-review-discussion",
								isCurrent: false,
								children: [],
							},
						],
					},
				],
			},
		],
	};
}

export class MockWorkflowService {
	private readonly messenger: HostMessenger;
	private readonly enabledWorkflowId?: string;
	private readonly workspaceRoot: string;
	private readonly timelineStepMs: number;
	private readonly projectId = `mock-project:${CURSOR_CLOUD_DEMO_WORKFLOW_ID}`;
	private readonly sessions = new Map<string, MockSessionState>();

	constructor(params: {
		messenger: HostMessenger;
		enabledWorkflowId?: string;
		workspaceRoot?: string;
		timelineStepMs?: number;
	}) {
		this.messenger = params.messenger;
		this.enabledWorkflowId =
			params.enabledWorkflowId === CURSOR_CLOUD_DEMO_WORKFLOW_ID
				? params.enabledWorkflowId
				: undefined;
		this.workspaceRoot = params.workspaceRoot ?? process.cwd();
		this.timelineStepMs = params.timelineStepMs ?? DEFAULT_TIMELINE_STEP_MS;
		if (this.enabledWorkflowId) {
			const initial = this.buildSessionState("Cursor cloud demo");
			this.sessions.set(initial.session.id, initial);
		}
	}

	isEnabled() {
		return Boolean(this.enabledWorkflowId);
	}

	isMockProject(projectId: string) {
		return this.isEnabled() && projectId === this.projectId;
	}

	isMockSession(sessionId: string) {
		return this.isEnabled() && this.sessions.has(sessionId);
	}

	getProject(projectId: string): ProjectSummary | null {
		if (!this.isMockProject(projectId)) return null;
		return this.buildProjectSummary();
	}

	listProjects(existingProjects: ProjectSummary[]) {
		if (!this.isEnabled()) return existingProjects;
		return [this.buildProjectSummary(), ...existingProjects];
	}

	listSessions(projectId: string, showArchived: boolean): SessionSummary[] | null {
		if (!this.isMockProject(projectId)) return null;
		return Array.from(this.sessions.values())
			.map((state) => clone(state.session))
			.filter((session) => showArchived || !session.archivedAt)
			.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
	}

	getSessionSummary(sessionId: string) {
		const state = this.sessions.get(sessionId);
		return state ? clone(state.session) : null;
	}

	getModelCatalog(projectId: string): ModelCatalogSummary | null {
		if (!this.isMockProject(projectId)) return null;
		return {
			providers: [],
			models: [],
		};
	}

	createSession(params: { projectId: string; name?: string }) {
		if (!this.isMockProject(params.projectId)) return null;
		const state = this.buildSessionState(params.name?.trim() || "Mock workflow");
		this.sessions.set(state.session.id, state);
		this.emitSessionSummary(state);
		return clone(state.session);
	}

	renameSession(sessionId: string, name: string) {
		const state = this.sessions.get(sessionId);
		if (!state) return false;
		state.session.displayName = name;
		this.touchSession(state);
		this.emitSessionSummary(state);
		return true;
	}

	archiveSession(sessionId: string, archived: boolean) {
		const state = this.sessions.get(sessionId);
		if (!state) return false;
		state.session.archivedAt = archived ? Date.now() : undefined;
		state.session.status = archived ? "archived" : "idle";
		this.touchSession(state);
		this.emitSessionSummary(state);
		return true;
	}

	openSession(sessionId: string, appSettings: AppSettings): SessionHydration | null {
		const state = this.sessions.get(sessionId);
		if (!state) return null;
		const hydration: SessionHydration = {
			project: this.buildProjectSummary(),
			session: clone(state.session),
			conversation: clone(state.conversation),
			toolActivity: clone(state.toolActivity),
			checkpoints: clone(state.checkpoints),
			revisions: clone(state.revisions),
			activeRevisionNumber: state.revisions[0]?.revisionNumber,
			currentDiff: clone(state.currentDiff),
			appSettings,
			contextUsage: state.contextUsage ? clone(state.contextUsage) : undefined,
			supportsEmbeddedTerminal: process.platform !== "win32",
			piConfig: this.buildPiConfig(),
		};
		if (state.autoReplayPending && !state.session.archivedAt) {
			queueMicrotask(() => {
				void this.replay(sessionId);
			});
		}
		return hydration;
	}

	getSessionInspector(sessionId: string) {
		const state = this.sessions.get(sessionId);
		return state ? clone(state.inspector) : null;
	}

	buildSessionDiff(sessionId: string) {
		const state = this.sessions.get(sessionId);
		return state ? clone(state.currentDiff) : undefined;
	}

	buildRevisionDiff(sessionId: string, revisionNumber: number, mode: DiffMode) {
		const state = this.sessions.get(sessionId);
		if (!state || revisionNumber !== 1) return undefined;
		const next = clone(state.currentDiff);
		next.id = `mock-diff:${sessionId}:revision:${mode}`;
		next.cacheKey = next.id;
		next.title = mode === "cumulative" ? "Mock revision 1 — cumulative" : "Mock revision 1 — incremental";
		next.description = `Deterministic ${mode} diff for the cursor cloud demo workflow.`;
		next.revisionNumber = 1;
		next.diffMode = mode;
		return next;
	}

	async replay(sessionId: string, options?: { promptText?: string; assistantText?: string }) {
		const state = this.sessions.get(sessionId);
		if (!state) return false;
		this.abort(sessionId, { silent: true });
		state.autoReplayPending = false;
		state.runVersion += 1;
		const runVersion = state.runVersion;
		state.session.status = "running";
		state.session.reviewState = "none";
		this.touchSession(state);
		this.emitSessionSummary(state);

		const promptText =
			options?.promptText ??
			"Add a cloud-agent-friendly mock workflow so demos can run without model credentials.";
		const assistantText =
			options?.assistantText ??
			"I set up a deterministic demo workflow that boots into a seeded session, streams tool activity, and keeps the feature gated behind an environment variable so normal users never see it.";
		const userEntry: ConversationEntryView = {
			id: `mock-entry:${sessionId}:user:${runVersion}`,
			sessionId,
			kind: "user",
			timestamp: Date.now(),
			markdown: promptText,
			status: "done",
			metadata: {
				mockWorkflowId: CURSOR_CLOUD_DEMO_WORKFLOW_ID,
			},
		};
		this.upsertConversationEntry(state, userEntry);
		this.messenger.sessionEvent({
			type: "message_upsert",
			entry: clone(userEntry),
		});

		await this.wait(state, runVersion, 1);
		if (!this.isRunCurrent(state, runVersion)) return false;

		const assistantEntry: ConversationEntryView = {
			id: `mock-entry:${sessionId}:assistant:${runVersion}`,
			sessionId,
			kind: "assistant",
			timestamp: Date.now(),
			markdown: "",
			status: "streaming",
			metadata: {
				model: MOCK_MODEL_LABEL,
				stopReason: "stop",
				mockWorkflowId: CURSOR_CLOUD_DEMO_WORKFLOW_ID,
			},
		};
		this.upsertConversationEntry(state, assistantEntry);
		this.messenger.sessionEvent({
			type: "message_upsert",
			entry: clone(assistantEntry),
		});

		for (const chunk of chunkText(assistantText)) {
			await this.wait(state, runVersion, 1);
			if (!this.isRunCurrent(state, runVersion)) return false;
			this.appendMessageDelta(state, assistantEntry.id, chunk);
			this.messenger.sessionEvent({
				type: "message_delta",
				sessionId,
				entryId: assistantEntry.id,
				delta: chunk,
			});
		}

		await this.runToolSequence(state, runVersion, [
			{
				name: "read",
				args: { path: "apps/desktop/src/bun/services/session-service.ts" },
				output: "Inspected session loading and identified the mock-session branch points.",
			},
			{
				name: "bash",
				args: { command: "git status --short --branch" },
				output: "Confirmed the feature branch and working tree status for the demo workflow.",
			},
			{
				name: "edit",
				args: { path: "apps/desktop/src/bun/services/mock-workflow-service.ts" },
				output: "Added deterministic playback steps, seeded diffs, and replay guards.",
			},
			{
				name: "write",
				args: { path: "AGENTS.md" },
				output: `Documented ${MOCK_WORKFLOW_ENV_VAR}=cursor-cloud-demo for future cloud agents.`,
			},
		]);
		if (!this.isRunCurrent(state, runVersion)) return false;

		const finalAssistant = clone(
			state.conversation.find((entry) => entry.id === assistantEntry.id) ?? assistantEntry,
		);
		finalAssistant.status = "done";
		this.upsertConversationEntry(state, finalAssistant);
		this.messenger.sessionEvent({
			type: "message_upsert",
			entry: clone(finalAssistant),
		});

		const postTurnCheckpoint = makeCheckpoint(
			sessionId,
			`mock-cp:${sessionId}:post-turn`,
			"post_turn",
			Date.now(),
			`mock-cp:${sessionId}:baseline`,
		);
		this.addCheckpoint(state, postTurnCheckpoint);
		this.messenger.sessionEvent({
			type: "checkpoint_created",
			checkpoint: clone(postTurnCheckpoint),
		});

		state.contextUsage = {
			sessionId,
			tokens: 6_412,
			contextWindow: 200_000,
			percent: 3.2,
		};
		this.messenger.sessionEvent({
			type: "context_usage",
			usage: clone(state.contextUsage),
		});

		state.session.status = "reviewing";
		state.session.reviewState = "discussing";
		this.touchSession(state);
		this.emitSessionSummary(state);
		this.messenger.diffInvalidated({ sessionId });
		return true;
	}

	abort(sessionId: string, options?: { silent?: boolean }) {
		const state = this.sessions.get(sessionId);
		if (!state) return false;
		this.clearTimers(state);
		state.runVersion += 1;
		if (state.session.status === "running") {
			state.session.status = state.conversation.length > 0 ? "reviewing" : "idle";
			state.session.reviewState =
				state.conversation.length > 0 ? "discussing" : "none";
			this.touchSession(state);
			this.emitSessionSummary(state);
		}
		if (!options?.silent) {
			this.messenger.toast({
				id: crypto.randomUUID(),
				title: "Mock workflow stopped",
				description: "Deterministic playback was interrupted.",
				variant: "info",
			});
		}
		return true;
	}

	createManualCheckpoint(sessionId: string) {
		const state = this.sessions.get(sessionId);
		if (!state) return null;
		const checkpoint = makeCheckpoint(
			sessionId,
			`mock-cp:${sessionId}:manual:${Date.now()}`,
			"manual",
			Date.now(),
			state.checkpoints[0]?.id,
		);
		this.addCheckpoint(state, checkpoint);
		state.inspector.checkpoints = [checkpoint, ...state.inspector.checkpoints];
		this.touchSession(state);
		return clone(checkpoint);
	}

	restoreCheckpoint(sessionId: string, checkpointId: string) {
		if (!this.sessions.has(sessionId)) return false;
		this.messenger.toast({
			id: crypto.randomUUID(),
			title: "Mock checkpoint",
			description: `Checkpoint ${checkpointId} is illustrative only in mock mode.`,
			variant: "info",
		});
		return true;
	}

	repairWorktree(sessionId: string) {
		if (!this.sessions.has(sessionId)) return false;
		this.messenger.toast({
			id: crypto.randomUUID(),
			title: "Mock workflow",
			description: "Worktree repair is not needed for the seeded demo session.",
			variant: "info",
		});
		return true;
	}

	private buildProjectSummary(): ProjectSummary {
		const sessions = Array.from(this.sessions.values());
		return {
			id: this.projectId,
			name: "Cursor cloud demo",
			rootPath: this.workspaceRoot,
			isGit: true,
			defaultBaseRef: "main",
			lastOpenedAt: Math.max(...sessions.map((state) => state.session.lastActivityAt)),
			sessionCount: sessions.filter((state) => !state.session.archivedAt).length,
			archivedSessionCount: sessions.filter((state) => Boolean(state.session.archivedAt)).length,
			metadata: {
				mockWorkflowId: CURSOR_CLOUD_DEMO_WORKFLOW_ID,
				mockWorkflowLabel: MOCK_WORKFLOW_BADGE,
				mockWorkflowEnvVar: MOCK_WORKFLOW_ENV_VAR,
			},
		};
	}

	private buildPiConfig(): PiConfigSummary {
		return {
			authConfigured: false,
			availableModels: [],
			settingsPath: appPaths.sessionStoreDir,
		};
	}

	private buildSessionState(displayName: string): MockSessionState {
		const sessionId = `mock-session:${CURSOR_CLOUD_DEMO_WORKFLOW_ID}:${crypto.randomUUID().slice(0, 8)}`;
		const baselineCheckpoint = makeCheckpoint(
			sessionId,
			`mock-cp:${sessionId}:baseline`,
			"baseline",
			Date.now() - 15_000,
		);
		const currentDiff = makeDiff(sessionId);
		const revisions = [
			makeRevision(sessionId, currentDiff.id, `mock-cp:${sessionId}:post-turn`),
		];
		return {
			projectId: this.projectId,
			session: {
				id: sessionId,
				projectId: this.projectId,
				piSessionId: `mock-pi:${sessionId}`,
				piSessionFile: `mock://sessions/${sessionId}.jsonl`,
				displayName,
				cwdPath: this.workspaceRoot,
				mode: "local",
				baseRef: "main",
				status: "idle",
				reviewState: "none",
				lastActivityAt: Date.now(),
				createdAt: Date.now(),
				unresolvedCommentCount: 1,
				changedFilesCount: 1,
				modelLabel: MOCK_MODEL_LABEL,
				metadata: {
					mockWorkflowId: CURSOR_CLOUD_DEMO_WORKFLOW_ID,
					mockWorkflowLabel: MOCK_WORKFLOW_BADGE,
					mockWorkflowEnvVar: MOCK_WORKFLOW_ENV_VAR,
					mockWorkflowReadOnly: true,
					mockWorkflowAutoReplay: true,
				},
			},
			conversation: [],
			toolActivity: [],
			checkpoints: [baselineCheckpoint],
			inspector: makeInspector(sessionId),
			contextUsage: undefined,
			revisions,
			currentDiff,
			autoReplayPending: true,
			runVersion: 0,
			timers: new Set(),
		};
	}

	private touchSession(state: MockSessionState) {
		state.session.lastActivityAt = Date.now();
	}

	private emitSessionSummary(state: MockSessionState) {
		this.messenger.sessionSummaryUpdated(clone(state.session));
	}

	private upsertConversationEntry(state: MockSessionState, entry: ConversationEntryView) {
		const index = state.conversation.findIndex((candidate) => candidate.id === entry.id);
		if (index === -1) {
			state.conversation.push(entry);
			return;
		}
		state.conversation[index] = entry;
	}

	private appendMessageDelta(state: MockSessionState, entryId: string, delta: string) {
		const entry = state.conversation.find((candidate) => candidate.id === entryId);
		if (!entry) return;
		entry.markdown = `${entry.markdown}${delta}`;
		entry.status = "streaming";
	}

	private updateToolActivity(state: MockSessionState, activity: ToolActivityView) {
		state.toolActivity = [
			activity,
			...state.toolActivity.filter((item) => item.toolCallId !== activity.toolCallId),
		].slice(0, 40);
	}

	private addCheckpoint(state: MockSessionState, checkpoint: CheckpointSummaryView) {
		if (state.checkpoints.some((candidate) => candidate.id === checkpoint.id)) return;
		state.checkpoints = [...state.checkpoints, checkpoint].sort(
			(a, b) => a.createdAt - b.createdAt,
		);
	}

	private async runToolSequence(
		state: MockSessionState,
		runVersion: number,
		tools: Array<{
			name: string;
			args: Record<string, unknown>;
			output: string;
		}>,
	) {
		for (const tool of tools) {
			await this.wait(state, runVersion, 1);
			if (!this.isRunCurrent(state, runVersion)) return;
			const toolCallId = `mock-tool:${state.session.id}:${runVersion}:${tool.name}`;
			const started: ToolActivityView = {
				id: crypto.randomUUID(),
				sessionId: state.session.id,
				toolCallId,
				toolName: tool.name,
				status: "started",
				argsSummary: JSON.stringify(tool.args),
				timestamp: Date.now(),
			};
			this.updateToolActivity(state, started);
			this.messenger.sessionEvent({
				type: "tool_activity",
				activity: clone(started),
			});

			await this.wait(state, runVersion, 1);
			if (!this.isRunCurrent(state, runVersion)) return;
			const streaming: ToolActivityView = {
				...started,
				status: "streaming",
				outputSnippet: tool.output.slice(0, 96),
			};
			this.updateToolActivity(state, streaming);
			this.messenger.sessionEvent({
				type: "tool_activity",
				activity: clone(streaming),
			});

			await this.wait(state, runVersion, 1);
			if (!this.isRunCurrent(state, runVersion)) return;
			const finished: ToolActivityView = {
				...streaming,
				status: "finished",
				outputSnippet: tool.output,
			};
			this.updateToolActivity(state, finished);
			this.messenger.sessionEvent({
				type: "tool_activity",
				activity: clone(finished),
			});

			const toolEntry: ConversationEntryView = {
				id: `mock-entry:${state.session.id}:tool:${toolCallId}`,
				sessionId: state.session.id,
				kind: "tool",
				timestamp: Date.now(),
				markdown: tool.output,
				status: "done",
				toolName: tool.name,
				toolInput: clone(tool.args),
				metadata: {
					mockWorkflowId: CURSOR_CLOUD_DEMO_WORKFLOW_ID,
				},
			};
			this.upsertConversationEntry(state, toolEntry);
			this.messenger.sessionEvent({
				type: "message_upsert",
				entry: clone(toolEntry),
			});
		}
	}

	private wait(state: MockSessionState, runVersion: number, steps: number) {
		return new Promise<void>((resolve) => {
			const timer = setTimeout(() => {
				state.timers.delete(timer);
				resolve();
			}, this.timelineStepMs * steps);
			state.timers.add(timer);
			if (!this.isRunCurrent(state, runVersion)) {
				clearTimeout(timer);
				state.timers.delete(timer);
				resolve();
			}
		});
	}

	private clearTimers(state: MockSessionState) {
		for (const timer of state.timers) {
			clearTimeout(timer);
		}
		state.timers.clear();
	}

	private isRunCurrent(state: MockSessionState, runVersion: number) {
		return state.runVersion === runVersion;
	}
}
