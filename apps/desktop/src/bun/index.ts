import {
	ApplicationMenu,
	BrowserWindow,
	Updater,
	Utils,
	defineElectrobunRPC,
} from "electrobun/bun";
import { z } from "zod";
import type { AppRpcSchema } from "../shared/rpc-schema";
import {
	appSettingsSchema,
	checkpointSummarySchema,
	commentMessageSchema,
	commentThreadSchema,
	diffModeSchema,
	diffSnapshotSchema,
	gitStatusSchema,
	modelCatalogSummarySchema,
	permissionPromptResolutionSchema,
	permissionPromptSchema,
	projectSummarySchema,
	projectPermissionPolicySchema,
	revisionSchema,
	sessionInspectorSchema,
	sessionHydrationSchema,
	sessionStreamEventSchema,
	sessionSummarySchema,
	threadResolutionSchema,
	toastSchema,
} from "../shared/zod-schemas";
import { resolveShellEnvironment } from "./services/shell-env";
import { AppDb } from "./services/db";
import { GitService } from "./services/git-service";
import { ProjectService } from "./services/project-service";
import { SettingsService } from "./services/settings-service";
import { CheckpointService } from "./services/checkpoint-service";
import { ReviewService } from "./services/review-service";
import { PiRuntimeManager } from "./pi/runtime-manager";
import { SessionService } from "./services/session-service";
import { TerminalService } from "./services/terminal-service";
import type { HostMessenger } from "./services/host-messenger";
import { PermissionService } from "./services/permission-service";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

async function getMainViewUrl(): Promise<string> {
	const channel = await Updater.localInfo.channel();
	if (channel === "dev") {
		try {
			await fetch(DEV_SERVER_URL, { method: "HEAD" });
			return DEV_SERVER_URL;
		} catch {
			return "views://mainview/index.html";
		}
	}
	return "views://mainview/index.html";
}

const db = new AppDb();
const git = new GitService();
const settings = new SettingsService(db);

// Resolve the user's full shell environment before initializing remaining services.
// macOS GUI apps receive a minimal PATH from launchd; this captures the real
// PATH from the user's login shell so tools like git, zoxide, starship, and
// Homebrew binaries are available to all spawned processes.
await resolveShellEnvironment(settings.getAppSettings().shellEnvTimeoutMs);

const projects = new ProjectService(db, git);
let rpc = null as unknown as ReturnType<typeof defineElectrobunRPC<AppRpcSchema>>;
const sendToView = (
	message: keyof AppRpcSchema["webview"]["messages"],
	payload: unknown,
) => {
	(
		rpc.send as unknown as (
			message: keyof AppRpcSchema["webview"]["messages"],
			payload: unknown,
		) => void
	)(message, payload);
};

const messenger: HostMessenger = {
	sessionEvent(event) {
		sendToView("sessionEvent", sessionStreamEventSchema.parse(event));
	},
	sessionSummaryUpdated(summary) {
		sendToView("sessionSummaryUpdated", sessionSummarySchema.parse(summary));
	},
	revisionUpdated(revision) {
		sendToView("revisionUpdated", revisionSchema.parse(revision));
	},
	threadUpdated(thread) {
		sendToView("threadUpdated", commentThreadSchema.parse(thread));
	},
	diffInvalidated(payload) {
		sendToView("diffInvalidated", payload);
	},
	terminalData(payload) {
		sendToView("terminalData", payload);
	},
	terminalExit(payload) {
		sendToView("terminalExit", payload);
	},
	gitStatusUpdated(payload) {
		sendToView("gitStatusUpdated", gitStatusSchema.parse(payload));
	},
	toast(toast) {
		sendToView("toast", toastSchema.parse(toast));
	},
	permissionPrompt(prompt) {
		sendToView("permissionPrompt", permissionPromptSchema.parse(prompt));
	},
};

const checkpoints = new CheckpointService(db, git);
const review = new ReviewService(db, checkpoints, git, messenger);
const runtime = new PiRuntimeManager(messenger, settings);
const permissions = new PermissionService(db, messenger);
const sessions = new SessionService(
	db,
	projects,
	git,
	checkpoints,
	review,
	settings,
	runtime,
	messenger,
);
const terminals = new TerminalService(messenger);

