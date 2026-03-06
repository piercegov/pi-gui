import { Type } from "@sinclair/typebox";
import type { EventBus } from "@mariozechner/pi-coding-agent";
import {
	PI_REVIEW_REPLY_EVENT,
	type ReviewReplyPayload,
} from "../types";

export const reviewReplySchema = Type.Object({
	reviewRoundId: Type.String(),
	threads: Type.Array(
		Type.Object({
			threadId: Type.String(),
			disposition: Type.Union([
				Type.Literal("acknowledged"),
				Type.Literal("needs_clarification"),
				Type.Literal("proposed_change"),
				Type.Literal("decline_change"),
			]),
			reply: Type.String(),
			plan: Type.Optional(Type.Array(Type.String())),
		}),
	),
	summary: Type.Optional(Type.String()),
});

export function createReviewReplyTool(eventBus: EventBus) {
	return {
		name: "review_reply",
		label: "Review Reply",
		description:
			"Reply to review comment threads with structured dispositions and concise plans.",
		parameters: reviewReplySchema,
		execute: async (
			_toolCallId: string,
			params: ReviewReplyPayload,
		) => {
			eventBus.emit(PI_REVIEW_REPLY_EVENT, params);
			return {
				content: [{ type: "text" as const, text: "Structured review reply recorded." }],
				details: params,
			};
		},
	};
}
