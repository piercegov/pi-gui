import { useState } from "react";
import { Send, Square, CornerDownRight, Zap, ChevronRight, Wrench, CheckCircle2, AlertCircle, Loader2, Flag, RotateCcw } from "lucide-react";
import type { CheckpointSummaryView, ConversationEntryView, SessionSummary, ToolActivityView } from "@shared/models";
import { MarkdownRenderer } from "@ui/lib/markdown";

/** Returns true if an assistant entry contains only tool-call references (no real text). */
function isToolCallOnly(entry: ConversationEntryView): boolean {
	if (entry.kind !== "assistant") return false;
	const trimmed = entry.markdown.trim();
	if (!trimmed) return true;
	return trimmed.split("\n").every((line) => /^-\s*`[^`]+`\s*$/.test(line.trim()));
}

/** Strip tool-call list lines from assistant markdown, returning only real text. */
function stripToolCallLines(markdown: string): string {
	return markdown
		.split("\n")
		.filter((line) => !/^-\s*`[^`]+`\s*$/.test(line.trim()))
		.join("\n")
		.trim();
}

type AssistantTurn = {
	type: "assistant_turn";
	/** First assistant entry in the group (used for id/timestamp). */
	lead: ConversationEntryView;
	/** Real text from all assistant entries in this turn. */
	textMarkdown: string;
	/** Tool result entries in this turn. */
	tools: ConversationEntryView[];
};

type CheckpointBlock = {
	type: "checkpoint";
	checkpoint: CheckpointSummaryView;
};

type RenderBlock =
	| { type: "entry"; entry: ConversationEntryView }
	| AssistantTurn
	| CheckpointBlock;

/**
 * Groups consecutive assistant + tool entries into unified assistant turns,
 * then interleaves checkpoint markers by timestamp.
 */
function groupEntries(
	entries: ConversationEntryView[],
	checkpoints: CheckpointSummaryView[],
): RenderBlock[] {
	const blocks: RenderBlock[] = [];
	let i = 0;
	while (i < entries.length) {
		const entry = entries[i];
		if (entry.kind === "assistant") {
			const lead = entry;
			const textParts: string[] = [];
			const realText = stripToolCallLines(entry.markdown);
			if (realText) textParts.push(realText);
			const tools: ConversationEntryView[] = [];
			i++;
			// Absorb following tool results and tool-call-only assistant entries
			while (i < entries.length) {
				const next = entries[i];
				if (next.kind === "tool") {
					tools.push(next);
					i++;
				} else if (isToolCallOnly(next)) {
					// Skip tool-call-only assistant entries (tool names already shown on cards)
					i++;
				} else if (next.kind === "assistant") {
					// Another assistant entry with real text — include text and continue absorbing
					const text = stripToolCallLines(next.markdown);
					if (text) textParts.push(text);
					i++;
				} else {
					break;
				}
			}
			blocks.push({
				type: "assistant_turn",
				lead,
				textMarkdown: textParts.join("\n\n"),
				tools,
			});
		} else {
			blocks.push({ type: "entry", entry });
			i++;
		}
	}

	// Only show post_turn, manual, and alignment checkpoints, sorted ascending by time
	const visibleCheckpoints = checkpoints
		.filter((cp) => cp.kind === "post_turn" || cp.kind === "manual" || cp.kind === "alignment")
		.sort((a, b) => a.createdAt - b.createdAt);

	if (visibleCheckpoints.length === 0) return blocks;

	// Interleave checkpoints by timestamp, but collapse consecutive
	// checkpoints (with no conversation block between them) into one,
	// keeping only the latest in each run.
	const merged: RenderBlock[] = [];
	let cpIdx = 0;

	for (const block of blocks) {
		const blockTimestamp =
			block.type === "assistant_turn"
				? block.lead.timestamp
				: block.type === "entry"
					? block.entry.timestamp
					: 0;

		// Collect all checkpoints that occurred before this block
		let lastCpBeforeBlock: CheckpointSummaryView | null = null;
		while (cpIdx < visibleCheckpoints.length && visibleCheckpoints[cpIdx].createdAt <= blockTimestamp) {
			lastCpBeforeBlock = visibleCheckpoints[cpIdx];
			cpIdx++;
		}
		// Only emit the last checkpoint in a consecutive run
		if (lastCpBeforeBlock) {
			merged.push({ type: "checkpoint", checkpoint: lastCpBeforeBlock });
		}
		merged.push(block);
	}

	// Collapse any remaining checkpoints after all blocks into one
	if (cpIdx < visibleCheckpoints.length) {
		merged.push({ type: "checkpoint", checkpoint: visibleCheckpoints[visibleCheckpoints.length - 1] });
	}

	return merged;
}

