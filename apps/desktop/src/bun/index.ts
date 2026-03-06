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
	diffScopeSummarySchema,
	diffSnapshotSchema,
	gitStatusSchema,
	projectSummarySchema,
	reviewRoundSchema,
	sessionInspectorSchema,
	sessionHydrationSchema,
	sessionStreamEventSchema,
	sessionSummarySchema,
	toastSchema,
} from "../shared/zod-schemas";
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
	reviewRoundUpdated(round) {
		sendToView("reviewRoundUpdated", reviewRoundSchema.parse(round));
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
};

const checkpoints = new CheckpointService(db, git);
const review = new ReviewService(db, settings, checkpoints, messenger);
const runtime = new PiRuntimeManager(messenger);
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

sessions.configureRuntimeHooks();
review.setRuntimeBridge(runtime);
review.setSessionRefresh(async (sessionId) => {
	const summary = await sessions.getSessionSummary(sessionId);
	if (summary) messenger.sessionSummaryUpdated(summary);
});
runtime.setReviewBridge({
	isFreezeActive: (sessionId) => review.isFreezeActive(sessionId),
	getActiveReviewRoundId: (sessionId) => review.getActiveReviewRoundId(sessionId),
	handleReviewReply: async (sessionId, payload) =>
		review.handleAgentReviewReply(sessionId, payload),
	buildReviewMarkdown: (reviewRoundId) => review.buildReviewMarkdown(reviewRoundId),
	buildAlignedOutcome: (reviewRoundId) =>
		review.buildAlignedOutcome(reviewRoundId),
	getSessionIdByReviewRound: (reviewRoundId) =>
		review.getSessionIdByReviewRound(reviewRoundId),
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
const buildDiffParamsSchema = z.object({
	sessionId: z.string(),
	scope: z.enum([
		"session_changes",
		"last_turn_changes",
		"review_round_changes",
		"since_alignment",
		"branch_vs_base",
		"staged",
		"unstaged",
	]),
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
const reviewRoundIdSchema = z.object({ reviewRoundId: z.string() });
const updateSettingsSchema = appSettingsSchema.partial();
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
			listSessions: async (params: unknown) =>
				z
					.array(sessionSummarySchema)
					.parse(await sessions.listSessions(projectIdSchema.parse(params).projectId)),
			createSession: async (params: unknown) =>
				sessionSummarySchema.parse(
					await sessions.createSession(createSessionParamsSchema.parse(params)),
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
			listDiffScopes: async (params: unknown) =>
				z
					.array(diffScopeSummarySchema)
					.parse(
						await sessions.listDiffScopes(sessionIdSchema.parse(params).sessionId),
					),
			buildDiff: async (params: unknown) =>
				diffSnapshotSchema.parse(
					await sessions.buildDiff(...(() => {
						const parsed = buildDiffParamsSchema.parse(params);
						return [parsed.sessionId, parsed.scope] as const;
					})()),
				),
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
				await review.resolveThread(replyThreadParamsSchema.pick({ threadId: true }).parse(params).threadId);
			},
			reopenThread: async (params: unknown) => {
				await review.reopenThread(replyThreadParamsSchema.pick({ threadId: true }).parse(params).threadId);
			},
			submitReview: async (params: unknown) =>
				reviewRoundSchema.parse(
					await review.submitReview(sessionIdSchema.parse(params).sessionId),
				),
			markAligned: async (params: unknown) => {
				await review.markAligned(reviewRoundIdSchema.parse(params).reviewRoundId);
			},
			applyAlignedChanges: async (params: unknown) => {
				await review.applyAlignedChanges(
					reviewRoundIdSchema.parse(params).reviewRoundId,
				);
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
			{ role: "toggleDevTools" },
			{ role: "togglefullscreen" },
		],
	},
	{
		label: "Window",
		submenu: [{ role: "minimize" }, { role: "zoom" }],
	},
]);

const url = await getMainViewUrl();

new BrowserWindow({
	title: "Pi GUI",
	url,
	frame: {
		width: 1480,
		height: 960,
		x: 140,
		y: 80,
	},
	titleBarStyle: "hiddenInset",
	rpc,
});