sessions.resetStaleStatuses();
sessions.configureRuntimeHooks();
review.setRuntimeBridge(runtime);
review.setSessionRefresh(async (sessionId) => {
	const summary = await sessions.getSessionSummary(sessionId);
	if (summary) messenger.sessionSummaryUpdated(summary);
});
runtime.setReviewBridge({
	isFreezeActive: (sessionId) => review.isFreezeActive(sessionId),
	getActiveRevisionId: (sessionId) => review.getActiveRevisionId(sessionId),
	handleReviewReply: async (sessionId, payload) =>
		review.handleAgentReviewReply(sessionId, payload),
	buildReviewMarkdown: (reviewRoundId) => review.buildReviewMarkdown(reviewRoundId),
	getSessionIdByReviewRound: (reviewRoundId) =>
		review.getSessionIdByReviewRound(reviewRoundId),
});
runtime.setPermissionBridge({
	authorizeToolCall: async (params) => permissions.authorizeToolCall(params),
});

const addProjectParamsSchema = z.object({ path: z.string() });
const pickProjectDirectoryResponseSchema = z.object({ path: z.string().optional() });
const projectIdSchema = z.object({ projectId: z.string() });
const sessionIdSchema = z.object({ sessionId: z.string() });
const createSessionParamsSchema = z.object({
	projectId: z.string(),
	name: z.string().optional(),
	mode: z.enum(["worktree", "local"]).optional(),
	baseRef: z.string().optional(),
	modelProvider: z.string().optional(),
	modelId: z.string().optional(),
});
const renameSessionParamsSchema = z.object({
	sessionId: z.string(),
	name: z.string(),
});
const archiveSessionParamsSchema = z.object({
	sessionId: z.string(),
	archived: z.boolean(),
});
const promptParamsSchema = z.object({
	sessionId: z.string(),
	text: z.string(),
});
const buildRevisionDiffParamsSchema = z.object({
	sessionId: z.string(),
	revisionNumber: z.number().int(),
	mode: diffModeSchema,
});
const createThreadParamsSchema = z.object({
	reviewRoundId: z.string(),
	anchor: z.object({
		filePath: z.string(),
		side: z.enum(["old", "new"]),
		line: z.number().int(),
		hunkHeader: z.string(),
		beforeContext: z.array(z.string()),
		targetLineText: z.string(),
		afterContext: z.array(z.string()),
		checkpointId: z.string(),
		diffSnapshotId: z.string(),
	}),
	body: z.string(),
});
const replyThreadParamsSchema = z.object({
	threadId: z.string(),
	body: z.string(),
});
const resolveThreadParamsSchema = z.object({
	threadId: z.string(),
	resolution: threadResolutionSchema,
});
const updateSettingsSchema = appSettingsSchema.partial();
const updateProjectSettingsSchema = z.object({
	projectId: z.string(),
	settings: z.record(z.string(), z.unknown()),
});
const updateProjectPermissionPolicySchema = z.object({
	projectId: z.string(),
	policy: projectPermissionPolicySchema,
});
const terminalOpenSchema = sessionIdSchema;
const terminalResizeSchema = z.object({
	terminalId: z.string(),
	cols: z.number().int(),
	rows: z.number().int(),
});
const terminalWriteSchema = z.object({
	terminalId: z.string(),
	data: z.string(),
});
const terminalCloseSchema = z.object({
	terminalId: z.string(),
});

