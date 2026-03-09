import { describe, expect, test } from "bun:test";
import { createPiPermissionsExtension } from "./index";

type CapturedHandler = ((event: unknown) => Promise<unknown>) | undefined;

function setupExtension(
	authorizeToolCall: Parameters<typeof createPiPermissionsExtension>[0]["authorizeToolCall"],
) {
	let handler: CapturedHandler;
	const extensionFactory = createPiPermissionsExtension({ authorizeToolCall });
	extensionFactory({
		on(eventName: string, eventHandler: (event: unknown) => Promise<unknown>) {
			if (eventName === "tool_call") {
				handler = eventHandler;
			}
		},
	} as unknown as Parameters<ReturnType<typeof createPiPermissionsExtension>>[0]);
	return {
		getHandler() {
			if (!handler) throw new Error("tool_call handler was not registered");
			return handler;
		},
	};
}

describe("pi-permissions-extension", () => {
	test("allows tool call when authorizer returns allow", async () => {
		const seen: Array<Record<string, unknown>> = [];
		const extension = setupExtension(async (event) => {
			seen.push(event.input);
			return { allow: true };
		});
		const handler = extension.getHandler();
		const result = await handler({
			type: "tool_call",
			toolCallId: "call-1",
			toolName: "bash",
			input: { command: "ls -la" },
		});
		expect(result).toBeUndefined();
		expect(seen[0]).toEqual({ command: "ls -la" });
	});

	test("blocks tool call with provided deny reason", async () => {
		const extension = setupExtension(async () => ({
			allow: false,
			reason: "Blocked by unit test policy",
		}));
		const handler = extension.getHandler();
		const result = await handler({
			type: "tool_call",
			toolCallId: "call-2",
			toolName: "write",
			input: { path: "x", content: "y" },
		});
		expect(result).toEqual({
			block: true,
			reason: "Blocked by unit test policy",
		});
	});

	test("uses default deny reason when authorizer omits reason", async () => {
		const extension = setupExtension(async () => ({ allow: false }));
		const handler = extension.getHandler();
		const result = await handler({
			type: "tool_call",
			toolCallId: "call-3",
			toolName: "edit",
			input: { path: "a", oldText: "1", newText: "2" },
		});
		expect(result).toEqual({
			block: true,
			reason: "Permission denied by policy.",
		});
	});

	test("passes fallback empty input object for non-object payloads", async () => {
		let capturedInput: Record<string, unknown> | undefined;
		const extension = setupExtension(async (event) => {
			capturedInput = event.input;
			return { allow: true };
		});
		const handler = extension.getHandler();
		await handler({
			type: "tool_call",
			toolCallId: "call-4",
			toolName: "bash",
			input: null,
		});
		expect(capturedInput).toEqual({});
	});
});
