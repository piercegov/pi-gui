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
	selectSession: (sessionId: string) => void;
	loadSessions: (projectId: string) => Promise<void>;
	openSession: (sessionId: string) => Promise<SessionHydration>;
	loadInspector: (sessionId: string) => Promise<SessionInspectorView>;
	createSession: (
		projectId: string,
		options?: {
			name?: string;
			mode?: "worktree" | "local";
			baseRef?: string;
			modelProvider?: string;
			modelId?: string;
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
	applyCheckpointEvent: (checkpoint: CheckpointSummaryView) => void;
	upsertSummary: (summary: SessionSummary) => void;
	setHydration: (hydration: SessionHydration | undefined) => void;
};

function mergeHydratedCheckpoints(
	current: CheckpointSummaryView[],
	checkpoint: CheckpointSummaryView,
) {
	const next = current.filter((candidate) => candidate.id !== checkpoint.id);
	next.push(checkpoint);
	return next.sort((a, b) => b.createdAt - a.createdAt);
}

function mergeInspectorCheckpoints(
	current: CheckpointSummaryView[],
	checkpoint: CheckpointSummaryView,
) {
	return mergeHydratedCheckpoints(current, checkpoint);
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
	sessionsByProject: {},
	inspectorsBySession: {},
	selectedSessionId: undefined,
	currentHydration: undefined,
	loading: false,
	selectSession(sessionId) {
		set({
			selectedSessionId: sessionId,
			currentHydration: undefined,
		});
	},
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
		return await rpc.request.openSession({ sessionId });
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
	applyCheckpointEvent(checkpoint) {
		set((state) => {
			const currentHydration =
				state.currentHydration?.session.id === checkpoint.sessionId
					? {
							...state.currentHydration,
							checkpoints: mergeHydratedCheckpoints(
								state.currentHydration.checkpoints,
								checkpoint,
							),
						}
					: state.currentHydration;
			const currentInspector = state.inspectorsBySession[checkpoint.sessionId];
			return {
				currentHydration,
				inspectorsBySession: currentInspector
					? {
							...state.inspectorsBySession,
							[checkpoint.sessionId]: {
								...currentInspector,
								checkpoints: mergeInspectorCheckpoints(
									currentInspector.checkpoints,
									checkpoint,
								),
							},
						}
					: state.inspectorsBySession,
			};
		});
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
