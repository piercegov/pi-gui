import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
	Diff,
	getChangeKey,
	Hunk,
	parseDiff,
	tokenize,
} from "react-diff-view";
import type { ChangeData, FileData, HunkData, HunkTokens } from "react-diff-view";
import { useVirtualizer } from "@tanstack/react-virtual";
import { SplitSquareHorizontal, Rows3, Search, CheckCircle2, Send, GitCompare, AlertTriangle, Info, MessageSquarePlus, Loader2, MessageSquare, ChevronDown, ChevronRight, Flag, Check, Play, GitMerge, PanelLeftClose, PanelLeftOpen, X, ArrowUp, ArrowDown } from "lucide-react";
import type {
	CommentAnchor,
	CommentThreadView,
	DiffFileStat,
	DiffSnapshotView,
	DiffViewMode,
	SessionInspectorView,
	SessionSummary,
	ThreadResolution,
} from "@shared/models";
import {
	DIFF_CHUNK_TARGET_ROWS,
	shouldChunkFile,
	shouldVirtualizeDiff,
	splitFileHunks,
} from "@ui/lib/diff-chunks";
import { detectDiffLanguage } from "@ui/lib/diff-language";
import { refractorCompat } from "@ui/lib/refractor-compat";
import { createAnchorFromChange } from "@ui/lib/diff-utils";
import { measureDiffPerf, recordDiffPerf } from "@ui/lib/diff-perf";
import { MarkdownRenderer } from "@ui/lib/markdown";
import { useReviewStore } from "@ui/stores/review-store";
import { MemoizedSessionInspector } from "./session-inspector";

const MIN_SELECTION_CHARS = 2;
const ENABLE_DIFF_SYNTAX_HIGHLIGHT = true;
const ENABLE_DIFF_EDIT_MARKING = false;
const MAX_PARSED_DIFF_CACHE_ENTRIES = 24;

type ParsedDiffModel = {
	files: FileData[];
	fileByPath: Map<string, FileData>;
	fileStatsByPath: Map<string, DiffFileStat>;
	fileChangeCountByPath: Map<string, number>;
	fileRenderSegmentsByPath: Map<string, HunkData[][]>;
	totalChangeCount: number;
	largestFileChangeCount: number;
};

type DiffRenderItem =
	| {
			kind: "header";
			path: string;
			file: FileData;
			isCollapsed: boolean;
	  }
	| {
			kind: "body";
			path: string;
			file: FileData;
			hunks: HunkData[];
			segmentIndex: number;
			changeCount: number;
	  };

type TokenizeWorkerSuccess = {
	jobId: number;
	success: true;
	tokens: HunkTokens | null;
};

type TokenizeWorkerFailure = {
	jobId: number;
	success: false;
	error: string;
};

const parsedDiffCache = new Map<string, ParsedDiffModel>();
const diffTokenCache = new Map<string, HunkTokens | null>();
const diffTokenInflight = new Map<string, Promise<HunkTokens | undefined>>();
const diffTokenJobResolvers = new Map<
	number,
	{
		key: string;
		startedAt: number;
		diffId?: string;
		filePath: string;
		resolve: (tokens: HunkTokens | undefined) => void;
		reject: (error: Error) => void;
	}
>();
let diffTokenWorker: Worker | null = null;
let diffTokenJobId = 0;

function rememberParsedDiff(cacheKey: string, model: ParsedDiffModel) {
	if (parsedDiffCache.has(cacheKey)) {
		parsedDiffCache.delete(cacheKey);
	}
	parsedDiffCache.set(cacheKey, model);
	while (parsedDiffCache.size > MAX_PARSED_DIFF_CACHE_ENTRIES) {
		const oldestKey = parsedDiffCache.keys().next().value;
		if (!oldestKey) break;
		parsedDiffCache.delete(oldestKey);
	}
	return model;
}