function CheckpointBar(props: {
	checkpoint: CheckpointSummaryView;
	onRestore: (checkpointId: string) => void;
}) {
	const [hovered, setHovered] = useState(false);
	const { checkpoint } = props;

	const label =
		checkpoint.kind === "alignment"
			? "Alignment"
			: checkpoint.kind === "manual"
				? "Manual checkpoint"
				: "Checkpoint";

	return (
		<div
			className="group relative flex items-center gap-2 py-1.5"
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
		>
			<div className="flex items-center gap-1.5 text-white/20">
				<Flag className="h-3 w-3" />
				<span className="text-2xs">{label}</span>
			</div>
			<div className="flex-1 border-t border-dashed border-white/10" />
			<div
				className={`flex items-center gap-1 transition-opacity ${
					hovered ? "opacity-100" : "opacity-0"
				}`}
			>
				<button
					type="button"
					onClick={() => props.onRestore(checkpoint.id)}
					className="flex items-center gap-1 border border-dashed border-white/15 px-2 py-0.5 text-2xs text-white/40 transition hover:border-white/30 hover:text-white/60"
				>
					<RotateCcw className="h-2.5 w-2.5" />
					Restore
				</button>
			</div>
		</div>
	);
}

function ToolInvocationCard(props: { entry: ConversationEntryView }) {
	const [open, setOpen] = useState(false);
	const { entry } = props;
	const isError = entry.status === "error";
	const isStreaming = entry.status === "streaming";
	const isDone = entry.status === "done" && !isError;

	return (
		<div className="border border-surface-border bg-surface-0 overflow-hidden">
			<button
				type="button"
				onClick={() => setOpen((prev) => !prev)}
				className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-white/[0.03]"
			>
				<Wrench className="h-3.5 w-3.5 shrink-0 text-white/30" />
				<span className="mono text-xs font-medium text-white/70">
					{entry.toolName ?? "tool"}
				</span>
				{isStreaming && (
					<span className="flex items-center gap-1 rounded-full bg-state-running/15 px-2 py-0.5 text-2xs text-state-running">
						<Loader2 className="h-3 w-3 animate-spin" />
						Running
					</span>
				)}
				{isDone && (
					<span className="flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-2xs text-green-400/80">
						<CheckCircle2 className="h-3 w-3" />
						Done
					</span>
				)}
				{isError && (
					<span className="flex items-center gap-1 rounded-full bg-state-error/10 px-2 py-0.5 text-2xs text-state-error">
						<AlertCircle className="h-3 w-3" />
						Error
					</span>
				)}
				<ChevronRight
					className={`ml-auto h-3.5 w-3.5 shrink-0 text-white/20 transition-transform ${open ? "rotate-90" : ""}`}
				/>
			</button>
			{open && (
				<div className="border-t border-surface-border bg-surface-1 px-4 py-3 space-y-3">
					{entry.toolInput && Object.keys(entry.toolInput).length > 0 && (
						<div>
							<div className="mb-1 text-2xs font-medium uppercase tracking-wider text-white/25">Input</div>
							<pre className="overflow-x-auto border border-surface-border bg-black/20 px-3 py-2 text-xs leading-relaxed text-white/50 mono">
								{JSON.stringify(entry.toolInput, null, 2)}
							</pre>
						</div>
					)}
					{entry.markdown.trim() && (
						<div>
							<div className="mb-1 text-2xs font-medium uppercase tracking-wider text-white/25">Output</div>
							<div className="text-xs leading-relaxed text-white/60">
								<MarkdownRenderer markdown={entry.markdown} />
							</div>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function badge(session?: SessionSummary) {
	if (!session) return [];
	return [
		session.modelLabel ?? "Model unavailable",
		session.mode,
		session.reviewState,
		session.baseRef ?? "HEAD",
	];
}

export function ConversationPane(props: {
	session?: SessionSummary;
	entries: ConversationEntryView[];
	toolActivity: ToolActivityView[];
	checkpoints: CheckpointSummaryView[];
	onSendPrompt: (text: string) => Promise<void>;
	onSteer: (text: string) => Promise<void>;
	onFollowUp: (text: string) => Promise<void>;
	onAbort: () => Promise<void>;
	onRestoreCheckpoint: (checkpointId: string) => Promise<void>;
}) {
	const [value, setValue] = useState("");
	const busy = props.session?.status === "running";

	const submit = async (mode: "send" | "steer" | "followup") => {
		if (!value.trim()) return;
		const text = value;
		setValue("");
		if (mode === "send") await props.onSendPrompt(text);
		if (mode === "steer") await props.onSteer(text);
		if (mode === "followup") await props.onFollowUp(text);
	};

	const handleRestore = (checkpointId: string) => {
		if (!window.confirm("Restore working directory to this checkpoint? Current changes will be overwritten.")) {
			return;
		}
		void props.onRestoreCheckpoint(checkpointId);
	};

	if (!props.session) {
		return (
			<section className="flex h-full items-center justify-center bg-surface-1">
				<div className="text-center">
					<div className="text-sm text-white/25">No session open</div>
					<p className="mt-2 text-sm text-white/40">
						Select a thread or create a new one to start.
					</p>
				</div>
			</section>
		);
	}

	return (
		<section className="flex h-full flex-col bg-surface-1">
			{/* Tool activity bar */}
			{props.toolActivity.length > 0 ? (
				<div className="flex gap-px border-b border-surface-border bg-surface-0">
					{props.toolActivity.slice(0, 4).map((activity) => (
						<div
							key={activity.id}
							className="flex-1 border-r border-surface-border px-3 py-2 last:border-r-0"
						>
							<div className="flex items-center gap-1.5">
								<span className={`inline-block h-1 w-1 rounded-full ${
									activity.status === "started" || activity.status === "streaming" ? "bg-state-running animate-pulse" : "bg-white/20"
								}`} />
								<span className="mono text-2xs text-white/50">{activity.toolName}</span>
							</div>
							<div className="mt-0.5 truncate text-2xs text-white/30">
								{activity.outputSnippet || activity.argsSummary}
							</div>
						</div>
					))}
				</div>
			) : null}

			{/* Conversation entries */}
			<div className="flex-1 overflow-auto">
				<div className="mx-auto max-w-4xl px-6 py-4">
					{/* Session badges */}
					<div className="mb-4 flex flex-wrap items-center gap-1.5">
						{badge(props.session).map((item) => (
							<span
								key={item}
								className="border border-surface-border bg-surface-2 px-2 py-0.5 text-2xs text-white/40"
							>
								{item}
							</span>
						))}
					</div>

					<div className="space-y-1">
						{groupEntries(props.entries, props.checkpoints).map((block) => {
							if (block.type === "checkpoint") {
								return (
									<CheckpointBar
										key={`cp-${block.checkpoint.id}`}
										checkpoint={block.checkpoint}
										onRestore={handleRestore}
									/>
								);
							}

							if (block.type === "assistant_turn") {
								return (
									<article
										key={block.lead.id}
										className="border-l-2 border-transparent px-4 py-3"
									>
										<div className="mb-1.5 flex items-center justify-between text-2xs text-white/30">
											<span className="font-medium uppercase tracking-wider">
												assistant
											</span>
											<span>
												{new Date(block.lead.timestamp).toLocaleTimeString([], {
													hour: "numeric",
													minute: "2-digit",
												})}
											</span>
										</div>
										{block.tools.length > 0 && (
											<div className="mb-3 flex flex-col gap-1.5">
												{block.tools.map((tool) => (
													<ToolInvocationCard key={tool.id} entry={tool} />
												))}
											</div>
										)}
										{block.textMarkdown && (
											<div className="text-sm leading-relaxed">
												<MarkdownRenderer markdown={block.textMarkdown} />
											</div>
										)}
									</article>
								);
							}

							const { entry } = block;
							return (
								<article
									key={entry.id}
									className={`border-l-2 px-4 py-3 ${
										entry.kind === "user"
											? "border-accent/50 bg-accent-soft"
											: "border-white/5 bg-white/[0.02]"
									}`}
								>
									<div className="mb-1.5 flex items-center justify-between text-2xs text-white/30">
										<span className="font-medium uppercase tracking-wider">
											{entry.kind}
										</span>
										<span>
											{new Date(entry.timestamp).toLocaleTimeString([], {
												hour: "numeric",
												minute: "2-digit",
											})}
										</span>
									</div>
									<div className="text-sm leading-relaxed">
										<MarkdownRenderer markdown={entry.markdown} />
									</div>
								</article>
							);
						})}
					</div>
				</div>
			</div>

			{/* Input area */}
			<div className="border-t border-surface-border bg-surface-0 px-4 py-3">
				<div className="mx-auto max-w-4xl">
					<textarea
						value={value}
						onChange={(event) => setValue(event.target.value)}
						onKeyDown={(event) => {
							if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
								event.preventDefault();
								void submit(busy ? "followup" : "send");
							}
						}}
						rows={3}
						placeholder="Ask for follow-up changes..."
						className="w-full resize-none border border-surface-border bg-surface-2 px-3 py-2 text-sm text-white/90 placeholder:text-white/25 outline-none transition focus:border-accent/40"
					/>
					<div className="mt-2 flex items-center justify-between">
						<span className="text-2xs text-white/20">
							{busy ? "Session is running" : "Cmd+Enter to send"}
						</span>
						<div className="flex items-center gap-1">
							{busy ? (
								<>
									<button
										onClick={() => submit("steer")}
										className="flex items-center gap-1 px-2.5 py-1 text-xs text-white/50 transition hover:bg-white/5 hover:text-white/70"
									>
										<Zap className="h-3 w-3" />
										Steer
									</button>
									<button
										onClick={() => submit("followup")}
										className="flex items-center gap-1 px-2.5 py-1 text-xs text-white/50 transition hover:bg-white/5 hover:text-white/70"
									>
										<CornerDownRight className="h-3 w-3" />
										Follow-up
									</button>
									<button
										onClick={props.onAbort}
										className="flex items-center gap-1 px-2.5 py-1 text-xs text-state-error/80 transition hover:bg-state-error/10 hover:text-state-error"
									>
										<Square className="h-3 w-3" />
										Abort
									</button>
								</>
							) : null}
							<button
								onClick={() => submit("send")}
								className="flex items-center gap-1 bg-accent px-3 py-1 text-xs font-medium text-black transition hover:brightness-110"
							>
								<Send className="h-3 w-3" />
								Send
							</button>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}
