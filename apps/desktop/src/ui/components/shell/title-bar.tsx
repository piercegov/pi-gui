import { Terminal, Plus, Settings, ChevronRight } from "lucide-react";
import type { SessionSummary } from "@shared/models";

function statusColor(status: SessionSummary["status"]) {
	if (status === "running") return "bg-state-running";
	if (status === "reviewing") return "bg-state-review";
	if (status === "error") return "bg-state-error";
	if (status === "completed" || status === "merged") return "bg-state-applied";
	return "bg-white/20";
}

export function TitleBar(props: {
	session?: SessionSummary;
	onNewSession: () => void;
	onToggleTerminal: () => void;
	onOpenSettings: () => void;
	supportsEmbeddedTerminal: boolean;
}) {
	return (
		<header className="relative flex h-11 shrink-0 items-center justify-between border-b border-surface-border bg-surface-1 px-3">
			<div className="electrobun-webkit-app-region-drag absolute inset-0" />

			{/* Left: traffic-light spacer + branding */}
			<div className="electrobun-webkit-app-region-drag relative z-10 flex items-center gap-3 pl-16">
				<span className="text-xs font-semibold tracking-wide text-white/40">Pi GUI</span>
				{props.session ? (
					<>
						<ChevronRight className="h-3 w-3 text-white/20" />
						<span className="inline-flex items-center gap-1.5 text-xs text-white/70">
							<span className={`inline-block h-1.5 w-1.5 rounded-full ${statusColor(props.session.status)}`} />
							{props.session.displayName}
						</span>
						<span className="text-2xs text-white/30">{props.session.mode}</span>
					</>
				) : null}
			</div>

			{/* Right: actions */}
			<div className="relative z-10 flex items-center gap-1">
				<button
					onClick={props.onNewSession}
					className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-white/60 transition hover:bg-white/8 hover:text-white/80"
					title="New session (Cmd+N)"
				>
					<Plus className="h-3.5 w-3.5" />
					New thread
				</button>
				<button
					onClick={props.onToggleTerminal}
					disabled={!props.supportsEmbeddedTerminal}
					className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-white/60 transition hover:bg-white/8 hover:text-white/80 disabled:opacity-30"
					title="Toggle terminal (Cmd+J)"
				>
					<Terminal className="h-3.5 w-3.5" />
				</button>
				<button
					onClick={props.onOpenSettings}
					className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-white/60 transition hover:bg-white/8 hover:text-white/80"
					title="Settings (Cmd+,)"
				>
					<Settings className="h-3.5 w-3.5" />
				</button>
			</div>
		</header>
	);
}
