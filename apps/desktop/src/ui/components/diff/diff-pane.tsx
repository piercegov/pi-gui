import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { getChangeKey, Diff, Hunk, parseDiff } from "react-diff-view";
import type { HunkTokens } from "react-diff-view";
import { useVirtualizer } from "@tanstack/react-virtual";
import { SplitSquareHorizontal, Rows3, Search, CheckCircle2, Send, GitCompare, AlertTriangle, Info, MessageSquarePlus, Loader2, MessageSquare, ChevronDown, ChevronRight, Flag, Check, Play, GitMerge, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type {
	CommentAnchor,
	CommentThreadView,
	DiffMode,
	DiffSnapshotView,
	DiffViewMode,
	RevisionView,
	SessionInspectorView,
	SessionSummary,
	ThreadResolution,
} from "@shared/models";
import { createAnchorFromChange } from "@ui/lib/diff-utils";
import { measureDiffPerf, recordDiffPerf } from "@ui/lib/diff-perf";
import { MarkdownRenderer } from "@ui/lib/markdown";
import { MemoizedSessionInspector } from "./session-inspector";

const INLINE_DIFF_RENDER_FILE_LIMIT = 24;
const MIN_SELECTION_CHARS = 2;
const ENABLE_DIFF_SYNTAX_HIGHLIGHT = false;
const ENABLE_DIFF_EDIT_MARKING = false;

function tokenizeHunks(
	hunks: Array<{ changes: unknown[] }>,
): HunkTokens | undefined {
	if (!ENABLE_DIFF_SYNTAX_HIGHLIGHT && !ENABLE_DIFF_EDIT_MARKING) return undefined;
	if (!hunks.length) return undefined;
	return undefined;
}

function ResolutionBadge(props: { resolution: ThreadResolution }) {
	if (props.resolution === "no_changes") {
		return (
			<span className="inline-flex items-center gap-0.5 text-2xs text-state-applied">
				<Check className="h-2.5 w-2.5" />
				No changes needed
			</span>
		);
	}
	return (
		<span className="inline-flex items-center gap-0.5 text-2xs text-state-review">
			<Flag className="h-2.5 w-2.5" />
			Address this
		</span>
	);
}

function InlineThread(props: {
	threads: CommentThreadView[];
	onReply: (threadId: string, body: string) => Promise<void>;
	onResolve: (threadId: string, resolution: ThreadResolution) => Promise<void>;
	onReopen: (threadId: string) => Promise<void>;
}) {
	const [replyBody, setReplyBody] = useState("");
	const [minimized, setMinimized] = useState(false);

	const totalMessages = props.threads.reduce((sum, t) => sum + t.messages.length, 0);
	const unresolvedCount = props.threads.filter((t) => t.status !== "resolved").length;

	if (minimized) {
		return (
			<button
				onClick={() => setMinimized(false)}
				className="flex items-center gap-1.5 border-l-2 border-accent/30 bg-surface-2 px-3 py-1.5 text-2xs text-white/50 transition hover:bg-surface-2/80 hover:text-white/70"
			>
				<MessageSquare className="h-3 w-3 text-accent/60" />
				<span>
					{props.threads.length} {props.threads.length === 1 ? "thread" : "threads"}
					{" · "}
					{totalMessages} {totalMessages === 1 ? "comment" : "comments"}
				</span>
				{unresolvedCount > 0 && (
					<span className="text-state-review">
						· {unresolvedCount} unresolved
					</span>
				)}
				<ChevronRight className="h-3 w-3" />
			</button>
		);
	}

	return (
		<div className="space-y-2 border-l-2 border-accent/30 bg-surface-2 p-3">
			<div className="flex justify-end">
				<button
					onClick={() => setMinimized(true)}
					className="flex items-center gap-0.5 text-2xs text-white/30 transition hover:text-white/50"
				>
					<ChevronDown className="h-3 w-3" />
					Minimize
				</button>
			</div>
			{props.threads.map((thread) => (
				<div key={thread.id} className="border-b border-surface-border pb-2 last:border-b-0">
					<div className="mb-1.5 flex items-center justify-between text-2xs text-white/30">
						<div className="flex items-center gap-2">
							<span className="uppercase tracking-wider">{thread.status.replace(/_/g, " ")}</span>
							{thread.resolution && <ResolutionBadge resolution={thread.resolution} />}
						</div>
						<span className="mono">{thread.filePath}</span>
					</div>
					<div className="space-y-1.5">
						{thread.messages.map((message) => (
							<div key={message.id} className="bg-surface-1 px-3 py-2">
								<div className="mb-1 text-2xs uppercase tracking-wider text-white/25">
									{message.authorType}
								</div>
								<MarkdownRenderer markdown={message.bodyMarkdown} />
							</div>
						))}
					</div>
					<div className="mt-2 flex gap-1.5">
						{thread.status !== "resolved" ? (
							<>
								<button
									onClick={() => props.onResolve(thread.id, "no_changes")}
									className="flex items-center gap-1 px-2 py-0.5 text-2xs text-state-applied/70 transition hover:bg-state-applied/10 hover:text-state-applied"
								>
									<Check className="h-3 w-3" />
									No changes needed
								</button>
								<button
									onClick={() => props.onResolve(thread.id, "address_this")}
									className="flex items-center gap-1 px-2 py-0.5 text-2xs text-state-review/70 transition hover:bg-state-review/10 hover:text-state-review"
								>
									<Flag className="h-3 w-3" />
									Address this
								</button>
							</>
						) : (
							<button
								onClick={() => props.onReopen(thread.id)}
								className="px-2 py-0.5 text-2xs text-white/40 transition hover:bg-white/5 hover:text-white/60"
							>
								Reopen
							</button>
						)}
					</div>
				</div>
			))}

			<div className="pt-1">
				<textarea
					value={replyBody}
					onChange={(event) => setReplyBody(event.target.value)}
					rows={2}
					placeholder="Reply..."
					className="w-full resize-none border border-surface-border bg-surface-1 px-3 py-1.5 text-xs text-white/80 placeholder:text-white/20 outline-none focus:border-accent/30"
				/>
				<div className="mt-1.5 flex justify-end">
					<button
						onClick={async () => {
							if (!replyBody.trim() || props.threads.length === 0) return;
							await props.onReply(props.threads[0].id, replyBody);
							setReplyBody("");
						}}
						className="bg-accent px-2.5 py-1 text-xs font-medium text-black"
					>
						Reply
					</button>
				</div>
			</div>
		</div>
	);
}

function lineValue(change: { type: string } & Record<string, unknown>, side: "old" | "new") {
	if (side === "old" && "oldLineNumber" in change) {
		return (change.oldLineNumber as number | undefined) ?? -1;
	}
	if ("lineNumber" in change) {
		return (change.lineNumber as number | undefined) ?? -1;
	}
	if ("oldLineNumber" in change) {
		return (change.oldLineNumber as number | undefined) ?? -1;
	}
	return -1;
}

function threadLookupKey(filePath: string, side: "old" | "new", line: number) {
	return `${filePath}\u0000${side}\u0000${line}`;
}

function fileStats(file: { hunks: Array<{ changes: Array<{ type: string }> }> }) {
	let additions = 0;
	let deletions = 0;
	for (const hunk of file.hunks) {
		for (const change of hunk.changes) {
			if (change.type === "insert") additions += 1;
			if (change.type === "delete") deletions += 1;
		}
	}
	return { additions, deletions };
}

function fileChangeCount(file: { hunks: Array<{ changes: unknown[] }> }) {
	let count = 0;
	for (const hunk of file.hunks) {
		count += hunk.changes.length;
	}
	return count;
}

type DiffPaneSession = Pick<
	SessionSummary,
	"id" | "status" | "mode" | "baseRef" | "worktreeBranch" | "worktreePath" | "cwdPath"
>;

function buildWidgetsForFile(params: {
	diffId?: string;
	file: {
		hunks: Array<{ changes: Array<{ type: string } & Record<string, unknown>> }>;
	};
	path: string;
	threadIndex: Map<string, CommentThreadView[]>;
	draftAnchor: CommentAnchor | null;
	draftBody: string;
	onReplyToThread: (threadId: string, body: string) => Promise<void>;
	onResolveThread: (threadId: string, resolution: ThreadResolution) => Promise<void>;
	onReopenThread: (threadId: string) => Promise<void>;
	onCancelDraft: () => void;
	onSubmitDraft: () => Promise<void>;
	onDraftBodyChange: (value: string) => void;
}) {
	return measureDiffPerf(
		"build_widgets",
		() => {
			const widgets: Record<string, React.ReactNode> = {};
			for (const hunk of params.file.hunks) {
				for (const change of hunk.changes) {
					const oldLine = lineValue(change, "old");
					const newLine = lineValue(change, "new");
					const oldThreads =
						oldLine >= 0
							? params.threadIndex.get(threadLookupKey(params.path, "old", oldLine))
							: undefined;
					const newThreads =
						newLine >= 0
							? params.threadIndex.get(threadLookupKey(params.path, "new", newLine))
							: undefined;
					const threads =
						oldThreads && newThreads
							? [...oldThreads, ...newThreads]
							: oldThreads ?? newThreads ?? [];
					const key = getChangeKey(change as never);
					const isDraft =
						params.draftAnchor &&
						params.draftAnchor.filePath === params.path &&
						((params.draftAnchor.side === "old" && params.draftAnchor.line === oldLine) ||
							(params.draftAnchor.side === "new" &&
								params.draftAnchor.line === newLine));
					if (threads.length === 0 && !isDraft) continue;
					widgets[key] = (
						<div className="py-1.5">
							{threads.length > 0 ? (
								<InlineThread
									threads={threads}
									onReply={params.onReplyToThread}
									onResolve={params.onResolveThread}
									onReopen={params.onReopenThread}
								/>
							) : null}
							{isDraft ? (
								<div className="border-l-2 border-accent/30 bg-surface-2 p-3">
									<textarea
										value={params.draftBody}
										onChange={(event) =>
											params.onDraftBodyChange(event.target.value)
										}
										rows={3}
										placeholder="Leave a review comment..."
										className="w-full resize-none border border-surface-border bg-surface-1 px-3 py-1.5 text-xs text-white/80 placeholder:text-white/20 outline-none focus:border-accent/30"
									/>
									<div className="mt-2 flex justify-end gap-1.5">
										<button
											onClick={params.onCancelDraft}
											className="px-2.5 py-1 text-xs text-white/40 hover:bg-white/5 hover:text-white/60"
										>
											Cancel
										</button>
										<button
											onClick={() => void params.onSubmitDraft()}
											className="bg-accent px-2.5 py-1 text-xs font-medium text-black"
										>
											Comment
										</button>
									</div>
								</div>
							) : null}
						</div>
					);
				}
			}
			return widgets;
		},
		{
			diffId: params.diffId,
			filePath: params.path,
			metadata: { changes: fileChangeCount(params.file) },
		},
	);
}

type DiffPaneProps = {
	session?: DiffPaneSession;
	inspector?: SessionInspectorView;
	diff?: DiffSnapshotView;
	revisions: RevisionView[];
	activeRevisionNumber?: number;
	selectedRevisionNumber?: number;
	diffMode: DiffMode;
	defaultView: DiffViewMode;
	diffStale: boolean;
	onSelectRevision: (n: number) => void;
	onSetDiffMode: (mode: DiffMode) => void;
	onCreateThread: (anchor: CommentAnchor, body: string) => Promise<void>;
	onReplyToThread: (threadId: string, body: string) => Promise<void>;
	onResolveThread: (threadId: string, resolution: ThreadResolution) => Promise<void>;
	onReopenThread: (threadId: string) => Promise<void>;
	onPublishComments: () => Promise<void>;
	onStartNextRevision: () => Promise<void>;
	onApprove: () => Promise<void>;
	onApplyRevision: () => Promise<void>;
	onApplyAndMerge: (commitMessage?: string) => Promise<void>;
	onCreateManualCheckpoint: () => Promise<void>;
	onRepairWorktree: () => Promise<void>;
};

function DiffPaneComponent(props: DiffPaneProps) {
	const [viewType, setViewType] = useState<DiffViewMode>(props.defaultView);
	const [search, setSearch] = useState("");
	const [draftAnchor, setDraftAnchor] = useState<CommentAnchor | null>(null);
	const [draftBody, setDraftBody] = useState("");
	const [unresolvedOnly, setUnresolvedOnly] = useState(false);
	const [inspectorOpen, setInspectorOpen] = useState(false);
	const [commitMessage, setCommitMessage] = useState("");
	const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
	const [fileListCollapsed, setFileListCollapsed] = useState(false);
	const [selectionPopup, setSelectionPopup] = useState<{
		x: number;
		y: number;
		selectedText: string;
		filePath: string;
		lineNumber: number;
		side: "old" | "new";
	} | null>(null);
	const diffContentRef = useRef<HTMLDivElement>(null);
	const deferredSearch = useDeferredValue(search);
	const parsedFiles = useMemo(
		() =>
			measureDiffPerf(
				"parse_diff",
				() => (props.diff ? parseDiff(props.diff.patch, { nearbySequences: "zip" }) : []),
				{
					diffId: props.diff?.id,
					metadata: { patchBytes: props.diff?.patch.length ?? 0 },
				},
			),
		[props.diff],
	);

	useEffect(() => {
		setCollapsedFiles(new Set());
	}, [props.diff?.id]);

	const selectedRevision = useMemo(
		() => props.revisions.find((r) => r.revisionNumber === props.selectedRevisionNumber),
		[props.revisions, props.selectedRevisionNumber],
	);

	const visibleThreads = useMemo(() => {
		const threads = selectedRevision?.threads ?? [];
		return unresolvedOnly
			? threads.filter((thread) => thread.status !== "resolved")
			: threads;
	}, [selectedRevision?.threads, unresolvedOnly]);

	const filteredFiles = useMemo(() => {
		return parsedFiles.filter((file) =>
			(file.newPath || file.oldPath)
				.toLowerCase()
				.includes(deferredSearch.toLowerCase()),
		);
	}, [deferredSearch, parsedFiles]);

	const filteredFileIndexByPath = useMemo(() => {
		const map = new Map<string, number>();
		for (let index = 0; index < filteredFiles.length; index += 1) {
			const file = filteredFiles[index];
			map.set(file.newPath || file.oldPath, index);
		}
		return map;
	}, [filteredFiles]);

	const threadIndex = useMemo(() => {
		const index = new Map<string, CommentThreadView[]>();
		for (const thread of visibleThreads) {
			const key = threadLookupKey(
				thread.filePath,
				thread.anchor.side,
				thread.anchor.line,
			);
			const existing = index.get(key);
			if (existing) existing.push(thread);
			else index.set(key, [thread]);
		}
		return index;
	}, [visibleThreads]);

	const threadCountByFilePath = useMemo(() => {
		const map = new Map<string, number>();
		for (const thread of visibleThreads) {
			map.set(thread.filePath, (map.get(thread.filePath) ?? 0) + 1);
		}
		return map;
	}, [visibleThreads]);

	const fileStatsByPath = useMemo(() => {
		const map = new Map<string, { additions: number; deletions: number }>();
		for (const file of filteredFiles) {
			const path = file.newPath || file.oldPath;
			map.set(path, fileStats(file));
		}
		return map;
	}, [filteredFiles]);

	const fileChangeCountByPath = useMemo(() => {
		const map = new Map<string, number>();
		for (const file of filteredFiles) {
			const path = file.newPath || file.oldPath;
			map.set(path, fileChangeCount(file));
		}
		return map;
	}, [filteredFiles]);

	const tokenCacheRef = useRef<Map<string, HunkTokens | undefined>>(new Map());
	const widgetCacheRef = useRef<Map<string, Record<string, React.ReactNode>>>(new Map());
	useEffect(() => {
		tokenCacheRef.current.clear();
		widgetCacheRef.current.clear();
	}, [props.diff?.id, props.diff?.patch]);

	const getTokensForFile = useCallback(
		(path: string, hunks: Array<{ changes: unknown[] }>) => {
			const cache = tokenCacheRef.current;
			if (cache.has(path)) return cache.get(path);
			const tokens = measureDiffPerf(
				"tokenize_file",
				() => tokenizeHunks(hunks),
				{
					diffId: props.diff?.id,
					filePath: path,
					metadata: { enabled: ENABLE_DIFF_SYNTAX_HIGHLIGHT || ENABLE_DIFF_EDIT_MARKING },
				},
			);
			cache.set(path, tokens);
			return tokens;
		},
		[props.diff?.id],
	);

	const visibleThreadKey = useMemo(
		() =>
			visibleThreads
				.map((thread) => `${thread.id}:${thread.status}:${thread.updatedAt}:${thread.messages.length}`)
				.join("|"),
		[visibleThreads],
	);
	const draftKey = draftAnchor
		? `${draftAnchor.filePath}:${draftAnchor.side}:${draftAnchor.line}:${draftBody.length}`
		: "none";

	const getWidgetsForFile = useCallback(
		(
			file: {
				hunks: Array<{ changes: Array<{ type: string } & Record<string, unknown>> }>;
			},
			path: string,
		) => {
			const cacheKey = `${path}\u0000${visibleThreadKey}\u0000${draftKey}`;
			const cache = widgetCacheRef.current;
			const cached = cache.get(cacheKey);
			if (cached) return cached;
			const widgets = buildWidgetsForFile({
				diffId: props.diff?.id,
				file,
				path,
				threadIndex,
				draftAnchor,
				draftBody,
				onReplyToThread: props.onReplyToThread,
				onResolveThread: props.onResolveThread,
				onReopenThread: props.onReopenThread,
				onCancelDraft: () => {
					setDraftAnchor(null);
					setDraftBody("");
				},
				onSubmitDraft: async () => {
					if (!draftAnchor || !draftBody.trim()) return;
					await props.onCreateThread(draftAnchor, draftBody);
					setDraftBody("");
					setDraftAnchor(null);
				},
				onDraftBodyChange: setDraftBody,
			});
			cache.set(cacheKey, widgets);
			return widgets;
		},
		[
			draftAnchor,
			draftBody,
			draftKey,
			props.diff?.id,
			props.onCreateThread,
			props.onReopenThread,
			props.onReplyToThread,
			props.onResolveThread,
			threadIndex,
			visibleThreadKey,
		],
	);

	const fileListParentRef = useRef<HTMLDivElement | null>(null);
	const rowVirtualizer = useVirtualizer({
		count: filteredFiles.length,
		getScrollElement: () => fileListParentRef.current,
		estimateSize: () => 44,
		gap: 1,
	});

	const shouldVirtualizeDiffContent = filteredFiles.length > INLINE_DIFF_RENDER_FILE_LIMIT;

	const estimateDiffItemSize = useCallback((index: number) => {
		const file = filteredFiles[index];
		if (!file) return 120;
		const path = file.newPath || file.oldPath;
		if (collapsedFiles.has(path)) return 42;
		const changeCount = fileChangeCountByPath.get(path) ?? 0;
		const threadCount = threadCountByFilePath.get(path) ?? 0;
		const lineHeight = viewType === "split" ? 19 : 17;
		return Math.max(140, 56 + changeCount * lineHeight + threadCount * 120);
	}, [collapsedFiles, fileChangeCountByPath, filteredFiles, threadCountByFilePath, viewType]);

	const diffVirtualizer = useVirtualizer({
		count: filteredFiles.length,
		getScrollElement: () => diffContentRef.current,
		estimateSize: estimateDiffItemSize,
		overscan: 2,
		gap: 16,
	});

	useEffect(() => {
		recordDiffPerf({
			kind: "diff_render_mode",
			diffId: props.diff?.id,
			durationMs: 0,
			timestamp: Date.now(),
			metadata: {
				virtualized: shouldVirtualizeDiffContent,
				fileCount: filteredFiles.length,
			},
		});
	}, [filteredFiles.length, props.diff?.id, shouldVirtualizeDiffContent]);

	const revisionState = selectedRevision?.state;
	const hasDraftComments = (selectedRevision?.threads.length ?? 0) > 0;
	const hasAddressThis = (selectedRevision?.addressThisCount ?? 0) > 0;

	useEffect(() => {
		if (!selectionPopup) return;
		const dismiss = (e: MouseEvent) => {
			if (!(e.target as HTMLElement).closest("[data-selection-popup]")) {
				setSelectionPopup(null);
			}
		};
		const onEscape = (e: KeyboardEvent) => {
			if (e.key === "Escape") setSelectionPopup(null);
		};
		document.addEventListener("mousedown", dismiss);
		document.addEventListener("keydown", onEscape);
		return () => {
			document.removeEventListener("mousedown", dismiss);
			document.removeEventListener("keydown", onEscape);
		};
	}, [selectionPopup]);

	const scrollToFile = useCallback((filePath: string) => {
		const index = filteredFileIndexByPath.get(filePath);
		if (index === undefined) return;
		if (shouldVirtualizeDiffContent) {
			diffVirtualizer.scrollToIndex(index, { align: "start" });
			return;
		}
		const target = diffContentRef.current?.querySelector<HTMLElement>(
			`[data-file-path="${CSS.escape(filePath)}"]`,
		);
		target?.scrollIntoView({ block: "start" });
	}, [diffVirtualizer, filteredFileIndexByPath, shouldVirtualizeDiffContent]);

	const handleDiffMouseUp = useCallback(
		(_e: React.MouseEvent) => {
			const sel = window.getSelection();
			if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
			if (!diffContentRef.current || !props.diff) return;

			const selectedText = sel.toString();
			if (selectedText.trim().length < MIN_SELECTION_CHARS) return;
			const range = sel.getRangeAt(0);
			const startElement = range.startContainer.parentElement;
			if (!startElement?.closest(".diff-code")) return;
			const rect = range.getBoundingClientRect();
			const popupX = rect.left + rect.width / 2;
			const popupY = rect.top - 8;

			let node: Node | null = sel.anchorNode;
			let row: HTMLElement | null = null;
			while (node && node !== diffContentRef.current) {
				if (node instanceof HTMLElement && node.tagName === "TR") {
					row = node;
					break;
				}
				node = node.parentNode;
			}
			if (!row) return;

			let el: HTMLElement | null = row;
			while (el && !el.dataset?.filePath) {
				el = el.parentElement;
			}
			if (!el?.dataset?.filePath) return;
			const filePath = el.dataset.filePath;

			const isDelete = row.querySelector(".diff-gutter-delete") !== null;
			const side: "old" | "new" = isDelete ? "old" : "new";

			const gutterCells = Array.from(row.querySelectorAll(".diff-gutter"));
			let lineNumber: number | null = null;
			if (isDelete) {
				const num = parseInt(gutterCells[0]?.textContent || "", 10);
				if (!isNaN(num)) lineNumber = num;
			} else {
				for (let i = gutterCells.length - 1; i >= 0; i--) {
					const num = parseInt(gutterCells[i]?.textContent || "", 10);
					if (!isNaN(num)) {
						lineNumber = num;
						break;
					}
				}
			}
			if (lineNumber === null) return;

			setSelectionPopup({
				x: popupX,
				y: popupY,
				selectedText,
				filePath,
				lineNumber,
				side,
			});
		},
		[props.diff],
	);

	const handleCommentFromSelection = useCallback(() => {
		if (!selectionPopup || !props.diff) return;

		const file = filteredFiles.find(
			(f) => (f.newPath || f.oldPath) === selectionPopup.filePath,
		);
		if (!file) return;

		for (const hunk of file.hunks) {
			for (const change of hunk.changes) {
				let line: number | undefined;
				if (selectionPopup.side === "old" && "oldLineNumber" in change) {
					line = change.oldLineNumber as number;
				} else if (selectionPopup.side === "new") {
					if ("lineNumber" in change) line = change.lineNumber as number;
					else if ("oldLineNumber" in change)
						line = change.oldLineNumber as number;
				}
				if (line === selectionPopup.lineNumber) {
					setDraftAnchor(
						createAnchorFromChange({
							file,
							hunk,
							change,
							diff: props.diff!,
						}),
					);
					const quoted = selectionPopup.selectedText
						.split("\n")
						.map((l) => `> ${l}`)
						.join("\n");
					setDraftBody(`${quoted}\n\n`);
					setSelectionPopup(null);
					window.getSelection()?.removeAllRanges();
					return;
				}
			}
		}
	}, [selectionPopup, filteredFiles, props.diff]);

	const renderFile = useCallback(
		(
			file: (typeof filteredFiles)[number],
			key: React.Key,
			options?: {
				style?: React.CSSProperties;
				index?: number;
				measure?: boolean;
			},
		) => {
			if (!file) return null;
			const path = file.newPath || file.oldPath;
			const isCollapsed = collapsedFiles.has(path);
			const tokens = isCollapsed ? undefined : getTokensForFile(path, file.hunks);
			const stats = fileStatsByPath.get(path) ?? { additions: 0, deletions: 0 };
			const widgets = isCollapsed ? undefined : getWidgetsForFile(file as never, path);
			return (
				<div
					key={key}
					ref={options?.measure ? diffVirtualizer.measureElement : undefined}
					data-index={options?.index}
					className={options?.style ? "absolute left-0 right-0" : undefined}
					style={options?.style}
				>
					<div data-file-path={path}>
						<button
							type="button"
							onClick={() =>
								setCollapsedFiles((prev) => {
									const next = new Set(prev);
									if (next.has(path)) next.delete(path);
									else next.add(path);
									return next;
								})
							}
							className="mb-1.5 flex w-full items-center gap-2 border-b border-surface-border pb-1.5 text-left transition hover:bg-white/[0.02]"
						>
							<ChevronRight
								className={`h-3.5 w-3.5 shrink-0 text-white/25 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
							/>
							<span className="mono text-xs text-white/60 truncate flex-1">{path}</span>
							<span className="text-2xs text-state-applied">+{stats.additions}</span>
							<span className="text-2xs text-state-error">-{stats.deletions}</span>
							<span className="text-2xs uppercase tracking-wider text-white/25">
								{file.type}
							</span>
						</button>
						{isCollapsed ? null : (
							<Diff
								viewType={viewType}
								diffType={file.type}
								hunks={file.hunks}
								tokens={tokens}
								gutterType="default"
								gutterEvents={{
									onClick: ({ change }) => {
										if (!change || !props.diff) return;
										const hunk = file.hunks.find((candidate) =>
											candidate.changes.includes(change),
										);
										if (!hunk) return;
										setDraftAnchor(
											createAnchorFromChange({
												file,
												hunk,
												change,
												diff: props.diff,
											}),
										);
									},
								}}
								widgets={widgets}
							>
								{(hunks) =>
									hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
							</Diff>
						)}
					</div>
				</div>
			);
		},
		[
			collapsedFiles,
			diffVirtualizer.measureElement,
			fileStatsByPath,
			getTokensForFile,
			getWidgetsForFile,
			props.diff,
			viewType,
		],
	);

	useEffect(() => {
		const diffId = props.diff?.id;
		if (!diffId) return;
		const start = performance.now();
		const raf = window.requestAnimationFrame(() => {
			recordDiffPerf({
				kind: "diff_render",
				diffId,
				durationMs: performance.now() - start,
				timestamp: Date.now(),
				metadata: {
					fileCount: filteredFiles.length,
					virtualized: shouldVirtualizeDiffContent,
					viewType,
				},
			});
		});
		return () => window.cancelAnimationFrame(raf);
	}, [filteredFiles.length, props.diff?.id, shouldVirtualizeDiffContent, viewType]);

	if (!props.diff) {
		return (
			<section className="flex h-full flex-col border-l border-surface-border bg-surface-0">
				<div className="flex items-center border-b border-surface-border px-3 py-2">
					<button
						onClick={() => setInspectorOpen(!inspectorOpen)}
						className="flex items-center gap-1 text-xs text-white/40 transition hover:text-white/60"
					>
						<Info className="h-3 w-3" />
						Inspector
					</button>
				</div>
				{inspectorOpen ? (
					<div className="overflow-auto border-b border-surface-border px-3 py-3">
						<MemoizedSessionInspector
							session={props.session}
							inspector={props.inspector}
							onCreateManualCheckpoint={props.onCreateManualCheckpoint}
							onRepairWorktree={props.onRepairWorktree}
						/>
					</div>
				) : null}
				<div className="flex flex-1 items-center justify-center">
					<div className="text-center text-white/30">
						<GitCompare className="mx-auto mb-2 h-8 w-8 text-white/15" />
						<p className="text-xs">
							Open a session with changes to view diffs.
						</p>
					</div>
				</div>
			</section>
		);
	}

	return (
		<section className="flex h-full flex-col border-l border-surface-border bg-surface-0">
			{/* Toolbar */}
			<div className="border-b border-surface-border px-3 py-2">
				<div className="flex flex-wrap items-center gap-1.5">
					{/* Revision tabs */}
					{props.revisions.length > 0 && (
						<div className="flex items-center">
							{props.revisions.map((rev) => (
								<button
									key={rev.id}
									onClick={() => props.onSelectRevision(rev.revisionNumber)}
									className={`relative px-2 py-1 text-xs transition ${
										rev.revisionNumber === props.selectedRevisionNumber
											? "bg-accent/15 text-accent font-medium"
											: "text-white/40 hover:text-white/60 hover:bg-white/5"
									}`}
								>
									Rev {rev.revisionNumber}
									{rev.revisionNumber === props.activeRevisionNumber && (
										<span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-accent" />
									)}
								</button>
							))}
						</div>
					)}
					{/* Diff mode toggle */}
					<div className="flex border border-surface-border">
						<button
							onClick={() => props.onSetDiffMode("incremental")}
							className={`px-2 py-1 text-xs transition ${
								props.diffMode === "incremental"
									? "bg-accent/15 text-accent"
									: "bg-surface-2 text-white/40 hover:text-white/60"
							}`}
						>
							Incremental
						</button>
						<button
							onClick={() => props.onSetDiffMode("cumulative")}
							className={`px-2 py-1 text-xs transition ${
								props.diffMode === "cumulative"
									? "bg-accent/15 text-accent"
									: "bg-surface-2 text-white/40 hover:text-white/60"
							}`}
						>
							Cumulative
						</button>
					</div>
					<button
						onClick={() =>
							setViewType((current) => (current === "split" ? "unified" : "split"))
						}
						className="flex items-center gap-1 border border-surface-border bg-surface-2 px-2 py-1 text-xs text-white/50 transition hover:text-white/70"
					>
						{viewType === "split" ? (
							<><SplitSquareHorizontal className="h-3 w-3" /> Split</>
						) : (
							<><Rows3 className="h-3 w-3" /> Unified</>
						)}
					</button>
					<div className="relative">
						<Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-white/25" />
						<input
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							placeholder="Filter files"
							className="border border-surface-border bg-surface-2 py-1 pl-6 pr-2 text-xs text-white/70 placeholder:text-white/20 outline-none"
						/>
					</div>
					<label className="flex items-center gap-1.5 text-xs text-white/40">
						<input
							type="checkbox"
							checked={unresolvedOnly}
							onChange={(event) => setUnresolvedOnly(event.target.checked)}
							className="accent-accent"
						/>
						Unresolved
					</label>
					<button
						onClick={() => setInspectorOpen(!inspectorOpen)}
						className={`flex items-center gap-1 border border-surface-border px-2 py-1 text-xs transition hover:text-white/70 ${inspectorOpen ? "bg-accent/15 text-accent" : "bg-surface-2 text-white/40"}`}
					>
						<Info className="h-3 w-3" />
						Inspector
					</button>
					{props.diffStale ? (
						<div className="flex items-center gap-1 text-xs text-state-review">
							<AlertTriangle className="h-3 w-3" />
							Stale
						</div>
					) : null}
				</div>
				<div className="mt-1.5 flex flex-wrap items-center gap-3 text-2xs text-white/35">
					<span className="font-medium text-white/60">{props.diff.title}</span>
					<span>{props.diff.fromLabel} → {props.diff.toLabel}</span>
					<span>{props.diff.stats.filesChanged} files</span>
					<span className="text-state-applied">+{props.diff.stats.additions}</span>
					<span className="text-state-error">-{props.diff.stats.deletions}</span>
				</div>
				{/* Action buttons */}
				<div className="mt-2 flex flex-col gap-1.5">
					{revisionState === "approved" ? (
						<>
							{(() => {
								const done = props.session?.status === "completed" || props.session?.status === "merged";
								return (
									<>
										{props.session?.mode === "worktree" && !done && (
											<input
												type="text"
												value={commitMessage}
												onChange={(e) => setCommitMessage(e.target.value)}
												placeholder="Commit message (optional)"
												className="w-full rounded bg-surface-2 border border-surface-border px-2 py-1 text-xs text-white/80 placeholder-white/30 outline-none focus:border-accent/50"
											/>
										)}
										<div className="flex gap-1.5">
											<button
												onClick={props.onApplyRevision}
												disabled={done}
												className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium ${done ? "bg-state-applied/40 text-black/40 cursor-not-allowed" : "bg-state-applied text-black"}`}
											>
												<Play className="h-3 w-3" />
												{props.session?.status === "completed" ? "Applied" : "Apply"}
											</button>
											{props.session?.mode === "worktree" && (
												<button
													onClick={() => props.onApplyAndMerge(commitMessage || undefined)}
													disabled={done}
													className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium ${done ? "bg-state-applied/40 text-black/40 cursor-not-allowed" : "bg-state-applied text-black"}`}
												>
													<GitMerge className="h-3 w-3" />
													{props.session?.status === "merged" ? "Merged" : "Apply & Merge"}
												</button>
											)}
										</div>
									</>
								);
							})()}
						</>
					) : (
						<>
							{revisionState === "discussing" && (
								<button
									disabled
									className="flex items-center gap-1 bg-accent/50 px-2.5 py-1 text-xs font-medium text-black/60 cursor-not-allowed"
								>
									<Loader2 className="h-3 w-3 animate-spin" />
									Processing…
								</button>
							)}
							{revisionState === "active" && hasDraftComments && (
								<button
									onClick={props.onPublishComments}
									className="flex items-center gap-1 bg-accent px-2.5 py-1 text-xs font-medium text-black"
								>
									<Send className="h-3 w-3" />
									Publish Comments
								</button>
							)}
							{revisionState === "resolved" && hasAddressThis && (
								<button
									onClick={props.onStartNextRevision}
									className="flex items-center gap-1 bg-accent px-2.5 py-1 text-xs font-medium text-black"
								>
									<Play className="h-3 w-3" />
									Start Next Revision
								</button>
							)}
							{/* Approve is always available (except when already approved) */}
							<button
								onClick={props.onApprove}
								className="flex items-center gap-1 bg-state-applied px-2.5 py-1 text-xs font-medium text-black"
							>
								<CheckCircle2 className="h-3 w-3" />
								Approve
							</button>
						</>
					)}
				</div>
			</div>

			<div className={`grid min-h-0 flex-1 ${fileListCollapsed ? "grid-cols-[auto_minmax(0,1fr)]" : "grid-cols-[240px_minmax(0,1fr)]"}`}>
				{/* File list + optional Inspector sidebar */}
				{fileListCollapsed ? (
					<button
						onClick={() => setFileListCollapsed(false)}
						className="flex items-center justify-center border-r border-surface-border px-1 text-white/30 transition hover:bg-white/5 hover:text-white/50"
						title="Show file list"
					>
						<PanelLeftOpen className="h-3.5 w-3.5" />
					</button>
				) : (
					<div className="flex flex-col overflow-hidden border-r border-surface-border">
						<div className="flex items-center justify-between border-b border-surface-border px-2.5 py-1.5">
							<span className="text-2xs font-medium uppercase tracking-wider text-white/40">Files</span>
							<button
								onClick={() => setFileListCollapsed(true)}
								className="text-white/30 transition hover:text-white/50"
								title="Hide file list"
							>
								<PanelLeftClose className="h-3.5 w-3.5" />
							</button>
						</div>
						<div ref={fileListParentRef} className="flex-1 overflow-auto px-2 py-1">
							{inspectorOpen ? (
								<div className="mb-2 border-b border-surface-border pb-2">
									<MemoizedSessionInspector
										session={props.session}
										inspector={props.inspector}
										onCreateManualCheckpoint={props.onCreateManualCheckpoint}
										onRepairWorktree={props.onRepairWorktree}
									/>
								</div>
							) : null}
							<div
								style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: "relative" }}
							>
								{rowVirtualizer.getVirtualItems().map((item) => {
									const file = filteredFiles[item.index];
									const path = file.newPath || file.oldPath;
									const stats = fileStatsByPath.get(path) ?? { additions: 0, deletions: 0 };
									return (
										<button
											key={item.key}
											onClick={() => scrollToFile(path)}
											className="absolute left-0 right-0 border-b border-surface-border px-2.5 py-1.5 text-xs text-left hover:bg-white/5 cursor-pointer"
											style={{ transform: `translateY(${item.start}px)` }}
										>
											<div className="truncate font-medium text-white/70 mono text-2xs">
												{path}
											</div>
											<div className="mt-0.5 text-2xs text-white/25">
												<span className="text-state-applied">+{stats.additions}</span>
												{" "}
												<span className="text-state-error">-{stats.deletions}</span>
											</div>
										</button>
									);
								})}
							</div>
						</div>
					</div>
				)}

				{/* Diff content */}
				<div ref={diffContentRef} className="diff-shell overflow-auto px-3 py-3" onMouseUp={handleDiffMouseUp}>
					{shouldVirtualizeDiffContent ? (
						<div style={{ height: `${diffVirtualizer.getTotalSize()}px`, position: "relative" }}>
							{diffVirtualizer.getVirtualItems().map((item) =>
								renderFile(filteredFiles[item.index], item.key, {
									index: item.index,
									measure: true,
									style: { transform: `translateY(${item.start}px)` },
								}),
							)}
						</div>
					) : (
						<div className="space-y-4">
							{filteredFiles.map((file, index) => renderFile(file, file.newPath || file.oldPath || index))}
						</div>
					)}
				</div>
			</div>

			{selectionPopup && (
				<div
					data-selection-popup
					className="fixed z-50 -translate-x-1/2 -translate-y-full border border-surface-border bg-surface-2 shadow-lg"
					style={{ left: selectionPopup.x, top: selectionPopup.y }}
					onMouseDown={(e) => e.stopPropagation()}
				>
					<button
						onClick={handleCommentFromSelection}
						className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white/70 transition hover:bg-white/5 hover:text-white"
					>
						<MessageSquarePlus className="h-3.5 w-3.5" />
						Comment
					</button>
				</div>
			)}
		</section>
	);
}

function areDiffPanePropsEqual(prev: DiffPaneProps, next: DiffPaneProps) {
	return (
		prev.session === next.session &&
		prev.inspector === next.inspector &&
		prev.diff === next.diff &&
		prev.revisions === next.revisions &&
		prev.activeRevisionNumber === next.activeRevisionNumber &&
		prev.selectedRevisionNumber === next.selectedRevisionNumber &&
		prev.diffMode === next.diffMode &&
		prev.defaultView === next.defaultView &&
		prev.diffStale === next.diffStale
	);
}

export const DiffPane = memo(DiffPaneComponent, areDiffPanePropsEqual);
