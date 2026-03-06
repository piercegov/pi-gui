import { create } from "zustand";
import type {
	CommentAnchor,
	CommentThreadView,
	DiffScope,
	DiffScopeSummary,
	DiffSnapshotView,
	ReviewRoundView,
	SessionHydration,
} from "@shared/models";
import { rpc } from "@ui/lib/rpc-client";

type ReviewState = {
	sessionId?: string;
	diffScopes: DiffScopeSummary[];
	currentScope?: DiffScope;
	currentDiff?: DiffSnapshotView;
	reviewRounds: ReviewRoundView[];
	activeReviewRoundId?: string;
	diffStale: boolean;
	hydrate: (hydration: SessionHydration) => void;
	buildDiff: (scope: DiffScope) => Promise<void>;
	updateRound: (round: ReviewRoundView) => void;
	updateThread: (thread: CommentThreadView) => void;
	createThread: (anchor: CommentAnchor, body: string) => Promise<void>;
	replyToThread: (threadId: string, body: string) => Promise<void>;
	resolveThread: (threadId: string) => Promise<void>;
	reopenThread: (threadId: string) => Promise<void>;
	submitReview: () => Promise<void>;
	markAligned: () => Promise<void>;
	applyAlignedChanges: () => Promise<void>;
	markStale: (sessionId: string, scope?: DiffScope) => void;
};

export const useReviewStore = create<ReviewState>((set, get) => ({
	sessionId: undefined,
	diffScopes: [],
	currentScope: undefined,
	currentDiff: undefined,
	reviewRounds: [],
	activeReviewRoundId: undefined,
	diffStale: false,
	hydrate(hydration) {
		set({
			sessionId: hydration.session.id,
			diffScopes: hydration.diffScopes,
			currentDiff: hydration.currentDiff,
			currentScope: hydration.currentDiff?.scope,
			reviewRounds: hydration.reviewRounds,
			activeReviewRoundId: hydration.activeReviewRoundId,
			diffStale: false,
		});
	},
	async buildDiff(scope) {
		const sessionId = get().sessionId;
		if (!sessionId) return;
		const diff = await rpc.request.buildDiff({ sessionId, scope });
		set({
			currentDiff: diff,
			currentScope: scope,
			diffStale: false,
		});
	},
	updateRound(round) {
		set((state) => {
			const reviewRounds = [...state.reviewRounds];
			const index = reviewRounds.findIndex((item) => item.id === round.id);
			if (index === -1) reviewRounds.unshift(round);
			else reviewRounds[index] = round;
			return {
				reviewRounds,
				activeReviewRoundId:
					state.activeReviewRoundId ?? round.id,
			};
		});
	},
	updateThread(thread) {
		set((state) => ({
			reviewRounds: state.reviewRounds.map((round) =>
				round.id !== thread.reviewRoundId
					? round
					: {
							...round,
							threads: round.threads.some((item) => item.id === thread.id)
								? round.threads.map((item) => (item.id === thread.id ? thread : item))
								: [...round.threads, thread],
						},
			),
		}));
	},
	async createThread(anchor, body) {
		const reviewRoundId = get().activeReviewRoundId;
		if (!reviewRoundId) return;
		await rpc.request.createThread({
			reviewRoundId,
			anchor,
			body,
		});
	},
	async replyToThread(threadId, body) {
		await rpc.request.replyToThread({ threadId, body });
	},
	async resolveThread(threadId) {
		await rpc.request.resolveThread({ threadId });
	},
	async reopenThread(threadId) {
		await rpc.request.reopenThread({ threadId });
	},
	async submitReview() {
		const sessionId = get().sessionId;
		if (!sessionId) return;
		const round = await rpc.request.submitReview({ sessionId });
		get().updateRound(round);
	},
	async markAligned() {
		const reviewRoundId = get().activeReviewRoundId;
		if (!reviewRoundId) return;
		await rpc.request.markAligned({ reviewRoundId });
	},
	async applyAlignedChanges() {
		const reviewRoundId = get().activeReviewRoundId;
		if (!reviewRoundId) return;
		await rpc.request.applyAlignedChanges({ reviewRoundId });
	},
	markStale(sessionId, scope) {
		if (sessionId !== get().sessionId) return;
		if (scope && scope !== get().currentScope) return;
		set({ diffStale: true });
	},
}));