rpc = defineElectrobunRPC<AppRpcSchema>("bun", {
	handlers: {
		requests: {
			listProjects: async () =>
				z.array(projectSummarySchema).parse(projects.listProjects()),
			addProject: async (params: unknown) =>
				projectSummarySchema.parse(
					await projects.addProject(addProjectParamsSchema.parse(params).path),
				),
			pickProjectDirectory: async () => {
				const [path] = (
					await Utils.openFileDialog({
						canChooseFiles: false,
						canChooseDirectory: true,
						allowsMultipleSelection: false,
					})
				).filter(Boolean);
				return pickProjectDirectoryResponseSchema.parse({
					path: path || undefined,
				});
			},
			removeProject: async (params: unknown) => {
				projects.removeProject(projectIdSchema.parse(params).projectId);
			},
			openProjectInEditor: async (params: unknown) => {
				await sessions.openProjectInEditor(
					projectIdSchema.parse(params).projectId,
					settings.getAppSettings(),
				);
			},
			revealProject: async (params: unknown) => {
				sessions.revealProject(projectIdSchema.parse(params).projectId);
			},
			updateProjectSettings: async (params: unknown) => {
				const parsed = updateProjectSettingsSchema.parse(params);
				return projectSummarySchema.parse(
					projects.updateProjectMetadata(parsed.projectId, parsed.settings),
				);
			},
			getProjectPermissionPolicy: async (params: unknown) =>
				projectPermissionPolicySchema.parse(
					permissions.getProjectPermissionPolicy(
						projectIdSchema.parse(params).projectId,
					),
				),
			updateProjectPermissionPolicy: async (params: unknown) => {
				const parsed = updateProjectPermissionPolicySchema.parse(params);
				return projectPermissionPolicySchema.parse(
					permissions.updateProjectPermissionPolicy(
						parsed.projectId,
						parsed.policy,
					),
				);
			},
			resolvePermissionPrompt: async (params: unknown) => {
				permissions.resolvePrompt(permissionPromptResolutionSchema.parse(params));
			},
			listSessions: async (params: unknown) =>
				z
					.array(sessionSummarySchema)
					.parse(await sessions.listSessions(projectIdSchema.parse(params).projectId)),
			createSession: async (params: unknown) =>
				sessionSummarySchema.parse(
					await sessions.createSession(createSessionParamsSchema.parse(params)),
				),
			getModelCatalog: async (params: unknown) =>
				modelCatalogSummarySchema.parse(
					await sessions.getModelCatalog(projectIdSchema.parse(params).projectId),
				),
			openSession: async (params: unknown) =>
				sessionHydrationSchema.parse(
					await sessions.openSession(sessionIdSchema.parse(params).sessionId),
				),
			getSessionInspector: async (params: unknown) =>
				sessionInspectorSchema.parse(
					await sessions.getSessionInspector(
						sessionIdSchema.parse(params).sessionId,
					),
				),
			renameSession: async (params: unknown) => {
				const parsed = renameSessionParamsSchema.parse(params);
				await sessions.renameSession(parsed.sessionId, parsed.name);
			},
			archiveSession: async (params: unknown) => {
				const parsed = archiveSessionParamsSchema.parse(params);
				await sessions.archiveSession(parsed.sessionId, parsed.archived);
			},
			repairSessionWorktree: async (params: unknown) => {
				await sessions.repairSessionWorktree(
					sessionIdSchema.parse(params).sessionId,
				);
			},
			abortSession: async (params: unknown) => {
				await sessions.abortSession(sessionIdSchema.parse(params).sessionId);
			},
			sendPrompt: async (params: unknown) => {
				const parsed = promptParamsSchema.parse(params);
				await sessions.sendPrompt(parsed.sessionId, parsed.text);
			},
			steerSession: async (params: unknown) => {
				const parsed = promptParamsSchema.parse(params);
				await sessions.steerSession(parsed.sessionId, parsed.text);
			},
			followUpSession: async (params: unknown) => {
				const parsed = promptParamsSchema.parse(params);
				await sessions.followUpSession(parsed.sessionId, parsed.text);
			},
			buildRevisionDiff: async (params: unknown) => {
				const parsed = buildRevisionDiffParamsSchema.parse(params);
				return diffSnapshotSchema.parse(
					await sessions.buildRevisionDiff(parsed.sessionId, parsed.revisionNumber, parsed.mode),
				);
			},
			buildSessionDiff: async (params: unknown) => {
				const parsed = sessionIdSchema.parse(params);
				const result = await sessions.buildSessionDiff(parsed.sessionId);
				return result ? diffSnapshotSchema.parse(result) : null;
			},
			createThread: async (params: unknown) => {
				const parsed = createThreadParamsSchema.parse(params);
				return commentThreadSchema.parse(
					await review.createThread(parsed.reviewRoundId, parsed.anchor, parsed.body),
				);
			},
			replyToThread: async (params: unknown) => {
				const parsed = replyThreadParamsSchema.parse(params);
				return commentMessageSchema.parse(
					await review.replyToThread(parsed.threadId, parsed.body),
				);
			},
			resolveThread: async (params: unknown) => {
				const parsed = resolveThreadParamsSchema.parse(params);
				await review.resolveThread(parsed.threadId, parsed.resolution);
			},
			reopenThread: async (params: unknown) => {
				await replyThreadParamsSchema.pick({ threadId: true }).parse(params);
				const parsed = z.object({ threadId: z.string() }).parse(params);
				await review.reopenThread(parsed.threadId);
			},
			publishComments: async (params: unknown) =>
				revisionSchema.parse(
					await review.publishComments(sessionIdSchema.parse(params).sessionId),
				),
			startNextRevision: async (params: unknown) =>
				revisionSchema.parse(
					await review.startNextRevision(sessionIdSchema.parse(params).sessionId),
				),
			approveRevision: async (params: unknown) => {
				await review.approveRevision(sessionIdSchema.parse(params).sessionId);
			},
			applyRevision: async (params: unknown) => {
				await review.applyRevision(sessionIdSchema.parse(params).sessionId);
			},
			applyAndMerge: async (params: unknown) => {
				const parsed = z.object({ sessionId: z.string(), commitMessage: z.string().optional() }).parse(params);
				await review.applyAndMerge(parsed.sessionId, parsed.commitMessage);
			},
			createManualCheckpoint: async (params: unknown) =>
				checkpointSummarySchema.parse(
					await sessions.createManualCheckpoint(
						sessionIdSchema.parse(params).sessionId,
					),
				),
			restoreCheckpoint: async (params: unknown) => {
				const parsed = z.object({ sessionId: z.string(), checkpointId: z.string() }).parse(params);
				await sessions.restoreCheckpoint(parsed.sessionId, parsed.checkpointId);
			},
			getAppSettings: async () => appSettingsSchema.parse(settings.getAppSettings()),
			updateAppSettings: async (params: unknown) =>
				appSettingsSchema.parse(
					settings.updateAppSettings(updateSettingsSchema.parse(params)),
				),
			openTerminal: async (params: unknown) => {
				const parsed = terminalOpenSchema.parse(params);
				const summary = await sessions.getSessionSummary(parsed.sessionId);
				if (!summary) throw new Error("Session not found.");
				return terminals.open({
					sessionId: parsed.sessionId,
					cwd: summary.cwdPath,
					shell: settings.getAppSettings().terminalShell,
				});
			},
			resizeTerminal: async (params: unknown) => {
				const parsed = terminalResizeSchema.parse(params);
				terminals.resize(parsed.terminalId, parsed.cols, parsed.rows);
			},
			writeTerminal: async (params: unknown) => {
				const parsed = terminalWriteSchema.parse(params);
				terminals.write(parsed.terminalId, parsed.data);
			},
			closeTerminal: async (params: unknown) => {
				terminals.close(terminalCloseSchema.parse(params).terminalId);
			},
		},
		messages: {},
	},
});

ApplicationMenu.setApplicationMenu([
	{
		label: "Pi GUI",
		submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }],
	},
	{
		label: "Edit",
		submenu: [
			{ role: "undo" },
			{ role: "redo" },
			{ type: "separator" },
			{ role: "cut" },
			{ role: "copy" },
			{ role: "paste" },
			{ role: "selectAll" },
		],
	},
	{
		label: "View",
		submenu: [
			{ role: "reload" },
			{ role: "toggleFullScreen" },
		],
	},
	{
		label: "Window",
		submenu: [{ role: "minimize" }, { role: "zoom" }],
	},
]);

const url = await getMainViewUrl();
const titleBarStyle =
	process.platform === "darwin"
		? "hiddenInset"
		: process.platform === "linux"
			? "hidden"
			: "default";

new BrowserWindow({
	title: "Pi GUI",
	url,
	renderer: process.platform === "linux" ? "cef" : undefined,
	frame: {
		width: 1480,
		height: 960,
		x: 140,
		y: 80,
	},
	titleBarStyle,
	rpc,
});
