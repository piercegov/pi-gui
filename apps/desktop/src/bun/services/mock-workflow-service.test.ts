import { describe, expect, test } from "bun:test";
import type {
	GitStatusView,
	PermissionPrompt,
	SessionStreamEvent,
	SessionSummary,
	ToastMessage,
} from "../../shared/models";
import type { HostMessenger } from "./host-messenger";
import {
	CURSOR_CLOUD_DEMO_WORKFLOW_ID,
	MOCK_WORKFLOW_ENV_VAR,
	MockWorkflowService,
} from "./mock-workflow-service";
import { defaultAppSettings } from "./settings-service";

function createMessengerHarness() {
	const sessionEvents: SessionStreamEvent[] = [];
	const summaries: SessionSummary[] = [];
	const toasts: ToastMessage[] = [];
	const messenger: HostMessenger = {
		sessionEvent(event) {
			sessionEvents.push(event);
		},
		sessionSummaryUpdated(summary) {
			summaries.push(summary);
		},
		revisionUpdated() {},
		threadUpdated() {},
		diffInvalidated() {},
		terminalData() {},
		terminalExit() {},
		gitStatusUpdated(_payload: GitStatusView) {},
		toast(toast) {
			toasts.push(toast);
		},
		permissionPrompt(_prompt: PermissionPrompt) {},
	};
	return { messenger, sessionEvents, summaries, toasts };
}

describe("MockWorkflowService", () => {
	test("stays dormant when the workflow is not enabled", () => {
		const { messenger } = createMessengerHarness();
		const service = new MockWorkflowService({ messenger });
		expect(service.isEnabled()).toBe(false);
		expect(service.listProjects([])).toEqual([]);
		expect(service.listSessions("anything", false)).toBeNull();
	});

	test("exposes a synthetic project and session when enabled", () => {
		const { messenger } = createMessengerHarness();
		const service = new MockWorkflowService({
			messenger,
			enabledWorkflowId: CURSOR_CLOUD_DEMO_WORKFLOW_ID,
			workspaceRoot: "/workspace",
			timelineStepMs: 1,
		});
		const projects = service.listProjects([]);
		expect(projects).toHaveLength(1);
		expect(projects[0]?.metadata.mockWorkflowEnvVar).toBe(MOCK_WORKFLOW_ENV_VAR);

		const sessions = service.listSessions(projects[0]!.id, false);
		expect(sessions).toHaveLength(1);
		expect(sessions?.[0]?.metadata.mockWorkflowLabel).toBe("Mock workflow");

		const hydration = service.openSession(sessions![0]!.id, defaultAppSettings);
		expect(hydration?.currentDiff?.stats.filesChanged).toBe(1);
		expect(hydration?.piConfig.authConfigured).toBe(false);
	});

	test("auto replay emits conversation, tool activity, checkpoint, and review status", async () => {
		const { messenger, sessionEvents, summaries } = createMessengerHarness();
		const service = new MockWorkflowService({
			messenger,
			enabledWorkflowId: CURSOR_CLOUD_DEMO_WORKFLOW_ID,
			workspaceRoot: "/workspace",
			timelineStepMs: 1,
		});
		const project = service.listProjects([])[0]!;
		const session = service.listSessions(project.id, false)![0]!;

		service.openSession(session.id, defaultAppSettings);
		await new Promise((resolve) => setTimeout(resolve, 40));

		expect(
			sessionEvents.some(
				(event) =>
					event.type === "message_upsert" && event.entry.kind === "user",
			),
		).toBe(true);
		expect(
			sessionEvents.some((event) => event.type === "message_delta"),
		).toBe(true);
		expect(
			sessionEvents.some(
				(event) =>
					event.type === "tool_activity" && event.activity.toolName === "write",
			),
		).toBe(true);
		const checkpointEvents = sessionEvents.filter(
			(event): event is Extract<SessionStreamEvent, { type: "checkpoint_created" }> =>
				event.type === "checkpoint_created",
		);
		expect(checkpointEvents.map((event) => event.checkpoint.kind)).toEqual([
			"pre_turn",
			"post_turn",
		]);
		expect(
			summaries.some((summary) => summary.status === "reviewing"),
		).toBe(true);

		const finalSummary = service.getSessionSummary(session.id);
		expect(finalSummary?.reviewState).toBe("discussing");
		expect(finalSummary?.changedFilesCount).toBe(1);
	});

	test("manual checkpoints emit events and update inspector state", () => {
		const { messenger, sessionEvents } = createMessengerHarness();
		const service = new MockWorkflowService({
			messenger,
			enabledWorkflowId: CURSOR_CLOUD_DEMO_WORKFLOW_ID,
			workspaceRoot: "/workspace",
			timelineStepMs: 1,
		});
		const project = service.listProjects([])[0]!;
		const session = service.listSessions(project.id, false)![0]!;

		const checkpoint = service.createManualCheckpoint(session.id);
		const inspector = service.getSessionInspector(session.id);
		const checkpointEvents = sessionEvents.filter(
			(event): event is Extract<SessionStreamEvent, { type: "checkpoint_created" }> =>
				event.type === "checkpoint_created",
		);

		expect(checkpoint?.kind).toBe("manual");
		expect(checkpointEvents.at(-1)?.checkpoint.id).toBe(checkpoint?.id);
		expect(inspector?.checkpoints.some((candidate) => candidate.id === checkpoint?.id)).toBe(
			true,
		);
	});
});
