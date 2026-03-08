import { isDelete, isInsert } from "react-diff-view";
import type { HunkData } from "react-diff-view";

export const LARGE_DIFF_RENDER_ROW_THRESHOLD = 320;
export const LARGE_DIFF_RENDER_ITEM_THRESHOLD = 24;
export const DIFF_CHUNK_TARGET_ROWS = 180;

function chunkHunk(hunk: HunkData, targetRows: number) {
	if (hunk.changes.length <= targetRows) return [hunk];

	const chunks: HunkData[] = [];
	let oldCursor = hunk.oldStart;
	let newCursor = hunk.newStart;

	for (let index = 0; index < hunk.changes.length; index += targetRows) {
		const changes = hunk.changes.slice(index, index + targetRows);
		let oldLines = 0;
		let newLines = 0;
		for (const change of changes) {
			if (!isInsert(change)) oldLines += 1;
			if (!isDelete(change)) newLines += 1;
		}
		chunks.push({
			...hunk,
			content: `@@ -${oldCursor},${oldLines} +${newCursor},${newLines} @@`,
			oldStart: oldCursor,
			oldLines,
			newStart: newCursor,
			newLines,
			changes,
		});
		oldCursor += oldLines;
		newCursor += newLines;
	}

	return chunks;
}

export function splitFileHunks(hunks: HunkData[], targetRows = DIFF_CHUNK_TARGET_ROWS) {
	return hunks.flatMap((hunk) => chunkHunk(hunk, targetRows));
}

export function shouldChunkFile(changeCount: number, hunkCount: number) {
	return changeCount >= LARGE_DIFF_RENDER_ROW_THRESHOLD || hunkCount >= 8;
}

export function shouldVirtualizeDiff(params: {
	fileCount: number;
	renderItemCount: number;
	totalChangeCount: number;
	largestFileChangeCount: number;
	patchBytes: number;
}) {
	return (
		params.fileCount >= LARGE_DIFF_RENDER_ITEM_THRESHOLD ||
		params.renderItemCount >= LARGE_DIFF_RENDER_ITEM_THRESHOLD ||
		params.totalChangeCount >= LARGE_DIFF_RENDER_ROW_THRESHOLD * 2 ||
		params.largestFileChangeCount >= LARGE_DIFF_RENDER_ROW_THRESHOLD ||
		params.patchBytes >= 120_000
	);
}
