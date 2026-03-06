import { z } from "zod";

export const diffFileStatSchema = z.object({
	path: z.string(),
	additions: z.number().int(),
	deletions: z.number().int(),
	type: z.enum(["add", "delete", "modify", "rename", "copy"]),
	oldPath: z.string().optional(),
});

export const diffStatsSchema = z.object({
	filesChanged: z.number().int(),
	additions: z.number().int(),
	deletions: z.number().int(),
	fileStats: z.array(diffFileStatSchema),
});

export const checkpointKindSchema = z.enum([
	"baseline",
	"pre_turn",
	"post_turn",
	"review_start",
	"alignment",
	"revision",
	"manual",
]);

export const checkpointSummarySchema = z.object({
	id: z.string(),
	sessionId: z.string(),
	kind: checkpointKindSchema,
	createdAt: z.number().int(),
	gitHead: z.string().optional(),
	gitTree: z.string().optional(),
	parentCheckpointId: z.string().optional(),
});

export const sessionTreeNodeSchema: z.ZodType<{
	id: string;
	type: string;
	timestamp: number;
	label?: string;
	summary: string;
	isCurrent: boolean;
	children: Array<{
		id: string;
		type: string;
		timestamp: number;
		label?: string;
		summary: string;
		isCurrent: boolean;
		children: unknown[];
	}>;
}> = z.lazy(() =>
	z.object({
		id: z.string(),
		type: z.string(),
		timestamp: z.number().int(),
		label: z.string().optional(),
		summary: z.string(),
		isCurrent: z.boolean(),
		children: z.array(sessionTreeNodeSchema),
	}),
);

export const projectSummarySchema = z.object({
	id: z.string(),
	name: z.string(),
	rootPath: z.string(),
	isGit: z.boolean(),
	defaultBaseRef: z.string().optional(),
	lastOpenedAt: z.number().int().optional(),
	sessionCount: z.number().int(),
	archivedSessionCount: z.number().int(),
	metadata: z.record(z.string(), z.unknown()),
});

export const threadResolutionSchema = z.enum(["no_changes", "address_this"]);

export const diffModeSchema = z.enum(["incremental", "cumulative"]);

export const revisionStateSchema = z.enum([
	"active",
	"discussing",
	"resolved",
	"superseded",
	"approved",
]);

export const sessionSummarySchema = z.object({
	id: z.string(),
	projectId: z.string(),
	piSessionId: z.string(),
	piSessionFile: z.string().optional(),
	displayName: z.string(),
	cwdPath: z.string(),
	mode: z.enum(["worktree", "local"]),
	worktreePath: z.string().optional(),
	worktreeBranch: z.string().optional(),
	baseRef: z.string().optional(),
	status: z.enum([
		"idle",
		"starting",
		"running",
		"reviewing",
		"applying",
		"completed",
		"merged",
		"error",
		"archived",
	]),
	reviewState: z.enum([
		"none",
		"reviewing",
		"discussing",
		"resolved",
		"approved",
	]),
	lastActivityAt: z.number().int(),
	createdAt: z.number().int(),
	archivedAt: z.number().int().optional(),
	unresolvedCommentCount: z.number().int(),
	changedFilesCount: z.number().int(),
	modelLabel: z.string().optional(),
	lastError: z.string().optional(),
	metadata: z.record(z.string(), z.unknown()),
});

export const commentAnchorSchema = z.object({
	filePath: z.string(),
	side: z.enum(["old", "new"]),
	line: z.number().int(),
	hunkHeader: z.string(),
	beforeContext: z.array(z.string()),
	targetLineText: z.string(),
	afterContext: z.array(z.string()),
	checkpointId: z.string(),
	diffSnapshotId: z.string(),
});

export const commentMessageSchema = z.object({
	id: z.string(),
	threadId: z.string(),
	authorType: z.enum(["user", "agent", "system"]),
	bodyMarkdown: z.string(),
	createdAt: z.number().int(),
	deliveryMode: z
		.enum(["immediate", "steer", "follow_up", "system"])
		.optional(),
	metadata: z.record(z.string(), z.unknown()),
});

export const commentThreadSchema = z.object({
	id: z.string(),
	reviewRoundId: z.string(),
	sessionId: z.string(),
	filePath: z.string(),
	anchor: commentAnchorSchema,
	status: z.enum([
		"open",
		"agent_replied",
		"needs_user",
		"resolved",
		"outdated",
	]),
	resolution: threadResolutionSchema.optional(),
	createdAt: z.number().int(),
	updatedAt: z.number().int(),
	resolvedAt: z.number().int().optional(),
	outdatedAt: z.number().int().optional(),
	metadata: z.record(z.string(), z.unknown()),
	messages: z.array(commentMessageSchema),
});

export const revisionSchema = z.object({
	id: z.string(),
	sessionId: z.string(),
	revisionNumber: z.number().int(),
	state: revisionStateSchema,
	startedAt: z.number().int(),
	checkpointId: z.string().optional(),
	baselineCheckpointId: z.string().optional(),
	approvedAt: z.number().int().optional(),
	summaryMarkdown: z.string().optional(),
	addressThisCount: z.number().int(),
	noChangesCount: z.number().int(),
	unresolvedCount: z.number().int(),
	threads: z.array(commentThreadSchema),
	metadata: z.record(z.string(), z.unknown()),
});

