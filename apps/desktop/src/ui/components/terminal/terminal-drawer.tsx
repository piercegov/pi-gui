import { useEffect, useRef } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import type { ToolActivityView } from "@shared/models";
import { useTerminalStore } from "@ui/stores/terminal-store";

export function TerminalDrawer(props: {
	sessionId?: string;
	open: boolean;
	toolActivity: ToolActivityView[];
	supported: boolean;
}) {
	const terminalRef = useRef<HTMLDivElement | null>(null);
	const xtermRef = useRef<Terminal | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const output = useTerminalStore((state) =>
		props.sessionId ? state.output[props.sessionId] ?? "" : "",
	);
	const lastOutputLength = useRef(0);

	useEffect(() => {
		if (
			!props.supported ||
			!props.open ||
			!props.sessionId ||
			!terminalRef.current ||
			xtermRef.current
		) {
			return;
		}
		const terminal = new Terminal({
			fontFamily: "SF Mono, IBM Plex Mono, monospace",
			fontSize: 13,
			theme: {
				background: "#f6f2eb",
				foreground: "#1f1912",
				cursor: "#0f7b6c",
			},
		});
		const fitAddon = new FitAddon();
		terminal.loadAddon(fitAddon);
		terminal.open(terminalRef.current);
		fitAddon.fit();
		xtermRef.current = terminal;
		fitAddonRef.current = fitAddon;
		void useTerminalStore.getState().ensureTerminal(props.sessionId);
		terminal.onData((data) => {
			void useTerminalStore.getState().write(props.sessionId!, data);
		});
		const observer = new ResizeObserver(() => fitAddon.fit());
		observer.observe(terminalRef.current);
		return () => {
			observer.disconnect();
			terminal.dispose();
			xtermRef.current = null;
			fitAddonRef.current = null;
		};
	}, [props.open, props.sessionId, props.supported]);

	useEffect(() => {
		lastOutputLength.current = 0;
	}, [props.sessionId]);

	useEffect(() => {
		if (!xtermRef.current) return;
		const delta = output.slice(lastOutputLength.current);
		if (delta) {
			xtermRef.current.write(delta);
			lastOutputLength.current = output.length;
		}
	}, [output]);

	return (
		<div
			className={`border-t border-black/10 bg-white/50 transition-[height] ${
				props.open ? "h-64" : "h-0 overflow-hidden"
			}`}
		>
			<Tabs.Root defaultValue="terminal" className="flex h-full flex-col">
				<Tabs.List className="flex gap-2 border-b border-black/10 px-4 py-3">
					{["terminal", "tools", "git"].map((value) => (
						<Tabs.Trigger
							key={value}
							value={value}
							className="rounded-full border border-black/10 bg-white/80 px-3 py-1.5 text-sm text-black/65 data-[state=active]:bg-[color:var(--accent)] data-[state=active]:text-white"
						>
							{value}
						</Tabs.Trigger>
					))}
				</Tabs.List>
				<Tabs.Content value="terminal" className="min-h-0 flex-1">
					{props.supported ? (
						<div ref={terminalRef} className="h-full w-full" />
					) : (
						<div className="flex h-full items-center justify-center px-6 text-center text-sm text-black/55">
							Embedded terminal support is currently unavailable on this platform.
							Chat, diffs, and review remain fully usable.
						</div>
					)}
				</Tabs.Content>
				<Tabs.Content value="tools" className="min-h-0 flex-1 overflow-auto px-4 py-3">
					<div className="space-y-2">
						{props.toolActivity.map((activity) => (
							<div key={activity.id} className="rounded-2xl border border-black/10 bg-white/80 px-3 py-2">
								<div className="flex items-center justify-between text-[11px] uppercase tracking-[0.14em] text-black/45">
									<span>{activity.toolName}</span>
									<span>{activity.status}</span>
								</div>
								<div className="mt-2 mono text-sm">{activity.argsSummary}</div>
								{activity.outputSnippet ? (
									<div className="mt-2 text-xs text-black/55">{activity.outputSnippet}</div>
								) : null}
							</div>
						))}
					</div>
				</Tabs.Content>
				<Tabs.Content value="git" className="min-h-0 flex-1 overflow-auto px-4 py-3">
					<div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-4 py-6 text-sm text-black/50">
						Git output is surfaced through the diff and status panes in this build.
					</div>
				</Tabs.Content>
			</Tabs.Root>
		</div>
	);
}
