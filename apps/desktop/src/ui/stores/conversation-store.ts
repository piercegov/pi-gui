import { create } from "zustand";
import type {
	ConversationEntryView,
	SessionHydration,
	SessionStreamEvent,
	ToolActivityView,
} from "@shared/models";

type ConversationState = {
	sessionId?: string;
	entries: ConversationEntryView[];
	toolActivity: ToolActivityView[];
	hydrate: (hydration: SessionHydration) => void;
	applyEvent: (event: SessionStreamEvent) => void;
};

export const useConversationStore = create<ConversationState>((set) => ({
	sessionId: undefined,
	entries: [],
	toolActivity: [],
	hydrate(hydration) {
		set({
			sessionId: hydration.session.id,
			entries: hydration.conversation,
			toolActivity: hydration.toolActivity,
		});
	},
	applyEvent(event) {
		set((state) => {
			if (state.sessionId && "sessionId" in event && event.sessionId !== state.sessionId) {
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
			return state;
		});
	},
}));
