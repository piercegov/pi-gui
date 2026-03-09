import type { ElectrobunRPCSchema } from "electrobun";
import type {
	AppSettings,
	CheckpointSummaryView,
	CommentAnchor,
	CommentMessageView,
	CommentThreadView,
	DiffMode,
	DiffSnapshotView,
	GitStatusView,
	ModelCatalogSummary,
	PermissionPrompt,
	PermissionPromptResolution,
	ProjectSummary,
	ProjectPermissionPolicy,
	RevisionView,
	SessionHydration,
	SessionInspectorView,
	SessionStreamEvent,
	SessionSummary,
	ThreadResolution,
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
			updateProjectSettings: {
				params: { projectId: string; settings: Record<string, unknown> };
				response: ProjectSummary;
			};
			getProjectPermissionPolicy: {
				params: { projectId: string };
				response: ProjectPermissionPolicy;
			};
			updateProjectPermissionPolicy: {
				params: { projectId: string; policy: ProjectPermissionPolicy };
				response: ProjectPermissionPolicy;
			};
			resolvePermissionPrompt: {
				params: PermissionPromptResolution;
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
					modelProvider?: string;
					modelId?: string;
				};
				response: SessionSummary;
			};
			getModelCatalog: {
				params: { projectId: string };
				response: ModelCatalogSummary;
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
			buildRevisionDiff: {
				params: { sessionId: string; revisionNumber: number; mode: DiffMode };
				response: DiffSnapshotView;
			};
			buildSessionDiff: {
				params: { sessionId: string };
				response: DiffSnapshotView | null;
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
				params: { threadId: string; resolution: ThreadResolution };
				response: void;
			};
			reopenThread: {
				params: { threadId: string };
				response: void;
			};
			publishComments: {
				params: { sessionId: string };
				response: RevisionView;
			};
			startNextRevision: {
				params: { sessionId: string };
				response: RevisionView;
			};
			approveRevision: {
				params: { sessionId: string };
				response: void;
			};
			applyRevision: {
				params: { sessionId: string };
				response: void;
			};
			applyAndMerge: {
				params: { sessionId: string; commitMessage?: string };
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
			revisionUpdated: RevisionView;
			threadUpdated: CommentThreadView;
			diffInvalidated: {
				sessionId: string;
				revisionNumber?: number;
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
			permissionPrompt: PermissionPrompt;
		};
	};
};
