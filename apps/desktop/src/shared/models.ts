export type SessionMode = "worktree" | "local";

export type CheckpointKind =
	| "baseline"
	| "pre_turn"
	| "post_turn"
	| "review_start"
	| "alignment"
	| "revision"
	| "manual";

export type SessionStatus =
	| "idle"
	| "starting"
	| "running"
	| "reviewing"
	| "applying"
	| "completed"
	| "merged"
	| "error"
	| "archived";

export type ReviewState =
	| "none"
	| "reviewing"
	| "discussing"
	| "resolved"
	| "approved";

export type ThreadResolution = "no_changes" | "address_this";

export type RevisionState =
	| "active"
	| "discussing"
	| "resolved"
	| "superseded"
	| "approved";

export type DiffMode = "incremental" | "cumulative";

export type DiffScope =
	| "session_changes"
	| "branch_vs_base"
	| "staged"
	| "unstaged";

export type DiffViewMode = "split" | "unified";

export type ThreadStatus =
	| "open"
	| "agent_replied"
	| "needs_user"
	| "resolved"
	| "outdated";

export type CommentAuthorType = "user" | "agent" | "system";

export type DeliveryMode = "immediate" | "steer" | "follow_up" | "system";

export interface DiffFileStat {
	path: string;
	additions: number;
	deletions: number;
	type: "add" | "delete" | "modify" | "rename" | "copy";
	oldPath?: string;
}

export interface DiffStats {
	filesChanged: number;
	additions: number;
	deletions: number;
	fileStats: DiffFileStat[];
}

export interface CheckpointSummaryView {
	id: string;
	sessionId: string;
	kind: CheckpointKind;
	createdAt: number;
	gitHead?: string;
	gitTree?: string;
	parentCheckpointId?: string;
}

export interface SessionTreeNodeView {
	id: string;
	type: string;
	timestamp: number;
	label?: string;
	summary: string;
	isCurrent: boolean;
	children: SessionTreeNodeView[];
}

export interface ProjectSummary {
	id: string;
	name: string;
	rootPath: string;
	isGit: boolean;
	defaultBaseRef?: string;
	lastOpenedAt?: number;
	sessionCount: number;
	archivedSessionCount: number;
	metadata: Record<string, unknown>;
}

export interface SessionSummary {
	id: string;
	projectId: string;
	piSessionId: string;
	piSessionFile?: string;
	displayName: string;
	cwdPath: string;
	mode: SessionMode;
	worktreePath?: string;
	worktreeBranch?: string;
	baseRef?: string;
	status: SessionStatus;
	reviewState: ReviewState;
	lastActivityAt: number;
	createdAt: number;
	archivedAt?: number;
	unresolvedCommentCount: number;
	changedFilesCount: number;
	modelLabel?: string;
	lastError?: string;
	metadata: Record<string, unknown>;
}

export interface CommentAnchor {
	filePath: string;
	side: "old" | "new";
	line: number;
	hunkHeader: string;
	beforeContext: string[];
	targetLineText: string;
	afterContext: string[];
	checkpointId: string;
	diffSnapshotId: string;
}

export interface CommentMessageView {
	id: string;
	threadId: string;
	authorType: CommentAuthorType;
	bodyMarkdown: string;
	createdAt: number;
	deliveryMode?: DeliveryMode;
	metadata: Record<string, unknown>;
}

export interface CommentThreadView {
	id: string;
	reviewRoundId: string;
	sessionId: string;
	filePath: string;
	anchor: CommentAnchor;
	status: ThreadStatus;
	resolution?: ThreadResolution;
	createdAt: number;
	updatedAt: number;
	resolvedAt?: number;
	outdatedAt?: number;
	metadata: Record<string, unknown>;
	messages: CommentMessageView[];
}

export interface RevisionView {
	id: string;
	sessionId: string;
	revisionNumber: number;
	state: RevisionState;
	startedAt: number;
	checkpointId?: string;
	baselineCheckpointId?: string;
	approvedAt?: number;
	summaryMarkdown?: string;
	addressThisCount: number;
	noChangesCount: number;
	unresolvedCount: number;
	threads: CommentThreadView[];
	metadata: Record<string, unknown>;
}

export interface DiffSnapshotView {
	id: string;
	cacheKey: string;
	sessionId: string;
	scope: DiffScope;
	title: string;
	description: string;
	fromLabel: string;
	toLabel: string;
	fromCheckpointId?: string;
	toCheckpointId?: string;
	patch: string;
	stats: DiffStats;
	files: DiffFileStat[];
	createdAt: number;
	revisionNumber?: number;
	diffMode?: DiffMode;
}

export interface TranscriptAttachmentView {
	type: "image";
	mimeType: string;
	data: string;
}

export interface ConversationEntryView {
	id: string;
	sessionId: string;
	kind: "user" | "assistant" | "tool" | "system" | "review";
	timestamp: number;
	markdown: string;
	status: "streaming" | "done" | "error";
	toolName?: string;
	toolInput?: Record<string, unknown>;
	attachments?: TranscriptAttachmentView[];
	metadata: Record<string, unknown>;
}

