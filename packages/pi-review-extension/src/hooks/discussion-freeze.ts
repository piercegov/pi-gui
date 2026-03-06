const blockedToolNames = new Set(["write", "edit", "bash"]);

export function shouldBlockMutatingTool(
	toolName: string,
	isDiscussionFrozen: boolean,
) {
	if (!isDiscussionFrozen) return false;
	return blockedToolNames.has(toolName);
}
