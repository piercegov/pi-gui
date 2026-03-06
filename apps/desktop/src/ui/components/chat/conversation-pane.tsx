import { useState } from "react";
import { Send, Square, CornerDownRight, Zap } from "lucide-react";
import type { ConversationEntryView, SessionSummary, ToolActivityView } from "@shared/models";
import { MarkdownRenderer } from "@ui/lib/markdown";

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
	onSendPrompt: (text: string) => Promise<void>;
	onSteer: (text: string) => Promise<void>;
	onFollowUp: (text: string) => Promise<void>;
	onAbort: () => Promise<void>;
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
						{props.entries.map((entry) => (
							<article
								key={entry.id}
								className={`border-l-2 px-4 py-3 ${
									entry.kind === "user"
										? "border-accent/50 bg-accent-soft"
										: entry.kind === "assistant"
											? "border-transparent"
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
						))}
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