function buildParsedDiffModel(diff?: DiffSnapshotView): ParsedDiffModel {
	if (!diff) {
		return {
			files: [],
			fileByPath: new Map(),
			fileStatsByPath: new Map(),
			fileChangeCountByPath: new Map(),
			fileRenderSegmentsByPath: new Map(),
			totalChangeCount: 0,
			largestFileChangeCount: 0,
		};
	}

	const cached = parsedDiffCache.get(diff.cacheKey);
	if (cached) {
		recordDiffPerf({
			kind: "parse_diff",
			diffId: diff.cacheKey,
			durationMs: 0,
			timestamp: Date.now(),
			metadata: {
				cacheHit: true,
				patchBytes: diff.patch.length,
				fileCount: cached.files.length,
			},
		});
		return rememberParsedDiff(diff.cacheKey, cached);
	}

	const files = measureDiffPerf(
		"parse_diff",
		() => parseDiff(diff.patch, { nearbySequences: "zip" }),
		{
			diffId: diff.cacheKey,
			metadata: {
				cacheHit: false,
				patchBytes: diff.patch.length,
				fileCount: diff.stats.filesChanged,
			},
		},
	);

	const fileByPath = new Map<string, FileData>();
	const fileChangeCountByPath = new Map<string, number>();
	const fileRenderSegmentsByPath = new Map<string, HunkData[][]>();
	let totalChangeCount = 0;
	let largestFileChangeCount = 0;

	for (const file of files) {
		const path = file.newPath || file.oldPath;
		fileByPath.set(path, file);
		let changeCount = 0;
		for (const hunk of file.hunks) {
			changeCount += hunk.changes.length;
		}
		totalChangeCount += changeCount;
		largestFileChangeCount = Math.max(largestFileChangeCount, changeCount);
		fileChangeCountByPath.set(path, changeCount);
		const renderSegments = shouldChunkFile(changeCount, file.hunks.length)
			? splitFileHunks(file.hunks, DIFF_CHUNK_TARGET_ROWS).map((chunk) => [chunk])
			: [file.hunks];
		fileRenderSegmentsByPath.set(path, renderSegments);
	}

	const fileStatsByPath = new Map<string, DiffFileStat>();
	for (const fileStat of diff.files) {
		fileStatsByPath.set(fileStat.path, fileStat);
		if (fileStat.oldPath) {
			fileStatsByPath.set(fileStat.oldPath, fileStat);
		}
	}

	return rememberParsedDiff(diff.cacheKey, {
		files,
		fileByPath,
		fileStatsByPath,
		fileChangeCountByPath,
		fileRenderSegmentsByPath,
		totalChangeCount,
		largestFileChangeCount,
	});
}

let diffTokenWorkerFailed = false;

function tokenizeOnMainThread(language: string, hunks: HunkData[]): HunkTokens | undefined {
	if (!language || !refractorCompat.registered(language)) return undefined;
	try {
		return tokenize(hunks, { highlight: true, refractor: refractorCompat, language });
	} catch {
		return undefined;
	}
}

function getDiffTokenWorker() {
	if (typeof window === "undefined" || diffTokenWorkerFailed) return null;
	if (diffTokenWorker) return diffTokenWorker;
	try {
		diffTokenWorker = new Worker(
			new URL("../../workers/diff-tokenize-worker.ts", import.meta.url),
			{ type: "module" },
		);
	} catch {
		console.warn("[diff] Web Worker creation failed, falling back to main-thread tokenization");
		diffTokenWorkerFailed = true;
		return null;
	}
	diffTokenWorker.addEventListener(
		"message",
		(event: MessageEvent<TokenizeWorkerSuccess | TokenizeWorkerFailure>) => {
			const resolver = diffTokenJobResolvers.get(event.data.jobId);
			if (!resolver) return;
			diffTokenJobResolvers.delete(event.data.jobId);
			if (!event.data.success) {
				diffTokenCache.set(resolver.key, null);
				diffTokenInflight.delete(resolver.key);
				resolver.reject(new Error(event.data.error));
				return;
			}
			diffTokenCache.set(resolver.key, event.data.tokens);
			diffTokenInflight.delete(resolver.key);
			recordDiffPerf({
				kind: "tokenize_worker",
				diffId: resolver.diffId,
				filePath: resolver.filePath,
				durationMs: performance.now() - resolver.startedAt,
				timestamp: Date.now(),
				metadata: {
					cacheHit: false,
					hasTokens: Boolean(event.data.tokens),
				},
			});
			resolver.resolve(event.data.tokens ?? undefined);
		},
	);
	diffTokenWorker.addEventListener("error", (event) => {
		console.warn("[diff] Web Worker error, falling back to main-thread tokenization", event.message);
		diffTokenWorkerFailed = true;
		diffTokenWorker = null;
		// Reject all pending jobs so they can retry on main thread
		for (const [jobId, resolver] of diffTokenJobResolvers) {
			diffTokenJobResolvers.delete(jobId);
			diffTokenInflight.delete(resolver.key);
			resolver.reject(new Error("Worker failed"));
		}
	});
	return diffTokenWorker;
}

