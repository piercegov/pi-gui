import type { CommentAnchor, CommentThreadView, DiffSnapshotView } from "@shared/models";
import type { ChangeData, FileData, HunkData } from "react-diff-view";
import { getChangeKey } from "react-diff-view";

function stripPrefix(content: string) {
	return content.replace(/^[ +-]/, "");
}

function newLineValue(change: ChangeData) {
	if ("lineNumber" in change) {
		return change.lineNumber ?? -1;
	}
	if ("oldLineNumber" in change) {
		return change.oldLineNumber ?? -1;
	}
	return -1;
}

function oldLineValue(change: ChangeData) {
	if ("oldLineNumber" in change) {
		return change.oldLineNumber ?? -1;
	}
	if ("lineNumber" in change) {
		return change.lineNumber ?? -1;
	}
	return -1;
}

export function createAnchorFromChange(params: {
	file: FileData;
	hunk: HunkData;
	change: ChangeData;
	diff: DiffSnapshotView;
}) {
	const { file, hunk, change, diff } = params;
	const changes = hunk.changes;
	const index = changes.findIndex((candidate) => candidate === change);
	const beforeContext = changes
		.slice(Math.max(0, index - 2), index)
		.map((candidate) => stripPrefix(candidate.content));
	const afterContext = changes
		.slice(index + 1, index + 3)
		.map((candidate) => stripPrefix(candidate.content));
	const isOldSide = change.type === "delete";
	return {
		filePath: file.newPath || file.oldPath,
		side: isOldSide ? "old" : "new",
		line: isOldSide ? oldLineValue(change) : newLineValue(change),
		hunkHeader: hunk.content,
		beforeContext,
		targetLineText: stripPrefix(change.content),
		afterContext,
		checkpointId:
			diff.toCheckpointId ?? diff.fromCheckpointId ?? "working-tree",
		diffSnapshotId: diff.id,
	} satisfies CommentAnchor;
}

export function threadMatchesChange(thread: CommentThreadView, change: ChangeData) {
	if (thread.anchor.side === "old") {
		return thread.anchor.line === oldLineValue(change);
	}
	return thread.anchor.line === newLineValue(change);
}

export function createThreadWidgetMap(params: {
	files: FileData[];
	threads: CommentThreadView[];
	draftAnchor?: CommentAnchor | null;
	renderWidget: (
		threadKey: string,
		change: ChangeData,
		filePath: string,
		threads: CommentThreadView[],
	) => React.ReactNode,
}) {
	const widgets: Record<string, React.ReactNode> = {};
	for (const file of params.files) {
		const filePath = file.newPath || file.oldPath;
		for (const hunk of file.hunks) {
			for (const change of hunk.changes) {
				const changeThreads = params.threads.filter(
					(thread) =>
						thread.filePath === filePath && threadMatchesChange(thread, change),
				);
				if (changeThreads.length > 0) {
					widgets[getChangeKey(change)] = params.renderWidget(
						getChangeKey(change),
						change,
						filePath,
						changeThreads,
					);
				}
			}
		}
	}
	return widgets;
}
