import { create } from "zustand";
import type {
	CommentAnchor,
	CommentThreadView,
	DiffMode,
	DiffSnapshotView,
	RevisionView,
	SessionHydration,
	ThreadResolution,
} from "@shared/models";
import { rpc } from "@ui/lib/rpc-client";

type ReviewState = {
	sessionId?: string;
	revisions: RevisionView[];
	activeRevisionNumber?: number;
	selectedRevisionNumber?: number;
	diffMode: DiffMode;
	currentDiff?: DiffSnapshotView;
	diffStale: boolean;
	_diffRequestId: number;
	hydrate: (hydration: SessionHydration) => void;
	setSelectedRevision: (n: number) => void;
	setDiffMode: (mode: DiffMode) => void;
	buildRevisionDiff: (revisionNumber: number, mode: DiffMode) => Promise<void>;
	buildSessionDiffFallback: (sessionId: string) => Promise<void>;
	updateRevision: (revision: RevisionView) => void;
	updateThread: (thread: CommentThreadView) => void;
	createThread: (anchor: CommentAnchor, body: string) => Promise<void>;
	replyToThread: (threadId: string, body: string) => Promise<void>;
	resolveThread: (threadId: string, resolution: ThreadResolution) => Promise<void>;
	reopenThread: (threadId: string) => Promise<void>;
	publishComments: () => Promise<void>;
	startNextRevision: () => Promise<void>;
	approve: () => Promise<void>;
	applyRevision: () => Promise<void>;
	applyAndMerge: (commitMessage?: string) => Promise<void>;
	markStale: (sessionId: string, revisionNumber?: number) => void;
};

export const useReviewStore = create<ReviewState>((set, get) => ({
	sessionId: undefined,
	revisions: [],
	activeRevisionNumber: undefined,
	selectedRevisionNumber: undefined,
	diffMode: "incremental",
	currentDiff: undefined,
	diffStale: false,
	_diffRequestId: 0,
	hydrate(hydration) {
		const activeNum = hydration.activeRevisionNumber;
		set({
			sessionId: hydration.session.id,
			revisions: hydration.revisions,
			activeRevisionNumber: activeNum,
			selectedRevisionNumber: activeNum,
			diffMode: "incremental",
			currentDiff: hydration.currentDiff,
			diffStale: false,
		});
		if (!hydration.currentDiff && activeNum !== undefined) {
			void get().buildRevisionDiff(activeNum, "incremental");
		}
	},
	setSelectedRevision(n) {
		set({ selectedRevisionNumber: n });
		void get().buildRevisionDiff(n, get().diffMode);
	},
	setDiffMode(mode) {
		set({ diffMode: mode });
		const selectedRev = get().selectedRevisionNumber;
		if (selectedRev !== undefined) {
			void get().buildRevisionDiff(selectedRev, mode);
		}
	},
	async buildRevisionDiff(revisionNumber, mode) {
		const sessionId = get().sessionId;
		if (!sessionId) return;
		const requestId = get()._diffRequestId + 1;
		set({ _diffRequestId: requestId });
		try {
			const diff = await rpc.request.buildRevisionDiff({ sessionId, revisionNumber, mode });
			if (get()._diffRequestId !== requestId) return; // superseded
			set({
				currentDiff: diff,
				diffStale: false,
			});
		} catch {
			// Ignore errors
		}
	},
	async buildSessionDiffFallback(sessionId) {
		if (sessionId !== get().sessionId) return;
		const requestId = get()._diffRequestId + 1;
		set({ _diffRequestId: requestId });
		try {
			const diff = await rpc.request.buildSessionDiff({ sessionId });
			if (get()._diffRequestId !== requestId) return; // superseded
			set({
				currentDiff: diff ?? undefined,
				diffStale: false,
			});
		} catch {
			// Ignore errors
		}
	},
	updateRevision(revision) {
		set((state) => {
			if (state.sessionId && revision.sessionId !== state.sessionId) return state;
			const revisions = [...state.revisions];
			const index = revisions.findIndex((item) => item.id === revision.id);
			if (index === -1) revisions.push(revision);
			else revisions[index] = revision;
			revisions.sort((a, b) => a.revisionNumber - b.revisionNumber);
			const activeNum = revisions
				.filter((r) => ["active", "discussing", "resolved"].includes(r.state))
				.at(-1)?.revisionNumber;
			return {
				revisions,
				activeRevisionNumber: activeNum ?? state.activeRevisionNumber,
				selectedRevisionNumber: state.selectedRevisionNumber ?? activeNum,
			};
		});
	},
	updateThread(thread) {
		set((state) => {
			if (state.sessionId && thread.sessionId !== state.sessionId) return state;
			return {
			revisions: state.revisions.map((revision) =>
				revision.id !== thread.reviewRoundId
					? revision
					: {
							...revision,
							threads: revision.threads.some((item) => item.id === thread.id)
								? revision.threads.map((item) => (item.id === thread.id ? thread : item))
								: [...revision.threads, thread],
						},
			),
		};
		});
	},
	async createThread(anchor, body) {
		const state = get();
		const activeRevision = state.revisions.find(
			(r) => r.revisionNumber === state.activeRevisionNumber,
		);
		if (!activeRevision) return;
		await rpc.request.createThread({
			reviewRoundId: activeRevision.id,
			anchor,
			body,
		});
	},
	async replyToThread(threadId, body) {
		await rpc.request.replyToThread({ threadId, body });
	},
	async resolveThread(threadId, resolution) {
		await rpc.request.resolveThread({ threadId, resolution });
	},
	async reopenThread(threadId) {
		await rpc.request.reopenThread({ threadId });
	},
	async publishComments() {
		const sessionId = get().sessionId;
		if (!sessionId) return;
		const revision = await rpc.request.publishComments({ sessionId });
		get().updateRevision(revision);
	},
	async startNextRevision() {
		const sessionId = get().sessionId;
		if (!sessionId) return;
		const revision = await rpc.request.startNextRevision({ sessionId });
		get().updateRevision(revision);
		set({ selectedRevisionNumber: revision.revisionNumber });
	},
	async approve() {
		const sessionId = get().sessionId;
		if (!sessionId) return;
		await rpc.request.approveRevision({ sessionId });
	},
	async applyRevision() {
		const sessionId = get().sessionId;
		if (!sessionId) return;
		await rpc.request.applyRevision({ sessionId });
	},
	async applyAndMerge(commitMessage?: string) {
		const sessionId = get().sessionId;
		if (!sessionId) return;
		await rpc.request.applyAndMerge({ sessionId, commitMessage });
	},
	markStale(sessionId, _revisionNumber) {
		if (sessionId !== get().sessionId) return;
		set({ diffStale: true });
		const selectedRev = get().selectedRevisionNumber ?? get().activeRevisionNumber;
		if (selectedRev !== undefined) {
			void get().buildRevisionDiff(selectedRev, get().diffMode);
		} else {
			void get().buildSessionDiffFallback(sessionId);
		}
	},
}));
