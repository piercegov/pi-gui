import { describe, expect, test } from "bun:test";
import type {
	GitStatusView,
	PermissionPrompt,
	SessionStreamEvent,
	SessionSummary,
	ToastMessage,
} from "../../shared/models";
import { PiRuntimeManager } from "./runtime-manager";

function createMessengerHarness() {
	const sessionEvents: SessionStreamEvent[] = [];
	const summaries: SessionSummary[] = [];
	const toasts: ToastMessage[] = [];
	const messenger = {
		sessionEvent(event: SessionStreamEvent) {
			sessionEvents.push(event);
		},
		sessionSummaryUpdated(summary: SessionSummary) {
			summaries.push(summary);
		},
		revisionUpdated() {},
		threadUpdated() {},
		diffInvalidated() {},
		terminalData() {},
		terminalExit() {},
		gitStatusUpdated(_payload: GitStatusView) {},
		toast(toast: ToastMessage) {
			toasts.push(toast);
		},
		permissionPrompt(_prompt: PermissionPrompt) {},
	};
	return { messenger, sessionEvents, summaries, toasts };
}

function createManager() {
	const { messenger, sessionEvents } = createMessengerHarness();
	const manager = new PiRuntimeManager(
		messenger as ConstructorParameters<typeof PiRuntimeManager>[0],
		{
			getAppSettings() {
				return {
					agentSkillPaths: [],
					environmentOverrides: {},
				};
			},
		} as unknown as ConstructorParameters<typeof PiRuntimeManager>[1],
	);
	return { manager, sessionEvents };
}

function createRuntime(sessionId: string, messages: unknown[] = []) {
	return {
		record: { id: sessionId },
		session: {
			messages,
			getContextUsage() {
				return undefined;
			},
		},
		resourceLoader: {},
		toolActivity: [],
		toolInputsByCallId: new Map<string, Record<string, unknown>>(),
		unsubscribe: () => undefined,
		nextMessageEmitIndex: 0,
		isAgentRunning: false,
	};
}

describe("PiRuntimeManager", () => {
	test("streams tool result inputs before rehydration", async () => {
		const { manager, sessionEvents } = createManager();
		const runtime = createRuntime("session-live");
		const toolInput = {
			path: "src/live.ts",
			content: "export const live = true;\n",
		};

		await (manager as any).handleEvent(runtime, {
			type: "tool_execution_start",
			toolCallId: "call-live",
			toolName: "write",
			args: toolInput,
		});

		const toolResultMessage = {
			role: "toolResult",
			toolCallId: "call-live",
			toolName: "write",
			content: [{ type: "text", text: "Wrote src/live.ts" }],
			details: {},
			isError: false,
			timestamp: 1,
		};

		await (manager as any).handleEvent(runtime, {
			type: "message_start",
			message: toolResultMessage,
		});

		const streamedToolUpsert = sessionEvents.find(
			(event): event is Extract<SessionStreamEvent, { type: "message_upsert" }> =>
				event.type === "message_upsert" && event.entry.kind === "tool",
		);
		expect(streamedToolUpsert?.entry.toolInput).toEqual(toolInput);

		await (manager as any).handleEvent(runtime, {
			type: "message_end",
			message: toolResultMessage,
		});

		const toolUpserts = sessionEvents.filter(
			(event): event is Extract<SessionStreamEvent, { type: "message_upsert" }> =>
				event.type === "message_upsert" && event.entry.kind === "tool",
		);
		expect(toolUpserts).toHaveLength(2);
		expect(toolUpserts[0]?.entry.toolInput).toEqual(toolInput);
		expect(toolUpserts[1]?.entry.toolInput).toEqual(toolInput);
		expect(toolUpserts[1]?.entry.id).toBe(toolUpserts[0]?.entry.id);
	});

	test("rehydrates tool result inputs from assistant tool calls", () => {
		const { manager } = createManager();
		const toolInput = {
			path: "src/history.ts",
			content: "export const history = true;\n",
		};
		const runtime = createRuntime("session-history", [
			{
				role: "assistant",
				provider: "anthropic",
				model: "claude",
				timestamp: 1,
				stopReason: "tool_use",
				content: [
					{ type: "text", text: "Creating the file now." },
					{
						type: "toolCall",
						id: "call-history",
						name: "write",
						arguments: toolInput,
					},
				],
			},
			{
				role: "toolResult",
				toolCallId: "call-history",
				toolName: "write",
				content: [{ type: "text", text: "Wrote src/history.ts" }],
				details: {},
				isError: false,
				timestamp: 2,
			},
		]);

		((manager as any).runtimes as Map<string, unknown>).set("session-history", runtime);

		const conversation = manager.getConversation("session-history");
		const toolEntry = conversation.find((entry) => entry.kind === "tool");

		expect(toolEntry?.toolInput).toEqual(toolInput);
	});
});
