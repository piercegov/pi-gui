import { useMemo, useRef, useState } from "react";
import { getChangeKey, Diff, Hunk, parseDiff } from "react-diff-view";
import { useVirtualizer } from "@tanstack/react-virtual";
import { SplitSquareHorizontal, Rows3, Search, CheckCircle2, Send, GitCompare, AlertTriangle, Info } from "lucide-react";
import type {
	CommentAnchor,
	CommentThreadView,
	DiffScope,
	DiffSnapshotView,
	DiffViewMode,
	ReviewRoundView,
	SessionInspectorView,
	SessionSummary,
} from "@shared/models";
import {
	createAnchorFromChange,
	threadMatchesChange,
} from "@ui/lib/diff-utils";
import { MarkdownRenderer } from "@ui/lib/markdown";
import { SessionInspector } from "./session-inspector";

function InlineThread(props: {
	threads: CommentThreadView[];
	onReply: (threadId: string, body: string) => Promise<void>;
	onResolve: (threadId: string) => Promise<void>;
	onReopen: (threadId: string) => Promise<void>;
}) {
	const [replyBody, setReplyBody] = useState("");
	return (
		<div className="space-y-2 border-l-2 border-accent/30 bg-surface-2 p-3">
			{props.threads.map((thread) => (
				<div key={thread.id} className="border-b border-surface-border pb-2 last:border-b-0">
					<div className="mb-1.5 flex items-center justify-between text-2xs text-white/30">
						<span className="uppercase tracking-wider">{thread.status.replace(/_/g, " ")}</span>
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
							<button
								onClick={() => props.onResolve(thread.id)}
								className="px-2 py-0.5 text-2xs text-white/40 transition hover:bg-white/5 hover:text-white/60"
							>
								Resolve
							</button>
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
					className="w-full resize-none border border-surface-border bg-surface-1 px-3 py-1.5 text-sm text-white/80 placeholder:text-white/20 outline-none focus:border-accent/30"
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

export function DiffPane(props: {
	session?: SessionSummary;
	inspector?: SessionInspectorView;
	diff?: DiffSnapshotView;
	diffScopes: Array<{ scope: DiffScope; label: string; available: boolean }>;
	activeReviewRound?: ReviewRoundView;
	defaultView: DiffViewMode;
	diffStale: boolean;
	onSelectScope: (scope: DiffScope) => Promise<void>;
	onCreateThread: (anchor: CommentAnchor, body: string) => Promise<void>;
	onReplyToThread: (threadId: string, body: string) => Promise<void>;
	onResolveThread: (threadId: string) => Promise<void>;
	onReopenThread: (threadId: string) => Promise<void>;
	onSubmitReview: () => Promise<void>;
	onMarkAligned: () => Promise<void>;
	onApplyAlignedChanges: () => Promise<void>;
	onCreateManualCheckpoint: () => Promise<void>;
	onRepairWorktree: () => Promise<void>;
}) {
	const [viewType, setViewType] = useState<DiffViewMode>(props.defaultView);
	const [search, setSearch] = useState("");
	const [draftAnchor, setDraftAnchor] = useState<CommentAnchor | null>(null);
	const [draftBody, setDraftBody] = useState("");
	const [unresolvedOnly, setUnresolvedOnly] = useState(false);
	const [inspectorOpen, setInspectorOpen] = useState(false);

	const parsedFiles = useMemo(
		() => (props.diff ? parseDiff(props.diff.patch, { nearbySequences: "zip" }) : []),
		[props.diff],
	);

	const visibleThreads = useMemo(() => {
		const threads = props.activeReviewRound?.threads ?? [];
		return unresolvedOnly
			? threads.filter((thread) => thread.status !== "resolved")
			: threads;
	}, [props.activeReviewRound?.threads, unresolvedOnly]);

	const filteredFiles = useMemo(() => {
		return parsedFiles.filter((file) =>
			(file.newPath || file.oldPath).toLowerCase().includes(search.toLowerCase()),
		);
	}, [parsedFiles, search]);

	const fileListParentRef = useRef<HTMLDivElement | null>(null);
	const rowVirtualizer = useVirtualizer({
		count: filteredFiles.length,
		getScrollElement: () => fileListParentRef.current,
		estimateSize: () => 36,
	});

	const currentRoundState = props.activeReviewRound?.state;

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
						<SessionInspector
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
						<p className="text-sm">
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
					<select
						value={props.diff.scope}
						onChange={(event) =>
							void props.onSelectScope(event.target.value as DiffScope)
						}
						className="border border-surface-border bg-surface-2 px-2 py-1 text-xs text-white/70 outline-none"
					>
						{props.diffScopes
							.filter((scope) => scope.available)
							.map((scope) => (
								<option key={scope.scope} value={scope.scope}>
									{scope.label}
								</option>
							))}
					</select>
					<button
						onClick={() =>
							setViewType((current) => (current === "split" ? "unified" : "split"))
						}
						className="flex items-center gap-1 border border-surface-border bg-surface-2 px-2 py-1 text-xs text-white/50 transition hover:text-white/70"
					>
						{viewType === "split" ? (
							<><Rows3 className="h-3 w-3" /> Unified</>
						) : (
							<><SplitSquareHorizontal className="h-3 w-3" /> Split</>
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
				<div className="mt-2 flex gap-1.5">
					{currentRoundState === "aligned" ? (
						<button
							onClick={props.onApplyAlignedChanges}
							className="flex items-center gap-1 bg-state-applied px-2.5 py-1 text-xs font-medium text-black"
						>
							<CheckCircle2 className="h-3 w-3" />
							Apply agreed changes
						</button>
					) : currentRoundState === "awaiting_user" ? (
						<button
							onClick={props.onMarkAligned}
							className="flex items-center gap-1 bg-state-review px-2.5 py-1 text-xs font-medium text-black"
						>
							<CheckCircle2 className="h-3 w-3" />
							Mark aligned
						</button>
					) : (
						<button
							onClick={props.onSubmitReview}
							className="flex items-center gap-1 bg-accent px-2.5 py-1 text-xs font-medium text-black"
						>
							<Send className="h-3 w-3" />
							Send review
						</button>
					)}
				</div>
			</div>

			<div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)]">
				{/* File list + optional Inspector sidebar */}
				<div
					ref={fileListParentRef}
					className="overflow-auto border-r border-surface-border px-2 py-2"
				>
					{inspectorOpen ? (
						<div className="mb-2 border-b border-surface-border pb-2">
							<SessionInspector
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
							const stats = fileStats(file);
							return (
								<div
									key={item.key}
									className="absolute left-0 right-0 border-b border-surface-border px-2.5 py-1.5 text-xs hover:bg-white/3"
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
								</div>
							);
						})}
					</div>
				</div>

				{/* Diff content */}
				<div className="diff-shell overflow-auto px-3 py-3">
					<div className="space-y-4">
						{filteredFiles.map((file) => {
							const path = file.newPath || file.oldPath;
							return (
								<div key={`${file.oldRevision}-${file.newRevision}`}>
									<div className="mb-1.5 flex items-center justify-between border-b border-surface-border pb-1.5">
										<span className="mono text-xs text-white/60">{path}</span>
										<span className="text-2xs uppercase tracking-wider text-white/25">
											{file.type}
										</span>
									</div>
									<Diff
										viewType={viewType}
										diffType={file.type}
										hunks={file.hunks}
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
										widgets={Object.fromEntries(
											file.hunks
												.flatMap((hunk) =>
												hunk.changes.map((change) => {
													const threads = visibleThreads.filter(
														(thread) =>
															thread.filePath === path &&
															threadMatchesChange(thread, change),
													);
													const key = getChangeKey(change);
														const isDraft =
															draftAnchor &&
															draftAnchor.filePath === path &&
															((draftAnchor.side === "old" &&
																draftAnchor.line === lineValue(change as never, "old")) ||
																(draftAnchor.side === "new" &&
																	draftAnchor.line === lineValue(change as never, "new")));
													if (threads.length === 0 && !isDraft) return [key, null];
													return [
														key,
														<div className="py-1.5">
															{threads.length > 0 ? (
																<InlineThread
																	threads={threads}
																	onReply={props.onReplyToThread}
																	onResolve={props.onResolveThread}
																	onReopen={props.onReopenThread}
																/>
															) : null}
															{isDraft ? (
																<div className="border-l-2 border-accent/30 bg-surface-2 p-3">
																	<textarea
																		value={draftBody}
																		onChange={(event) =>
																			setDraftBody(event.target.value)
																		}
																		rows={3}
																		placeholder="Leave a review comment..."
																		className="w-full resize-none border border-surface-border bg-surface-1 px-3 py-1.5 text-sm text-white/80 placeholder:text-white/20 outline-none focus:border-accent/30"
																	/>
																	<div className="mt-2 flex justify-end gap-1.5">
																		<button
																			onClick={() => {
																				setDraftAnchor(null);
																				setDraftBody("");
																			}}
																			className="px-2.5 py-1 text-xs text-white/40 hover:bg-white/5 hover:text-white/60"
																		>
																			Cancel
																		</button>
																		<button
																			onClick={async () => {
																				if (!draftAnchor || !draftBody.trim()) return;
																				await props.onCreateThread(
																					draftAnchor,
																					draftBody,
																				);
																				setDraftBody("");
																				setDraftAnchor(null);
																			}}
																			className="bg-accent px-2.5 py-1 text-xs font-medium text-black"
																		>
																			Comment
																		</button>
																	</div>
																</div>
															) : null}
														</div>,
													];
													}),
												)
												.filter((entry) => entry[1] !== null),
										)}
									>
										{(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
									</Diff>
								</div>
							);
						})}
					</div>
				</div>
			</div>
		</section>
	);
}
