import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";
import { emitReviewState } from "./hooks/checkpoints";
import { shouldBlockMutatingTool } from "./hooks/discussion-freeze";
import { createReviewReplyTool } from "./tools/review-reply-tool";
import type { ReviewExtensionOptions } from "./types";

export function createPiReviewExtension(
	options: ReviewExtensionOptions,
): ExtensionFactory {
	return (pi) => {
		pi.registerTool(createReviewReplyTool(options.eventBus));

		pi.on("turn_start", async (event, ctx) => {
			pi.appendEntry("pi-review:turn-start", {
				turnIndex: event.turnIndex,
				reviewRoundId: options.getActiveReviewRoundId(),
			});
			emitReviewState(options.eventBus, {
				type: "turn_start",
				sessionId: options.sessionId,
				reviewRoundId: options.getActiveReviewRoundId(),
				turnIndex: event.turnIndex,
			});
			const leafId = ctx.sessionManager.getLeafId();
			if (leafId) {
				pi.setLabel(leafId, `turn-${event.turnIndex}-start`);
			}
		});

		pi.on("turn_end", async (event, ctx) => {
			pi.appendEntry("pi-review:turn-end", {
				turnIndex: event.turnIndex,
				reviewRoundId: options.getActiveReviewRoundId(),
			});
			emitReviewState(options.eventBus, {
				type: "turn_end",
				sessionId: options.sessionId,
				reviewRoundId: options.getActiveReviewRoundId(),
				turnIndex: event.turnIndex,
			});
			const leafId = ctx.sessionManager.getLeafId();
			if (leafId) {
				pi.setLabel(leafId, `turn-${event.turnIndex}-end`);
			}
		});

		pi.on("tool_call", async (event) => {
			if (shouldBlockMutatingTool(event.toolName, options.isDiscussionFrozen())) {
				return {
					block: true,
					reason:
						"Review discussion mode is active. Reply with review_reply or use read-only tools until changes are aligned.",
				};
			}
			return undefined;
		});
	};
}

export * from "./types";