function requestFileTokens(params: {
	diffId?: string;
	diffKey: string;
	filePath: string;
	language?: string;
	hunks: HunkData[];
}) {
	if (!ENABLE_DIFF_SYNTAX_HIGHLIGHT || !params.language || params.hunks.length === 0) {
		return Promise.resolve(undefined);
	}
	const cacheKey = `${params.diffKey}\u0000${params.filePath}\u0000${params.language}`;
	if (diffTokenCache.has(cacheKey)) {
		recordDiffPerf({
			kind: "tokenize_file",
			diffId: params.diffId,
			filePath: params.filePath,
			durationMs: 0,
			timestamp: Date.now(),
			metadata: {
				cacheHit: true,
				language: params.language,
				hasTokens: Boolean(diffTokenCache.get(cacheKey)),
			},
		});
		return Promise.resolve(diffTokenCache.get(cacheKey) ?? undefined);
	}
	const inflight = diffTokenInflight.get(cacheKey);
	if (inflight) return inflight;

	recordDiffPerf({
		kind: "tokenize_file",
		diffId: params.diffId,
		filePath: params.filePath,
		durationMs: 0,
		timestamp: Date.now(),
		metadata: {
			cacheHit: false,
			language: params.language,
			changeCount: params.hunks.reduce((count, hunk) => count + hunk.changes.length, 0),
		},
	});

	const worker = getDiffTokenWorker();
	if (!worker) {
		// Main-thread fallback
		const start = performance.now();
		const tokens = tokenizeOnMainThread(params.language, params.hunks);
		diffTokenCache.set(cacheKey, tokens ?? null);
		recordDiffPerf({
			kind: "tokenize_worker",
			diffId: params.diffId,
			filePath: params.filePath,
			durationMs: performance.now() - start,
			timestamp: Date.now(),
			metadata: { cacheHit: false, hasTokens: Boolean(tokens), mainThread: true },
		});
		return Promise.resolve(tokens);
	}

	const promise = new Promise<HunkTokens | undefined>((resolve, reject) => {
		const jobId = ++diffTokenJobId;
		diffTokenJobResolvers.set(jobId, {
			key: cacheKey,
			startedAt: performance.now(),
			diffId: params.diffId,
			filePath: params.filePath,
			resolve,
			reject,
		});
		worker.postMessage({
			jobId,
			language: params.language,
			hunks: params.hunks,
		});
	}).catch(() => {
		// Worker failed for this job — retry on main thread
		const tokens = tokenizeOnMainThread(params.language!, params.hunks);
		diffTokenCache.set(cacheKey, tokens ?? null);
		return tokens;
	});

	diffTokenInflight.set(cacheKey, promise);
	return promise;
}

