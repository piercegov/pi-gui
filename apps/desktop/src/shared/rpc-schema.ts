import type { ElectrobunRPCSchema } from "electrobun";
import type {
	AppSettings,
	CheckpointSummaryView,
	CommentAnchor,
	CommentMessageView,
	CommentThreadView,
	DiffScope,
	DiffScopeSummary,
	DiffSnapshotView,
	GitStatusView,
	ProjectSummary,
	ReviewRoundView,
	SessionHydration,
	SessionInspectorView,
	SessionStreamEvent,
	SessionSummary,
	ToastMessage,
} from "./models";

export type AppRpcSchema = ElectrobunRPCSchema & {
	bun: {
		requests: {
			listProjects: {
				params: undefined;
				response: ProjectSummary[];
			};
			addProject: {
				params: { path: string };
				response: ProjectSummary;
			};
			pickProjectDirectory: {
				params: undefined;
				response: { path?: string };
			};
			removeProject: {
				params: { projectId: string };
				response: void;
			};
			openProjectInEditor: {
				params: { projectId: string };
				response: void;
			};
			revealProject: {
				params: { projectId: string };
				response: void;
			};
			listSessions: {
				params: { projectId: string };
				response: SessionSummary[];
			};
			createSession: {
				params: {
					projectId: string;
					name?: string;
					mode?: "worktree" | "local";
					baseRef?: string;
				};
				response: SessionSummary;
			};
			openSession: {
				params: { sessionId: string };
				response: SessionHydration;
			};
			getSessionInspector: {
				params: { sessionId: string };
				response: SessionInspectorView;
			};
			renameSession: {
				params: { sessionId: string; name: string };
				response: void;
			};
			archiveSession: {
				params: { sessionId: string; archived: boolean };
				response: void;
			};
			repairSessionWorktree: {
				params: { sessionId: string };
				response: void;
			};
			abortSession: {
				params: { sessionId: string };
				response: void;
			};
			sendPrompt: {
				params: { sessionId: string; text: string };
				response: void;
			};
			steerSession: {
				params: { sessionId: string; text: string };
				response: void;
			};
			followUpSession: {
				params: { sessionId: string; text: string };
				response: void;
			};
			listDiffScopes: {
				params: { sessionId: string };
				response: DiffScopeSummary[];
			};
			buildDiff: {
				params: { sessionId: string; scope: DiffScope };
				response: DiffSnapshotView;
			};
			createThread: {
				params: {
					reviewRoundId: string;
					anchor: CommentAnchor;
					body: string;
				};
				response: CommentThreadView;
			};
			replyToThread: {
				params: {
					threadId: string;
					body: string;
				};
				response: CommentMessageView;
			};
			resolveThread: {
				params: { threadId: string };
				response: void;
			};
			reopenThread: {
				params: { threadId: string };
				response: void;
			};
			submitReview: {
				params: { sessionId: string };
				response: ReviewRoundView;
			};
			markAligned: {
				params: { reviewRoundId: string };
				response: void;
			};
			applyAlignedChanges: {
				params: { reviewRoundId: string };
				response: void;
			};
			createManualCheckpoint: {
				params: { sessionId: string };
				response: CheckpointSummaryView;
			};
			restoreCheckpoint: {
				params: { sessionId: string; checkpointId: string };
				response: void;
			};
			getAppSettings: {
				params: undefined;
				response: AppSettings;
			};
			updateAppSettings: {
				params: Partial<AppSettings>;
				response: AppSettings;
			};
			openTerminal: {
				params: { sessionId: string };
				response: { terminalId: string };
			};
			resizeTerminal: {
				params: { terminalId: string; cols: number; rows: number };
				response: void;
			};
			writeTerminal: {
				params: { terminalId: string; data: string };
				response: void;
			};
			closeTerminal: {
				params: { terminalId: string };
				response: void;
			};
		};
		messages: {};
	};
	webview: {
		requests: {};
		messages: {
			sessionEvent: SessionStreamEvent;
			sessionSummaryUpdated: SessionSummary;
			reviewRoundUpdated: ReviewRoundView;
			threadUpdated: CommentThreadView;
			diffInvalidated: {
				sessionId: string;
				scope?: DiffScope;
			};
			terminalData: {
				terminalId: string;
				sessionId: string;
				data: string;
			};
			terminalExit: {
				terminalId: string;
				sessionId: string;
				exitCode: number;
			};
			gitStatusUpdated: GitStatusView;
			toast: ToastMessage;
		};
	};
};
