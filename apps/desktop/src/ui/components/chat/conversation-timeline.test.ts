import { describe, expect, test } from "bun:test";
import type { CheckpointSummaryView, ConversationEntryView } from "@shared/models";
import { groupConversationTimeline } from "./conversation-timeline";

function makeEntry(
	id: string,
	kind: ConversationEntryView["kind"],
	timestamp: number,
): ConversationEntryView {
	return {
		id,
		sessionId: "session-1",
		kind,
		timestamp,
		markdown: id,
		status: "done",
		metadata: {},
	};
}

function makeCheckpoint(
	id: string,
	kind: CheckpointSummaryView["kind"],
	createdAt: number,
): CheckpointSummaryView {
	return {
		id,
		sessionId: "session-1",
		kind,
		createdAt,
	};
}

describe("groupConversationTimeline", () => {
	test("keeps every relevant checkpoint in chronological order", () => {
		const entries = [
			makeEntry("user-1", "user", 10),
			makeEntry("assistant-1", "assistant", 40),
		];
		const checkpoints = [
			makeCheckpoint("baseline-1", "baseline", 5),
			makeCheckpoint("pre-1", "pre_turn", 12),
			makeCheckpoint("post-1", "post_turn", 18),
			makeCheckpoint("manual-1", "manual", 24),
			makeCheckpoint("pre-2", "pre_turn", 32),
			makeCheckpoint("post-2", "post_turn", 36),
		];

		const rendered = groupConversationTimeline(entries, checkpoints).map((block) =>
			block.type === "checkpoint"
				? `checkpoint:${block.checkpoint.id}`
				: block.type === "assistant_turn"
					? `assistant:${block.lead.id}`
					: `entry:${block.entry.id}`,
		);

		expect(rendered).toEqual([
			"entry:user-1",
			"checkpoint:pre-1",
			"checkpoint:post-1",
			"checkpoint:manual-1",
			"checkpoint:pre-2",
			"checkpoint:post-2",
			"assistant:assistant-1",
		]);
	});

	test("excludes checkpoint kinds that only belong in the inspector", () => {
		const entries = [makeEntry("assistant-1", "assistant", 50)];
		const checkpoints = [
			makeCheckpoint("baseline-1", "baseline", 5),
			makeCheckpoint("review-1", "review_start", 10),
			makeCheckpoint("revision-1", "revision", 15),
			makeCheckpoint("alignment-1", "alignment", 20),
		];

		const renderedCheckpointIds = groupConversationTimeline(entries, checkpoints)
			.filter(
				(block): block is Extract<
					ReturnType<typeof groupConversationTimeline>[number],
					{ type: "checkpoint" }
				> => block.type === "checkpoint",
			)
			.map((block) => block.checkpoint.id);

		expect(renderedCheckpointIds).toEqual(["alignment-1"]);
	});
});