function useDiffTokens(params: {
	diffId?: string;
	diffKey?: string;
	filePath: string;
	language?: string;
	hunks: HunkData[];
	enabled: boolean;
}) {
	const [tokens, setTokens] = useState<HunkTokens | undefined>(undefined);

	useEffect(() => {
		let cancelled = false;
		if (!params.enabled || !params.diffKey || !params.language || params.hunks.length === 0) {
			setTokens(undefined);
			return;
		}
		const cacheKey = `${params.diffKey}\u0000${params.filePath}\u0000${params.language}`;
		if (diffTokenCache.has(cacheKey)) {
			setTokens(diffTokenCache.get(cacheKey) ?? undefined);
			return;
		}
		setTokens(undefined);
		void requestFileTokens({
			diffId: params.diffId,
			diffKey: params.diffKey,
			filePath: params.filePath,
			language: params.language,
			hunks: params.hunks,
		}).then((nextTokens) => {
			if (!cancelled) setTokens(nextTokens);
		});
		return () => {
			cancelled = true;
		};
	}, [params.diffId, params.diffKey, params.enabled, params.filePath, params.hunks, params.language]);

	return tokens;
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

function lineValue(change: ChangeData, side: "old" | "new") {
	if (side === "old" && "oldLineNumber" in change) {
		return change.oldLineNumber ?? -1;
	}
	if ("lineNumber" in change) {
		return change.lineNumber ?? -1;
	}
	if ("oldLineNumber" in change) {
		return change.oldLineNumber ?? -1;
	}
	return -1;
}

function threadLookupKey(filePath: string, side: "old" | "new", line: number) {
	return `${filePath}\u0000${side}\u0000${line}`;
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
	file: FileData;
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

function DiffFileHeader(props: {
	path: string;
	stats: { additions: number; deletions: number; type: string };
	isCollapsed: boolean;
	onToggle: () => void;
}) {
	return (
		<div data-file-path={props.path}>
			<button
				type="button"
				onClick={props.onToggle}
				className="mb-1.5 flex w-full items-center gap-2 border-b border-surface-border pb-1.5 text-left transition hover:bg-white/[0.02]"
			>
				<ChevronRight
					className={`h-3.5 w-3.5 shrink-0 text-white/25 transition-transform ${props.isCollapsed ? "" : "rotate-90"}`}
				/>
				<span className="mono flex-1 truncate text-xs text-white/60">{props.path}</span>
				<span className="text-2xs text-state-applied">+{props.stats.additions}</span>
				<span className="text-2xs text-state-error">-{props.stats.deletions}</span>
				<span className="text-2xs uppercase tracking-wider text-white/25">
					{props.stats.type}
				</span>
			</button>
		</div>
	);
}

const MemoizedDiffFileHeader = memo(DiffFileHeader);

function DiffBodySection(props: {
	diff?: DiffSnapshotView;
	file: FileData;
	path: string;
	hunks: HunkData[];
	viewType: DiffViewMode;
	widgets?: Record<string, React.ReactNode>;
	onSelectChange: (file: FileData, change: ChangeData) => void;
}) {
	const language = useMemo(() => detectDiffLanguage(props.path), [props.path]);
	const tokens = useDiffTokens({
		diffId: props.diff?.cacheKey,
		diffKey: props.diff?.cacheKey,
		filePath: props.path,
		language,
		hunks: props.file.hunks,
		enabled: ENABLE_DIFF_SYNTAX_HIGHLIGHT || ENABLE_DIFF_EDIT_MARKING,
	});

	return (
		<div data-file-path={props.path}>
			<Diff
				viewType={props.viewType}
				diffType={props.file.type}
				hunks={props.hunks}
				tokens={tokens}
				gutterType="default"
				gutterEvents={{
					onClick: ({ change }) => {
						if (!change) return;
						props.onSelectChange(props.file, change);
					},
				}}
				widgets={props.widgets}
			>
				{(hunks) =>
					hunks.map((hunk) => (
						<Hunk
							key={`${hunk.content}-${hunk.oldStart}-${hunk.newStart}`}
							hunk={hunk}
						/>
					))}
			</Diff>
		</div>
	);
}

const MemoizedDiffBodySection = memo(
	DiffBodySection,
	(prev, next) =>
		prev.diff?.cacheKey === next.diff?.cacheKey &&
		prev.file === next.file &&
		prev.hunks === next.hunks &&
		prev.viewType === next.viewType &&
		prev.widgets === next.widgets &&
		prev.path === next.path,
);

// --- Content search (Cmd/Ctrl+F) ---

function collectTextNodes(root: HTMLElement): Text[] {
	const nodes: Text[] = [];
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	let node: Text | null;
	while ((node = walker.nextNode() as Text | null)) {
		if (node.textContent && node.textContent.length > 0) {
			nodes.push(node);
		}
	}
	return nodes;
}

function findMatchRanges(root: HTMLElement, query: string): Range[] {
	if (!query) return [];
	const lower = query.toLowerCase();
	const ranges: Range[] = [];
	const textNodes = collectTextNodes(root);
	for (const node of textNodes) {
		const text = node.textContent!.toLowerCase();
		let start = 0;
		while (true) {
			const idx = text.indexOf(lower, start);
			if (idx === -1) break;
			const range = document.createRange();
			range.setStart(node, idx);
			range.setEnd(node, idx + query.length);
			ranges.push(range);
			start = idx + 1;
		}
	}
	return ranges;
}

const HIGHLIGHT_NAME = "diff-search";
const HIGHLIGHT_CURRENT_NAME = "diff-search-current";
const hasHighlightAPI = typeof CSS !== "undefined" && "highlights" in CSS;

function applyHighlights(ranges: Range[], currentIndex: number) {
	if (!hasHighlightAPI) return;
	const hl = new Highlight(...ranges);
	const currentRange = ranges[currentIndex];
	const hlCurrent = currentRange ? new Highlight(currentRange) : new Highlight();
	CSS.highlights.set(HIGHLIGHT_NAME, hl);
	CSS.highlights.set(HIGHLIGHT_CURRENT_NAME, hlCurrent);
}

function clearHighlights() {
	if (!hasHighlightAPI) return;
	CSS.highlights.set(HIGHLIGHT_NAME, new Highlight());
	CSS.highlights.set(HIGHLIGHT_CURRENT_NAME, new Highlight());
}

type DiffContentSearchProps = {
	visible: boolean;
	onClose: () => void;
	containerRef: React.RefObject<HTMLDivElement | null>;
};

function DiffContentSearch({ visible, onClose, containerRef }: DiffContentSearchProps) {
	const [query, setQuery] = useState("");
	const [matches, setMatches] = useState<Range[]>([]);
	const [currentMatch, setCurrentMatch] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const deferredQuery = useDeferredValue(query);

	useEffect(() => {
		if (visible) {
			inputRef.current?.focus();
			inputRef.current?.select();
		} else {
			clearHighlights();
		}
	}, [visible]);

	useEffect(() => {
		if (!visible || !containerRef.current || !deferredQuery) {
			setMatches([]);
			setCurrentMatch(0);
			clearHighlights();
			return;
		}
		const ranges = findMatchRanges(containerRef.current, deferredQuery);
		setMatches(ranges);
		setCurrentMatch(ranges.length > 0 ? 0 : -1);
		if (ranges.length > 0) {
			applyHighlights(ranges, 0);
		} else {
			clearHighlights();
		}
	}, [deferredQuery, visible, containerRef]);

	// Clear highlights immediately when raw query is emptied, don't wait for deferred.
	// Also clear stale matches so other effects don't re-apply them.
	useEffect(() => {
		if (!query) {
			setMatches([]);
			setCurrentMatch(0);
			clearHighlights();
		}
	}, [query]);

	useEffect(() => {
		if (!query || matches.length === 0 || currentMatch < 0) return;
		applyHighlights(matches, currentMatch);
		const range = matches[currentMatch];
		if (range) {
			const rect = range.getBoundingClientRect();
			const container = containerRef.current;
			if (container) {
				const containerRect = container.getBoundingClientRect();
				const isVisible =
					rect.top >= containerRect.top &&
					rect.bottom <= containerRect.bottom;
				if (!isVisible) {
					const el = range.startContainer.parentElement;
					el?.scrollIntoView({ block: "center" });
				}
			}
		}
	}, [query, currentMatch, matches, containerRef]);

	const goNext = useCallback(() => {
		if (matches.length === 0) return;
		setCurrentMatch((prev) => (prev + 1) % matches.length);
	}, [matches.length]);

	const goPrev = useCallback(() => {
		if (matches.length === 0) return;
		setCurrentMatch((prev) => (prev - 1 + matches.length) % matches.length);
	}, [matches.length]);

	const close = useCallback(() => {
		setQuery("");
		setMatches([]);
		setCurrentMatch(0);
		clearHighlights();
		onClose();
	}, [onClose]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				close();
			} else if (e.key === "Enter") {
				e.preventDefault();
				if (e.shiftKey) goPrev();
				else goNext();
			}
		},
		[close, goNext, goPrev],
	);

	if (!visible) return null;

	return (
		<div className="absolute right-4 top-2 z-40 flex items-center gap-1 border border-surface-border bg-surface-1 px-2 py-1 shadow-lg">
			<Search className="h-3 w-3 text-white/30" />
			<input
				ref={inputRef}
				value={query}
				onChange={(e) => setQuery(e.target.value)}
				onKeyDown={handleKeyDown}
				placeholder="Find in diff…"
				className="w-48 bg-transparent px-1 py-0.5 text-xs text-white/80 placeholder:text-white/25 outline-none"
			/>
			{query && (
				<span className="text-2xs text-white/35 tabular-nums">
					{matches.length > 0 ? `${currentMatch + 1}/${matches.length}` : "0/0"}
				</span>
			)}
			<button
				onClick={goPrev}
				disabled={matches.length === 0}
				className="p-0.5 text-white/40 transition hover:text-white/70 disabled:text-white/15"
			>
				<ArrowUp className="h-3 w-3" />
			</button>
			<button
				onClick={goNext}
				disabled={matches.length === 0}
				className="p-0.5 text-white/40 transition hover:text-white/70 disabled:text-white/15"
			>
				<ArrowDown className="h-3 w-3" />
			</button>
			<button
				onClick={close}
				className="p-0.5 text-white/40 transition hover:text-white/70"
			>
				<X className="h-3 w-3" />
			</button>
		</div>
	);
}

