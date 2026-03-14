import type { CheckpointSummaryView, ConversationEntryView } from "@shared/models";

export type TurnContentBlock =
	| { type: "text"; markdown: string }
	| { type: "tool"; entry: ConversationEntryView };

export type AssistantTurn = {
	type: "assistant_turn";
	lead: ConversationEntryView;
	blocks: TurnContentBlock[];
};

export type CheckpointBlock = {
	type: "checkpoint";
	checkpoint: CheckpointSummaryView;
};

export type RenderBlock =
	| { type: "entry"; entry: ConversationEntryView }
	| AssistantTurn
	| CheckpointBlock;

const CONVERSATION_CHECKPOINT_KINDS = new Set<
	CheckpointSummaryView["kind"]
>(["pre_turn", "post_turn", "manual", "alignment"]);

function isToolCallOnly(entry: ConversationEntryView): boolean {
	if (entry.kind !== "assistant") return false;
	const trimmed = entry.markdown.trim();
	if (!trimmed) return true;
	return trimmed.split("\n").every((line) => /^-\s*`[^`]+`\s*$/.test(line.trim()));
}

function stripToolCallLines(markdown: string): string {
	const lines = markdown
		.split("\n")
		.filter((line) => !/^-\s*`[^`]+`\s*$/.test(line.trim()));

	while (lines.length > 0 && lines[0].trim() === "") {
		lines.shift();
	}
	while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
		lines.pop();
	}

	return lines.join("\n");
}

export function groupConversationTimeline(
	entries: ConversationEntryView[],
	checkpoints: CheckpointSummaryView[],
): RenderBlock[] {
	const blocks: RenderBlock[] = [];
	let i = 0;
	while (i < entries.length) {
		const entry = entries[i];
		if (entry.kind === "assistant") {
			const lead = entry;
			const contentBlocks: TurnContentBlock[] = [];
			const realText = stripToolCallLines(entry.markdown);
			if (realText) contentBlocks.push({ type: "text", markdown: realText });
			i++;
			while (i < entries.length) {
				const next = entries[i];
				if (next.kind === "tool") {
					contentBlocks.push({ type: "tool", entry: next });
					i++;
				} else if (isToolCallOnly(next)) {
					i++;
				} else if (next.kind === "assistant") {
					const text = stripToolCallLines(next.markdown);
					if (text) contentBlocks.push({ type: "text", markdown: text });
					i++;
				} else {
					break;
				}
			}
			blocks.push({
				type: "assistant_turn",
				lead,
				blocks: contentBlocks,
			});
		} else {
			blocks.push({ type: "entry", entry });
			i++;
		}
	}

	const visibleCheckpoints = checkpoints
		.filter((checkpoint) => CONVERSATION_CHECKPOINT_KINDS.has(checkpoint.kind))
		.slice()
		.sort((a, b) => a.createdAt - b.createdAt);

	if (visibleCheckpoints.length === 0) return blocks;

	const merged: RenderBlock[] = [];
	let checkpointIndex = 0;

	for (const block of blocks) {
		const blockTimestamp =
			block.type === "assistant_turn"
				? block.lead.timestamp
				: block.type === "entry"
					? block.entry.timestamp
					: block.checkpoint.createdAt;

		while (
			checkpointIndex < visibleCheckpoints.length &&
			visibleCheckpoints[checkpointIndex].createdAt <= blockTimestamp
		) {
			merged.push({
				type: "checkpoint",
				checkpoint: visibleCheckpoints[checkpointIndex],
			});
			checkpointIndex += 1;
		}

		merged.push(block);
	}

	while (checkpointIndex < visibleCheckpoints.length) {
		merged.push({
			type: "checkpoint",
			checkpoint: visibleCheckpoints[checkpointIndex],
		});
		checkpointIndex += 1;
	}

	return merged;
}
