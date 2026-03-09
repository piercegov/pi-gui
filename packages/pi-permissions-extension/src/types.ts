import type { ToolCallEvent } from "@mariozechner/pi-coding-agent";

export interface PermissionDecision {
	allow: boolean;
	reason?: string;
	userMessage?: string;
}

export interface PermissionToolCall {
	toolCallId: string;
	toolName: ToolCallEvent["toolName"];
	input: Record<string, unknown>;
}

export interface PermissionExtensionOptions {
	authorizeToolCall: (
		event: PermissionToolCall,
	) => Promise<PermissionDecision> | PermissionDecision;
}