type DiffPaneProps = {
	session?: DiffPaneSession;
	inspector?: SessionInspectorView;
	defaultView: DiffViewMode;
	onCreateManualCheckpoint: () => Promise<void>;
	onRepairWorktree: () => Promise<void>;
};

function DiffPaneComponent(props: DiffPaneProps) {
	const revisions = useReviewStore((s) => s.revisions);
	const activeRevisionNumber = useReviewStore((s) => s.activeRevisionNumber);
	const selectedRevisionNumber = useReviewStore((s) => s.selectedRevisionNumber);
	const diffMode = useReviewStore((s) => s.diffMode);
	const currentDiff = useReviewStore((s) => s.currentDiff);
	const diffStale = useReviewStore((s) => s.diffStale);
	const setSelectedRevision = useReviewStore((s) => s.setSelectedRevision);
	const setDiffMode = useReviewStore((s) => s.setDiffMode);
	const createThread = useReviewStore((s) => s.createThread);
	const replyToThread = useReviewStore((s) => s.replyToThread);
	const resolveThread = useReviewStore((s) => s.resolveThread);
	const reopenThread = useReviewStore((s) => s.reopenThread);
	const publishComments = useReviewStore((s) => s.publishComments);
	const startNextRevision = useReviewStore((s) => s.startNextRevision);
	const approveRevision = useReviewStore((s) => s.approve);
	const applyRevision = useReviewStore((s) => s.applyRevision);
	const applyAndMerge = useReviewStore((s) => s.applyAndMerge);

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
	const [contentSearchOpen, setContentSearchOpen] = useState(false);
	const diffContentRef = useRef<HTMLDivElement>(null);
	const sectionRef = useRef<HTMLElement>(null);
	const deferredSearch = useDeferredValue(search);
	const diffKey = currentDiff?.cacheKey;
	const parsedDiffModel = useMemo(
		() => buildParsedDiffModel(currentDiff),
		[diffKey, currentDiff?.files, currentDiff?.patch],
	);
	const parsedFiles = parsedDiffModel.files;

	useEffect(() => {
		setCollapsedFiles(new Set());
	}, [diffKey]);

	const selectedRevision = useMemo(
		() => revisions.find((r) => r.revisionNumber === selectedRevisionNumber),
		[revisions, selectedRevisionNumber],
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

	const widgetCacheRef = useRef<Map<string, Record<string, React.ReactNode>>>(new Map());
	useEffect(() => {
		widgetCacheRef.current.clear();
	}, [diffKey]);

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
			file: FileData,
			path: string,
		) => {
			const cacheKey = `${diffKey ?? "no-diff"}\u0000${path}\u0000${visibleThreadKey}\u0000${draftKey}`;
			const cache = widgetCacheRef.current;
			const cached = cache.get(cacheKey);
			if (cached) return cached;
			const widgets = buildWidgetsForFile({
				diffId: currentDiff?.cacheKey,
				file,
				path,
				threadIndex,
				draftAnchor,
				draftBody,
				onReplyToThread: replyToThread,
				onResolveThread: resolveThread,
				onReopenThread: reopenThread,
				onCancelDraft: () => {
					setDraftAnchor(null);
					setDraftBody("");
				},
				onSubmitDraft: async () => {
					if (!draftAnchor || !draftBody.trim()) return;
					await createThread(draftAnchor, draftBody);
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
			diffKey,
			createThread,
			reopenThread,
			replyToThread,
			resolveThread,
			threadIndex,
			visibleThreadKey,
		],
	);

	const fileStatsByPath = useMemo(() => parsedDiffModel.fileStatsByPath, [parsedDiffModel]);
	const toggleCollapsedFile = useCallback((path: string) => {
		setCollapsedFiles((prev) => {
			const next = new Set(prev);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});
	}, []);

	const handleSelectChange = useCallback(
		(file: FileData, change: ChangeData) => {
			if (!currentDiff) return;
			const hunk = file.hunks.find((candidate) => candidate.changes.includes(change));
			if (!hunk) return;
			setDraftAnchor(
				createAnchorFromChange({
					file,
					hunk,
					change,
					diff: currentDiff,
				}),
			);
		},
		[currentDiff],
	);

	const renderItems = useMemo(() => {
		const items: DiffRenderItem[] = [];
		for (const file of filteredFiles) {
			const path = file.newPath || file.oldPath;
			const isCollapsed = collapsedFiles.has(path);
			items.push({
				kind: "header",
				path,
				file,
				isCollapsed,
			});
			if (isCollapsed) continue;
			const segments = parsedDiffModel.fileRenderSegmentsByPath.get(path) ?? [file.hunks];
			for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
				const hunks = segments[segmentIndex];
				let changeCount = 0;
				for (const hunk of hunks) {
					changeCount += hunk.changes.length;
				}
				items.push({
					kind: "body",
					path,
					file,
					hunks,
					segmentIndex,
					changeCount,
				});
			}
		}
		return items;
	}, [collapsedFiles, filteredFiles, parsedDiffModel.fileRenderSegmentsByPath]);

	const headerItemIndexByPath = useMemo(() => {
		const map = new Map<string, number>();
		renderItems.forEach((item, index) => {
			if (item.kind === "header") {
				map.set(item.path, index);
			}
		});
		return map;
	}, [renderItems]);

	const fileListParentRef = useRef<HTMLDivElement | null>(null);
	const rowVirtualizer = useVirtualizer({
		count: filteredFiles.length,
		getScrollElement: () => fileListParentRef.current,
		estimateSize: () => 44,
		gap: 1,
	});

	const shouldVirtualizeDiffContent = useMemo(
		() =>
			shouldVirtualizeDiff({
				fileCount: filteredFiles.length,
				renderItemCount: renderItems.length,
				totalChangeCount: parsedDiffModel.totalChangeCount,
				largestFileChangeCount: parsedDiffModel.largestFileChangeCount,
				patchBytes: currentDiff?.patch.length ?? 0,
			}),
		[
			filteredFiles.length,
			renderItems.length,
			parsedDiffModel.largestFileChangeCount,
			parsedDiffModel.totalChangeCount,
			currentDiff?.patch.length,
		],
	);

	const estimateDiffItemSize = useCallback((index: number) => {
		const item = renderItems[index];
		if (!item) return 120;
		if (item.kind === "header") return 42;
		const threadCount = item.segmentIndex === 0 ? (threadCountByFilePath.get(item.path) ?? 0) : 0;
		const lineHeight = viewType === "split" ? 19 : 17;
		return Math.max(84, 16 + item.changeCount * lineHeight + threadCount * 120);
	}, [renderItems, threadCountByFilePath, viewType]);

	const diffVirtualizer = useVirtualizer({
		count: renderItems.length,
		getScrollElement: () => diffContentRef.current,
		estimateSize: estimateDiffItemSize,
		overscan: 2,
		gap: 16,
	});

	useEffect(() => {
		recordDiffPerf({
			kind: "diff_render_mode",
			diffId: currentDiff?.cacheKey,
			durationMs: 0,
			timestamp: Date.now(),
			metadata: {
				virtualized: shouldVirtualizeDiffContent,
				fileCount: filteredFiles.length,
				renderItemCount: renderItems.length,
				chunkedFiles: Array.from(parsedDiffModel.fileRenderSegmentsByPath.values()).filter(
					(segments) => segments.length > 1,
				).length,
			},
		});
	}, [
		filteredFiles.length,
		parsedDiffModel.fileRenderSegmentsByPath,
		currentDiff?.cacheKey,
		renderItems.length,
		shouldVirtualizeDiffContent,
	]);

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

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "f") {
				const section = sectionRef.current;
				if (!section) return;
				if (!section.contains(document.activeElement) && document.activeElement !== section) return;
				e.preventDefault();
				e.stopPropagation();
				setContentSearchOpen(true);
			}
		};
		document.addEventListener("keydown", handleKeyDown, true);
		return () => document.removeEventListener("keydown", handleKeyDown, true);
	}, []);

	const scrollToFile = useCallback((filePath: string) => {
		const index = headerItemIndexByPath.get(filePath);
		if (index === undefined) return;
		if (shouldVirtualizeDiffContent) {
			diffVirtualizer.scrollToIndex(index, { align: "start" });
			return;
		}
		const target = diffContentRef.current?.querySelector<HTMLElement>(
			`[data-file-path="${CSS.escape(filePath)}"]`,
		);
		target?.scrollIntoView({ block: "start" });
	}, [diffVirtualizer, headerItemIndexByPath, shouldVirtualizeDiffContent]);

	const handleDiffMouseUp = useCallback(
		(_e: React.MouseEvent) => {
			const sel = window.getSelection();
			if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
			if (!diffContentRef.current || !currentDiff) return;

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
		[currentDiff],
	);

	const handleCommentFromSelection = useCallback(() => {
		if (!selectionPopup || !currentDiff) return;

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
							diff: currentDiff!,
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
	}, [selectionPopup, filteredFiles, currentDiff]);

	const renderDiffItem = useCallback(
		(
			item: DiffRenderItem,
			key: React.Key,
			options?: {
				style?: React.CSSProperties;
				index?: number;
				measure?: boolean;
			},
		) => {
			const stats = fileStatsByPath.get(item.path) ?? {
				additions: 0,
				deletions: 0,
				type: item.file.type,
				path: item.path,
			};
			if (item.kind === "header") {
				return (
					<div
						key={key}
						ref={options?.measure ? diffVirtualizer.measureElement : undefined}
						data-index={options?.index}
						className={options?.style ? "absolute left-0 right-0" : undefined}
						style={options?.style}
					>
						<MemoizedDiffFileHeader
							path={item.path}
							stats={{
								additions: stats.additions,
								deletions: stats.deletions,
								type: stats.type,
							}}
							isCollapsed={item.isCollapsed}
							onToggle={() => toggleCollapsedFile(item.path)}
						/>
					</div>
				);
			}
			const widgets = getWidgetsForFile(item.file, item.path);
			return (
				<div
					key={key}
					ref={options?.measure ? diffVirtualizer.measureElement : undefined}
					data-index={options?.index}
					className={`${options?.style ? "absolute left-0 right-0" : ""} pb-3`.trim()}
					style={options?.style}
				>
					<MemoizedDiffBodySection
						diff={currentDiff}
						file={item.file}
						path={item.path}
						hunks={item.hunks}
						viewType={viewType}
						widgets={widgets}
						onSelectChange={handleSelectChange}
					/>
				</div>
			);
		},
		[
			diffVirtualizer.measureElement,
			fileStatsByPath,
			getWidgetsForFile,
			handleSelectChange,
			currentDiff,
			toggleCollapsedFile,
			viewType,
		],
	);

	useEffect(() => {
		const diffId = currentDiff?.cacheKey;
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
					renderItemCount: renderItems.length,
					virtualized: shouldVirtualizeDiffContent,
					viewType,
				},
			});
		});
		return () => window.cancelAnimationFrame(raf);
	}, [filteredFiles.length, currentDiff?.cacheKey, renderItems.length, shouldVirtualizeDiffContent, viewType]);

	if (!currentDiff) {
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
		<section ref={sectionRef} tabIndex={-1} className="flex h-full flex-col border-l border-surface-border bg-surface-0 outline-none">
			{/* Toolbar */}
			<div className="border-b border-surface-border px-3 py-2">
				<div className="flex flex-wrap items-center gap-1.5">
					{/* Revision tabs */}
					{revisions.length > 0 && (
						<div className="flex items-center">
							{revisions.map((rev) => (
								<button
									key={rev.id}
									onClick={() => setSelectedRevision(rev.revisionNumber)}
									className={`relative px-2 py-1 text-xs transition ${
										rev.revisionNumber === selectedRevisionNumber
											? "bg-accent/15 text-accent font-medium"
											: "text-white/40 hover:text-white/60 hover:bg-white/5"
									}`}
								>
									Rev {rev.revisionNumber}
									{rev.revisionNumber === activeRevisionNumber && (
										<span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-accent" />
									)}
								</button>
							))}
						</div>
					)}
					{/* Diff mode toggle */}
					<div className="flex border border-surface-border">
						<button
							onClick={() => setDiffMode("incremental")}
							className={`px-2 py-1 text-xs transition ${
								diffMode === "incremental"
									? "bg-accent/15 text-accent"
									: "bg-surface-2 text-white/40 hover:text-white/60"
							}`}
						>
							Incremental
						</button>
						<button
							onClick={() => setDiffMode("cumulative")}
							className={`px-2 py-1 text-xs transition ${
								diffMode === "cumulative"
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
					{diffStale ? (
						<div className="flex items-center gap-1 text-xs text-state-review">
							<AlertTriangle className="h-3 w-3" />
							Stale
						</div>
					) : null}
				</div>
				<div className="mt-1.5 flex flex-wrap items-center gap-3 text-2xs text-white/35">
					<span className="font-medium text-white/60">{currentDiff.title}</span>
					<span>{currentDiff.fromLabel} → {currentDiff.toLabel}</span>
					<span>{currentDiff.stats.filesChanged} files</span>
					<span className="text-state-applied">+{currentDiff.stats.additions}</span>
					<span className="text-state-error">-{currentDiff.stats.deletions}</span>
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
												onClick={applyRevision}
												disabled={done}
												className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium ${done ? "bg-state-applied/40 text-black/40 cursor-not-allowed" : "bg-state-applied text-black"}`}
											>
												<Play className="h-3 w-3" />
												{props.session?.status === "completed" ? "Applied" : "Apply"}
											</button>
											{props.session?.mode === "worktree" && (
												<button
													onClick={() => applyAndMerge(commitMessage || undefined)}
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
									onClick={publishComments}
									className="flex items-center gap-1 bg-accent px-2.5 py-1 text-xs font-medium text-black"
								>
									<Send className="h-3 w-3" />
									Publish Comments
								</button>
							)}
							{revisionState === "resolved" && hasAddressThis && (
								<button
									onClick={startNextRevision}
									className="flex items-center gap-1 bg-accent px-2.5 py-1 text-xs font-medium text-black"
								>
									<Play className="h-3 w-3" />
									Start Next Revision
								</button>
							)}
							{/* Approve is always available (except when already approved) */}
							<button
								onClick={approveRevision}
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
				<div className="relative flex-1 min-h-0">
				<DiffContentSearch
					visible={contentSearchOpen}
					onClose={() => setContentSearchOpen(false)}
					containerRef={diffContentRef}
				/>
				<div ref={diffContentRef} className="diff-shell h-full overflow-auto px-3 py-3" onMouseUp={handleDiffMouseUp}>
					{shouldVirtualizeDiffContent ? (
						<div style={{ height: `${diffVirtualizer.getTotalSize()}px`, position: "relative" }}>
							{diffVirtualizer.getVirtualItems().map((item) =>
								renderDiffItem(renderItems[item.index], item.key, {
									index: item.index,
									measure: true,
									style: { transform: `translateY(${item.start}px)` },
								}),
							)}
						</div>
					) : (
						<div>
							{renderItems.map((item, index) =>
								renderDiffItem(
									item,
									`${item.path}:${item.kind === "body" ? item.segmentIndex : "header"}:${index}`,
								),
							)}
						</div>
					)}
				</div>
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

export const DiffPane = memo(DiffPaneComponent);
