import type {
	CommentThreadView,
	GitStatusView,
	RevisionView,
	SessionStreamEvent,
	SessionSummary,
	ToastMessage,
} from "../../shared/models";

export interface HostMessenger {
	sessionEvent(event: SessionStreamEvent): void;
	sessionSummaryUpdated(summary: SessionSummary): void;
	revisionUpdated(revision: RevisionView): void;
	threadUpdated(thread: CommentThreadView): void;
	diffInvalidated(payload: { sessionId: string; revisionNumber?: number }): void;
	terminalData(payload: {
		terminalId: string;
		sessionId: string;
		data: string;
	}): void;
	terminalExit(payload: {
		terminalId: string;
		sessionId: string;
		exitCode: number;
	}): void;
	gitStatusUpdated(payload: GitStatusView): void;
	toast(toast: ToastMessage): void;
}