export const diffScopeSchema = z.enum([
	"session_changes",
	"branch_vs_base",
	"staged",
	"unstaged",
]);

export const diffSnapshotSchema = z.object({
	id: z.string(),
	sessionId: z.string(),
	scope: diffScopeSchema,
	title: z.string(),
	description: z.string(),
	fromLabel: z.string(),
	toLabel: z.string(),
	fromCheckpointId: z.string().optional(),
	toCheckpointId: z.string().optional(),
	patch: z.string(),
	stats: diffStatsSchema,
	files: z.array(diffFileStatSchema),
	createdAt: z.number().int(),
	revisionNumber: z.number().int().optional(),
	diffMode: diffModeSchema.optional(),
});

export const transcriptAttachmentSchema = z.object({
	type: z.literal("image"),
	mimeType: z.string(),
	data: z.string(),
});

export const conversationEntrySchema = z.object({
	id: z.string(),
	sessionId: z.string(),
	kind: z.enum(["user", "assistant", "tool", "system", "review"]),
	timestamp: z.number().int(),
	markdown: z.string(),
	status: z.enum(["streaming", "done", "error"]),
	toolName: z.string().optional(),
	toolInput: z.record(z.string(), z.unknown()).optional(),
	attachments: z.array(transcriptAttachmentSchema).optional(),
	metadata: z.record(z.string(), z.unknown()),
});

export const toolActivitySchema = z.object({
	id: z.string(),
	sessionId: z.string(),
	toolCallId: z.string(),
	toolName: z.string(),
	status: z.enum(["started", "streaming", "finished", "error"]),
	argsSummary: z.string(),
	outputSnippet: z.string().optional(),
	timestamp: z.number().int(),
});

export const gitStatusSchema = z.object({
	sessionId: z.string(),
	changedFiles: z.number().int(),
	stagedFiles: z.number().int(),
	unstagedFiles: z.number().int(),
	hasMissingWorktree: z.boolean(),
});

export const piConfigSummarySchema = z.object({
	authConfigured: z.boolean(),
	availableModels: z.array(z.string()),
	settingsPath: z.string().optional(),
});

export const appSettingsSchema = z.object({
	defaultDiffView: z.enum(["split", "unified"]),
	defaultSessionMode: z.enum(["worktree", "local"]),
	defaultEditor: z.string(),
	terminalShell: z.string(),
	markdownFontSize: z.number().int(),
	codeFontSize: z.number().int(),
	archiveRetentionPolicy: z.enum(["manual", "30d", "90d"]),
	showArchived: z.boolean(),
	uiDensity: z.enum(["compact", "comfortable"]),
	environmentOverrides: z.record(z.string(), z.string()).optional(),
	shellEnvTimeoutMs: z.number().int().optional(),
});

export const sessionHydrationSchema = z.object({
	project: projectSummarySchema,
	session: sessionSummarySchema,
	conversation: z.array(conversationEntrySchema),
	toolActivity: z.array(toolActivitySchema),
	checkpoints: z.array(checkpointSummarySchema),
	revisions: z.array(revisionSchema),
	activeRevisionNumber: z.number().int().optional(),
	currentDiff: diffSnapshotSchema.optional(),
	appSettings: appSettingsSchema,
	supportsEmbeddedTerminal: z.boolean(),
	piConfig: piConfigSummarySchema,
});

export const sessionInspectorSchema = z.object({
	sessionId: z.string(),
	sessionFile: z.string().optional(),
	parentSessionPath: z.string().optional(),
	worktreeMissing: z.boolean(),
	checkpoints: z.array(checkpointSummarySchema),
	tree: z.array(sessionTreeNodeSchema),
});

export const toastSchema = z.object({
	id: z.string(),
	title: z.string(),
	description: z.string().optional(),
	variant: z.enum(["info", "success", "warning", "error"]),
});

export const sessionStreamEventSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("message_upsert"),
		entry: conversationEntrySchema,
	}),
	z.object({
		type: z.literal("message_delta"),
		sessionId: z.string(),
		entryId: z.string(),
		delta: z.string(),
	}),
	z.object({
		type: z.literal("tool_activity"),
		activity: toolActivitySchema,
	}),
	z.object({
		type: z.literal("review_notice"),
		entry: conversationEntrySchema,
	}),
	z.object({
		type: z.literal("checkpoint_created"),
		checkpoint: checkpointSummarySchema,
	}),
	z.object({
		type: z.literal("error"),
		sessionId: z.string(),
		message: z.string(),
	}),
]);

export const reviewReplyThreadSchema = z.object({
	threadId: z.string(),
	disposition: z.enum([
		"acknowledged",
		"needs_clarification",
		"proposed_change",
		"decline_change",
	]),
	reply: z.string(),
	plan: z.array(z.string()).optional(),
});

export const reviewReplyPayloadSchema = z.object({
	reviewRoundId: z.string(),
	threads: z.array(reviewReplyThreadSchema),
	summary: z.string().optional(),
});

export const reviewRoundPayloadSchema = z.object({
	reviewRoundId: z.string(),
	objective: z.string(),
	freezeWrites: z.boolean(),
	threads: z.array(
		z.object({
			threadId: z.string(),
			filePath: z.string(),
			anchor: commentAnchorSchema,
			comments: z.array(
				z.object({
					author: z.enum(["user", "agent", "system"]),
					body: z.string(),
					createdAt: z.number().int(),
				}),
			),
		}),
	),
});
