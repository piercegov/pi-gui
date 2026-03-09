import type { ExtensionFactory, ToolCallEvent } from "@mariozechner/pi-coding-agent";
import type { PermissionExtensionOptions } from "./types";

function toInputRecord(event: ToolCallEvent): Record<string, unknown> {
	const input = event.input;
	if (typeof input === "object" && input !== null) {
		return input as Record<string, unknown>;
	}
	return {};
}

export function createPiPermissionsExtension(
	options: PermissionExtensionOptions,
): ExtensionFactory {
	return (pi) => {
		pi.on("tool_call", async (event) => {
			const decision = await options.authorizeToolCall({
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				input: toInputRecord(event),
			});
			if (!decision.allow) {
				return {
					block: true,
					reason: decision.reason ?? "Permission denied by policy.",
				};
			}
			return undefined;
		});
	};
}

export * from "./types";