export interface ToolActivityView {
	id: string;
	sessionId: string;
	toolCallId: string;
	toolName: string;
	status: "started" | "streaming" | "finished" | "error";
	argsSummary: string;
	outputSnippet?: string;
	timestamp: number;
}

export interface GitStatusView {
	sessionId: string;
	changedFiles: number;
	stagedFiles: number;
	unstagedFiles: number;
	hasMissingWorktree: boolean;
}

export interface PiConfigSummary {
	authConfigured: boolean;
	availableModels: string[];
	settingsPath?: string;
}

export interface ModelCatalogModel {
	provider: string;
	id: string;
	name: string;
	isAvailable: boolean;
}

export interface ModelCatalogSummary {
	activeProvider?: string;
	activeModelId?: string;
	providers: string[];
	models: ModelCatalogModel[];
}

export interface AppSettings {
	defaultDiffView: DiffViewMode;
	defaultSessionMode: SessionMode;
	defaultEditor: string;
	terminalShell: string;
	markdownFontSize: number;
	codeFontSize: number;
	archiveRetentionPolicy: "manual" | "30d" | "90d";
	showArchived: boolean;
	uiDensity: "compact" | "comfortable";
	accentColor: string;
	stateRunningColor: string;
	stateReviewColor: string;
	stateErrorColor: string;
	stateAppliedColor: string;
	environmentOverrides: Record<string, string>;
	shellEnvTimeoutMs: number;
}

export interface SessionHydration {
	project: ProjectSummary;
	session: SessionSummary;
	conversation: ConversationEntryView[];
	toolActivity: ToolActivityView[];
	checkpoints: CheckpointSummaryView[];
	revisions: RevisionView[];
	activeRevisionNumber?: number;
	currentDiff?: DiffSnapshotView;
	appSettings: AppSettings;
	contextUsage?: ContextUsageView;
	supportsEmbeddedTerminal: boolean;
	piConfig: PiConfigSummary;
}

export interface SessionInspectorView {
	sessionId: string;
	sessionFile?: string;
	parentSessionPath?: string;
	worktreeMissing: boolean;
	checkpoints: CheckpointSummaryView[];
	tree: SessionTreeNodeView[];
}

export interface ContextUsageView {
	sessionId: string;
	tokens: number | null;
	contextWindow: number;
	percent: number | null;
}

export interface ToastMessage {
	id: string;
	title: string;
	description?: string;
	variant: "info" | "success" | "warning" | "error";
}

export type PermissionEffect = "allow" | "deny";
export type PermissionAccess = "read" | "write";
export type CommandRisk = "read" | "write" | "destructive" | "unknown";

export interface CommandPermissionRule {
	id: string;
	effect: PermissionEffect;
	tokens: string[];
	risk: CommandRisk;
	createdAt: number;
}

export interface PathPermissionRule {
	id: string;
	effect: PermissionEffect;
	access: PermissionAccess;
	path: string;
	recursive: boolean;
	createdAt: number;
}

export interface ProjectPermissionPolicy {
	projectId: string;
	version: number;
	updatedAt: number;
	commandRules: CommandPermissionRule[];
	pathRules: PathPermissionRule[];
}

export type PermissionPromptDecision =
	| "allow_once"
	| "allow_always"
	| "deny_once"
	| "deny_always";

export interface PermissionPathScopeOption {
	id: string;
	label: string;
	path: string;
	recursive: boolean;
	description: string;
}

export interface PermissionPrompt {
	id: string;
	sessionId: string;
	projectId: string;
	toolName: "bash" | "read" | "edit" | "write";
	reason: "unknown_command" | "out_of_scope_path";
	message: string;
	command?: string;
	commandTokens?: string[];
	commandRisk?: CommandRisk;
	targetPath?: string;
	pathAccess?: PermissionAccess;
	pathScopes?: PermissionPathScopeOption[];
	createdAt: number;
}

export interface PermissionPromptResolution {
	promptId: string;
	decision: PermissionPromptDecision;
	selectedScopeId?: string;
}

export type SessionStreamEvent =
	| {
			type: "message_upsert";
			entry: ConversationEntryView;
	  }
	| {
			type: "message_delta";
			sessionId: string;
			entryId: string;
			delta: string;
	  }
	| {
			type: "tool_activity";
			activity: ToolActivityView;
	  }
	| {
			type: "review_notice";
			entry: ConversationEntryView;
	  }
	| {
			type: "checkpoint_created";
			checkpoint: CheckpointSummaryView;
	  }
	| {
			type: "context_usage";
			usage: ContextUsageView;
	  }
	| {
			type: "error";
			sessionId: string;
			message: string;
	  };

export interface ReviewReplyThreadPayload {
	threadId: string;
	disposition:
		| "acknowledged"
		| "needs_clarification"
		| "proposed_change"
		| "decline_change";
	reply: string;
	plan?: string[];
}

export interface ReviewReplyPayload {
	reviewRoundId: string;
	threads: ReviewReplyThreadPayload[];
	summary?: string;
}

export interface ReviewRoundPayload {
	reviewRoundId: string;
	objective: string;
	freezeWrites: boolean;
	threads: Array<{
		threadId: string;
		filePath: string;
		anchor: CommentAnchor;
		comments: Array<{
			author: CommentAuthorType;
			body: string;
			createdAt: number;
		}>;
	}>;
}
