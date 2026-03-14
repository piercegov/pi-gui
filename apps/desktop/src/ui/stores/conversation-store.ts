import { create } from "zustand";
import type {
	CheckpointSummaryView,
	ContextUsageView,
	ConversationEntryView,
	SessionHydration,
	SessionStreamEvent,
	ToolActivityView,
} from "@shared/models";

type ConversationState = {
	sessionId?: string;
	entries: ConversationEntryView[];
	toolActivity: ToolActivityView[];
	checkpoints: CheckpointSummaryView[];
	contextUsage?: ContextUsageView;
	prepareSession: (sessionId: string) => void;
	hydrate: (hydration: SessionHydration) => void;
	applyEvent: (event: SessionStreamEvent) => void;
};

function mergeCheckpoints(
	current: CheckpointSummaryView[],
	checkpoint: CheckpointSummaryView,
) {
	const next = current.filter((candidate) => candidate.id !== checkpoint.id);
	next.push(checkpoint);
	return next.sort((a, b) => a.createdAt - b.createdAt);
}

export const useConversationStore = create<ConversationState>((set) => ({
	sessionId: undefined,
	entries: [],
	toolActivity: [],
	checkpoints: [],
	contextUsage: undefined,
	prepareSession(sessionId) {
		set({
			sessionId,
			entries: [],
			toolActivity: [],
			checkpoints: [],
			contextUsage: undefined,
		});
	},
	hydrate(hydration) {
		set({
			sessionId: hydration.session.id,
			entries: hydration.conversation,
			toolActivity: hydration.toolActivity,
			checkpoints: hydration.checkpoints,
			contextUsage: hydration.contextUsage,
		});
	},
	applyEvent(event) {
		set((state) => {
			// Extract sessionId from event — it may be top-level or nested in entry/activity/checkpoint/usage
			let eventSessionId: string | undefined;
			if ("sessionId" in event) {
				eventSessionId = event.sessionId;
			} else if (event.type === "message_upsert" || event.type === "review_notice") {
				eventSessionId = event.entry.sessionId;
			} else if (event.type === "tool_activity") {
				eventSessionId = event.activity.sessionId;
			}
			if (state.sessionId && eventSessionId && eventSessionId !== state.sessionId) {
				return state;
			}
			if (event.type === "message_upsert" || event.type === "review_notice") {
				const entries = [...state.entries];
				const index = entries.findIndex((entry) => entry.id === event.entry.id);
				if (index === -1) entries.push(event.entry);
				else entries[index] = event.entry;
				return { ...state, entries };
			}
			if (event.type === "message_delta") {
				return {
					...state,
					entries: state.entries.map((entry) =>
						entry.id === event.entryId
							? {
									...entry,
									markdown: `${entry.markdown}${event.delta}`,
									status: "streaming",
								}
							: entry,
					),
				};
			}
			if (event.type === "tool_activity") {
				return {
					...state,
					toolActivity: [
						event.activity,
						...state.toolActivity.filter(
							(activity) => activity.toolCallId !== event.activity.toolCallId,
						),
					].slice(0, 40),
				};
			}
			if (event.type === "checkpoint_created") {
				if (event.checkpoint.sessionId !== state.sessionId) return state;
				return {
					...state,
					checkpoints: mergeCheckpoints(state.checkpoints, event.checkpoint),
				};
			}
			if (event.type === "context_usage") {
				if (event.usage.sessionId !== state.sessionId) return state;
				return {
					...state,
					contextUsage: event.usage,
				};
			}
			return state;
		});
	},
}));
