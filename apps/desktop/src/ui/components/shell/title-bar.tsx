import type { SessionSummary } from "@shared/models";

function statusTone(status: SessionSummary["status"]) {
	if (status === "running") return "bg-[color:var(--state-running)]";
	if (status === "waiting_for_review" || status === "discussion_open") {
		return "bg-[color:var(--state-review)]";
	}
	if (status === "error") return "bg-[color:var(--state-error)]";
	if (status === "completed" || status === "aligned") {
		return "bg-[color:var(--state-applied)]";
	}
	return "bg-black/25";
}

export function TitleBar(props: {
	session?: SessionSummary;
	onNewSession: () => void;
	onToggleTerminal: () => void;
	onOpenSettings: () => void;
	supportsEmbeddedTerminal: boolean;
}) {
	return (
		<header className="relative flex h-14 items-center justify-between border-b border-black/10 px-4">
			<div className="electrobun-webkit-app-region-drag absolute inset-0" />
			<div className="electrobun-webkit-app-region-drag relative z-10 flex items-center gap-3">
				<div className="rounded-full border border-black/10 bg-white/70 px-3 py-1 text-xs uppercase tracking-[0.18em] text-black/60">
					Pi GUI
				</div>
				<div className="text-sm text-black/70">
					Native workflow for Pi sessions, diffs, and review rounds.
				</div>
			</div>

			<div className="electrobun-webkit-app-region-drag pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full border border-black/10 bg-white/70 px-4 py-1.5 text-sm">
				{props.session ? (
					<span className="inline-flex items-center gap-2">
						<span
							className={`inline-block h-2.5 w-2.5 rounded-full ${statusTone(props.session.status)}`}
						/>
						<span className="font-medium">{props.session.displayName}</span>
						<span className="text-black/45">{props.session.mode}</span>
						<span className="text-black/45">{props.session.reviewState}</span>
					</span>
				) : (
					<span className="text-black/50">No session open</span>
				)}
			</div>

			<div className="relative z-10 flex items-center gap-2">
				<button
					onClick={props.onNewSession}
					className="rounded-full border border-black/10 bg-white/80 px-3 py-1.5 text-sm text-black/75 transition hover:bg-white"
				>
					New session
				</button>
				<button
					onClick={props.onToggleTerminal}
					disabled={!props.supportsEmbeddedTerminal}
					className="rounded-full border border-black/10 bg-white/80 px-3 py-1.5 text-sm text-black/75 transition hover:bg-white"
				>
					{props.supportsEmbeddedTerminal ? "Terminal" : "Terminal unavailable"}
				</button>
				<button
					onClick={props.onOpenSettings}
					className="rounded-full border border-black/10 bg-[color:var(--accent)] px-3 py-1.5 text-sm text-white transition hover:opacity-90"
				>
					Settings
				</button>
			</div>
		</header>
	);
}
