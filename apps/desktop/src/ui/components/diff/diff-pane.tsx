import { useMemo, useRef, useState } from "react";
import { getChangeKey, Diff, Hunk, parseDiff } from "react-diff-view";
import { useVirtualizer } from "@tanstack/react-virtual";
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
		<div className="space-y-3 rounded-2xl border border-black/10 bg-white/90 p-3 shadow-panel">
			{props.threads.map((thread) => (
				<div key={thread.id} className="rounded-xl border border-black/5 bg-black/[0.02] p-3">
					<div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-[0.14em] text-black/45">
						<span>{thread.status.replace(/_/g, " ")}</span>
						<span>{thread.filePath}</span>
					</div>
					<div className="space-y-2">
						{thread.messages.map((message) => (
							<div key={message.id} className="rounded-xl bg-white px-3 py-2">
								<div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-black/40">
									{message.authorType}
								</div>
								<MarkdownRenderer markdown={message.bodyMarkdown} />
							</div>
						))}
					</div>
					<div className="mt-3 flex flex-wrap gap-2">
						{thread.status !== "resolved" ? (
							<button
								onClick={() => props.onResolve(thread.id)}
								className="rounded-full border border-black/10 px-2.5 py-1 text-[11px] text-black/60"
							>
								Resolve
							</button>
						) : (
							<button
								onClick={() => props.onReopen(thread.id)}
								className="rounded-full border border-black/10 px-2.5 py-1 text-[11px] text-black/60"
							>
								Reopen
							</button>
						)}
					</div>
				</div>
			))}

			<div className="rounded-xl border border-black/5 bg-white p-3">
				<textarea
					value={replyBody}
					onChange={(event) => setReplyBody(event.target.value)}
					rows={2}
					placeholder="Reply inline..."
					className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm outline-none"
				/>
				<div className="mt-2 flex justify-end">
					<button
						onClick={async () => {
							if (!replyBody.trim() || props.threads.length === 0) return;
							await props.onReply(props.threads[0].id, replyBody);
							setReplyBody("");
						}}
						className="rounded-full bg-[color:var(--accent)] px-3 py-1.5 text-sm text-white"
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
		estimateSize: () => 42,
	});

	const currentRoundState = props.activeReviewRound?.state;

	if (!props.diff) {
		return (
			<section className="grid h-full grid-cols-[280px_minmax(0,1fr)] border-l border-black/10 bg-[#fbf8f2]">
				<div className="overflow-auto border-r border-black/10 px-3 py-3">
					<SessionInspector
						session={props.session}
						inspector={props.inspector}
						onCreateManualCheckpoint={props.onCreateManualCheckpoint}
						onRepairWorktree={props.onRepairWorktree}
					/>
				</div>
				<div className="flex items-center justify-center">
					<div className="max-w-md text-center text-black/55">
						<div className="text-xs uppercase tracking-[0.18em]">Diff</div>
						<p className="mt-3 text-sm">
							Create or open a session with Git changes to review turn-scoped and
							session-scoped diffs.
						</p>
					</div>
				</div>
			</section>
		);
	}

	return (
		<section className="flex h-full flex-col border-l border-black/10 bg-[#fbf8f2]">
			<div className="border-b border-black/10 px-4 py-4">
				<div className="flex flex-wrap items-center gap-2">
					<select
						value={props.diff.scope}
						onChange={(event) =>
							void props.onSelectScope(event.target.value as DiffScope)
						}
						className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-sm"
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
						className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-sm"
					>
						{viewType === "split" ? "Unified" : "Split"}
					</button>
					<input
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder="Filter files"
						className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-sm"
					/>
					<label className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-1.5 text-sm">
						<input
							type="checkbox"
							checked={unresolvedOnly}
							onChange={(event) => setUnresolvedOnly(event.target.checked)}
						/>
						Unresolved only
					</label>
					{props.diffStale ? (
						<div className="rounded-full bg-[color:var(--state-review)]/15 px-3 py-1.5 text-sm text-[color:var(--state-review)]">
							Diff is stale
						</div>
					) : null}
				</div>
				<div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-black/55">
					<span className="font-medium text-black">{props.diff.title}</span>
					<span>{props.diff.fromLabel}</span>
					<span>→</span>
					<span>{props.diff.toLabel}</span>
					<span>{props.diff.stats.filesChanged} files</span>
					<span>+{props.diff.stats.additions}</span>
					<span>-{props.diff.stats.deletions}</span>
				</div>
				<div className="mt-4 flex flex-wrap gap-2">
					{currentRoundState === "aligned" ? (
						<button
							onClick={props.onApplyAlignedChanges}
							className="rounded-full bg-[color:var(--state-applied)] px-4 py-1.5 text-sm text-white"
						>
							Apply agreed changes
						</button>
					) : currentRoundState === "awaiting_user" ? (
						<button
							onClick={props.onMarkAligned}
							className="rounded-full bg-[color:var(--state-review)] px-4 py-1.5 text-sm text-white"
						>
							Mark aligned
						</button>
					) : (
						<button
							onClick={props.onSubmitReview}
							className="rounded-full bg-[color:var(--accent)] px-4 py-1.5 text-sm text-white"
						>
							Send review
						</button>
					)}
				</div>
			</div>

			<div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)]">
				<div
					ref={fileListParentRef}
					className="border-r border-black/10 overflow-auto px-3 py-3"
				>
					<SessionInspector
						session={props.session}
						inspector={props.inspector}
						onCreateManualCheckpoint={props.onCreateManualCheckpoint}
						onRepairWorktree={props.onRepairWorktree}
					/>
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
									className="absolute left-0 right-0 rounded-xl border border-black/5 bg-white/70 px-3 py-2 text-sm"
									style={{ transform: `translateY(${item.start}px)` }}
								>
									<div className="font-medium">{path}</div>
									<div className="mt-1 text-[11px] text-black/45">
										{stats.additions} additions • {stats.deletions} deletions
									</div>
								</div>
							);
						})}
					</div>
				</div>

				<div className="diff-shell overflow-auto px-4 py-4">
					<div className="space-y-6">
						{filteredFiles.map((file) => {
							const path = file.newPath || file.oldPath;
							return (
								<div key={`${file.oldRevision}-${file.newRevision}`} className="rounded-3xl border border-black/10 bg-white/75 p-3">
									<div className="mb-3 flex items-center justify-between rounded-2xl bg-black/[0.03] px-3 py-2">
										<div className="mono text-sm">{path}</div>
										<div className="text-[11px] uppercase tracking-[0.14em] text-black/45">
											{file.type}
										</div>
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
														<div className="py-2">
															{threads.length > 0 ? (
																<InlineThread
																	threads={threads}
																	onReply={props.onReplyToThread}
																	onResolve={props.onResolveThread}
																	onReopen={props.onReopenThread}
																/>
															) : null}
															{isDraft ? (
																<div className="mt-3 rounded-2xl border border-black/10 bg-white p-3 shadow-panel">
																	<textarea
																		value={draftBody}
																		onChange={(event) =>
																			setDraftBody(event.target.value)
																		}
																		rows={3}
																		placeholder="Leave an inline review comment..."
																		className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm outline-none"
																	/>
																	<div className="mt-2 flex justify-end gap-2">
																		<button
																			onClick={() => {
																				setDraftAnchor(null);
																				setDraftBody("");
																			}}
																			className="rounded-full border border-black/10 px-3 py-1.5 text-sm text-black/60"
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
																			className="rounded-full bg-[color:var(--accent)] px-3 py-1.5 text-sm text-white"
																		>
																			Add comment
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
