import type { EventBus } from "@mariozechner/pi-coding-agent";
import {
	PI_REVIEW_STATE_EVENT,
	type ReviewStatePayload,
} from "../types";

export function emitReviewState(eventBus: EventBus, payload: ReviewStatePayload) {
	eventBus.emit(PI_REVIEW_STATE_EVENT, payload);
}
