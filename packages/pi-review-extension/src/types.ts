import type { EventBus, ExtensionFactory } from "@mariozechner/pi-coding-agent";

export const PI_REVIEW_REPLY_EVENT = "pi-review:reply";
export const PI_REVIEW_STATE_EVENT = "pi-review:state";

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

export interface ReviewStatePayload {
	type:
		| "review_round_started"
		| "review_round_aligned"
		| "review_round_applied"
		| "turn_start"
		| "turn_end";
	sessionId: string;
	reviewRoundId?: string;
	turnIndex?: number;
}

export interface ReviewExtensionOptions {
	sessionId: string;
	eventBus: EventBus;
	isDiscussionFrozen: () => boolean;
	getActiveReviewRoundId: () => string | undefined;
}

export type ReviewExtensionFactory = (options: ReviewExtensionOptions) => ExtensionFactory;
