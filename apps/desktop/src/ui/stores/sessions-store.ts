import { create } from "zustand";
import type {
	CheckpointSummaryView,
	SessionHydration,
	SessionInspectorView,
	SessionSummary,
} from "@shared/models";
import { rpc } from "@ui/lib/rpc-client";

type SessionsState = {
	sessionsByProject: Record<string, SessionSummary[]>;
	inspectorsBySession: Record<string, SessionInspectorView | undefined>;
	selectedSessionId?: string;
	currentHydration?: SessionHydration;
	loading: boolean;
	loadSessions: (projectId: string) => Promise<void>;
	openSession: (sessionId: string) => Promise<SessionHydration>;
	loadInspector: (sessionId: string) => Promise<SessionInspectorView>;
	createSession: (
		projectId: string,
		options?: {
			name?: string;
			mode?: "worktree" | "local";
			baseRef?: string;
		},
	) => Promise<SessionSummary>;
	renameSession: (sessionId: string, name: string) => Promise<void>;
	archiveSession: (
		sessionId: string,
		archived: boolean,
		projectId: string,
	) => Promise<void>;
	repairWorktree: (sessionId: string) => Promise<void>;
	createManualCheckpoint: (
		sessionId: string,
	) => Promise<CheckpointSummaryView | undefined>;
	upsertSummary: (summary: SessionSummary) => void;
	setHydration: (hydration: SessionHydration | undefined) => void;
};

export const useSessionsStore = create<SessionsState>((set, get) => ({
	sessionsByProject: {},
	inspectorsBySession: {},
	selectedSessionId: undefined,
	currentHydration: undefined,
	loading: false,
	async loadSessions(projectId) {
		set({ loading: true });
		const sessions = await rpc.request.listSessions({ projectId });
		set((state) => ({
			sessionsByProject: {
				...state.sessionsByProject,
				[projectId]: sessions,
			},
			loading: false,
			selectedSessionId:
				state.selectedSessionId ??
				sessions.find((session) => !session.archivedAt)?.id ??
				sessions[0]?.id,
		}));
	},
	async openSession(sessionId) {
		const hydration = await rpc.request.openSession({ sessionId });
		set({
			selectedSessionId: sessionId,
			currentHydration: hydration,
		});
		return hydration;
	},
	async loadInspector(sessionId) {
		const inspector = await rpc.request.getSessionInspector({ sessionId });
		set((state) => ({
			inspectorsBySession: {
				...state.inspectorsBySession,
				[sessionId]: inspector,
			},
		}));
		return inspector;
	},
	async createSession(projectId, options) {
		const session = await rpc.request.createSession({
			projectId,
			...options,
		});
		await get().loadSessions(projectId);
		return session;
	},
	async renameSession(sessionId, name) {
		await rpc.request.renameSession({ sessionId, name });
		const current = get().currentHydration;
		if (current?.session.id === sessionId) {
			set({
				currentHydration: {
					...current,
					session: {
						...current.session,
						displayName: name,
					},
				},
			});
		}
	},
	async archiveSession(sessionId, archived, projectId) {
		await rpc.request.archiveSession({ sessionId, archived });
		await get().loadSessions(projectId);
	},
	async repairWorktree(sessionId) {
		await rpc.request.repairSessionWorktree({ sessionId });
		await get().loadInspector(sessionId);
	},
	async createManualCheckpoint(sessionId) {
		const checkpoint = await rpc.request.createManualCheckpoint({ sessionId });
		await get().loadInspector(sessionId);
		return checkpoint;
	},
	upsertSummary(summary) {
		set((state) => {
			const projectSessions = state.sessionsByProject[summary.projectId] ?? [];
			const nextSessions = [...projectSessions];
			const index = nextSessions.findIndex((session) => session.id === summary.id);
			if (index === -1) nextSessions.unshift(summary);
			else nextSessions[index] = summary;
			return {
				sessionsByProject: {
					...state.sessionsByProject,
					[summary.projectId]: nextSessions,
				},
				currentHydration:
					state.currentHydration?.session.id === summary.id
						? {
								...state.currentHydration,
								session: summary,
							}
						: state.currentHydration,
			};
		});
	},
	setHydration(hydration) {
		set({ currentHydration: hydration });
	},
}));
