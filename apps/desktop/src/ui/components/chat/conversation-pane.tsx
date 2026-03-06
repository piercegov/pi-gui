import { useState } from "react";
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
			<section className="flex h-full items-center justify-center">
				<div className="surface-panel max-w-lg rounded-[28px] px-8 py-10 text-center">
					<div className="text-sm uppercase tracking-[0.18em] text-black/45">
						Conversation
					</div>
					<h2 className="mt-3 text-3xl font-semibold">Open a session to start</h2>
					<p className="mt-3 text-black/60">
						Projects and sessions stay local. Diff and review state are restored
						when you reopen a session.
					</p>
				</div>
			</section>
		);
	}

	return (
		<section className="flex h-full flex-col bg-white/30">
			<div className="border-b border-black/10 px-6 py-4">
				<div className="flex flex-wrap items-center gap-2">
					{badge(props.session).map((item) => (
						<span
							key={item}
							className="rounded-full border border-black/10 bg-white/80 px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] text-black/55"
						>
							{item}
						</span>
					))}
				</div>
				<div className="mt-4 flex gap-3 overflow-x-auto pb-1">
					{props.toolActivity.slice(0, 4).map((activity) => (
						<div
							key={activity.id}
							className="min-w-[220px] rounded-2xl border border-black/10 bg-white/75 px-3 py-2"
						>
							<div className="text-xs uppercase tracking-[0.14em] text-black/45">
								{activity.status}
							</div>
							<div className="mt-1 mono text-sm font-medium">
								{activity.toolName}
							</div>
							<div className="mt-1 line-clamp-2 text-xs text-black/55">
								{activity.outputSnippet || activity.argsSummary}
							</div>
						</div>
					))}
				</div>
			</div>

			<div className="flex-1 overflow-auto px-6 py-5">
				<div className="mx-auto flex max-w-4xl flex-col gap-4">
					{props.entries.map((entry) => (
						<article
							key={entry.id}
							className={`rounded-[24px] border px-4 py-3 ${
								entry.kind === "assistant"
									? "border-black/10 bg-white/85"
									: entry.kind === "user"
										? "ml-12 border-[color:var(--accent)]/20 bg-[color:var(--accent-soft)]"
										: "border-black/8 bg-white/55"
							}`}
						>
							<div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-[0.14em] text-black/40">
								<span>{entry.kind}</span>
								<span>
									{new Date(entry.timestamp).toLocaleTimeString([], {
										hour: "numeric",
										minute: "2-digit",
									})}
								</span>
							</div>
							<MarkdownRenderer markdown={entry.markdown} />
						</article>
					))}
				</div>
			</div>

			<div className="border-t border-black/10 px-6 py-5">
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
						rows={4}
						placeholder="Ask Pi to inspect, change, or explain the project..."
						className="w-full rounded-[24px] border border-black/10 bg-white/85 px-4 py-3 text-[15px] outline-none transition focus:border-[color:var(--accent)]"
					/>
					<div className="mt-3 flex flex-wrap items-center justify-between gap-3">
						<div className="text-xs text-black/45">
							{busy
								? "Steer interrupts after the current tool. Follow-up waits for the current run to end."
								: "Use Cmd/Ctrl+Enter to send without leaving the keyboard."}
						</div>
						<div className="flex flex-wrap gap-2">
							{busy ? (
								<>
									<button
										onClick={() => submit("steer")}
										className="rounded-full border border-black/10 bg-white/80 px-3 py-1.5 text-sm text-black/70 transition hover:bg-white"
									>
										Steer
									</button>
									<button
										onClick={() => submit("followup")}
										className="rounded-full border border-black/10 bg-white/80 px-3 py-1.5 text-sm text-black/70 transition hover:bg-white"
									>
										Follow-up
									</button>
									<button
										onClick={props.onAbort}
										className="rounded-full border border-[color:var(--state-error)]/25 bg-white/80 px-3 py-1.5 text-sm text-[color:var(--state-error)] transition hover:bg-white"
									>
										Abort
									</button>
								</>
							) : null}
							<button
								onClick={() => submit("send")}
								className="rounded-full bg-[color:var(--accent)] px-4 py-1.5 text-sm text-white transition hover:opacity-90"
							>
								Send
							</button>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}
