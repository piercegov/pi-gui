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
			fontFamily: "SF Mono, Menlo, Monaco, Consolas, monospace",
			fontSize: 13,
			theme: {
				background: "#1a1a1a",
				foreground: "#e8e8e8",
				cursor: "#3ddc84",
				selectionBackground: "rgba(61, 220, 132, 0.2)",
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
			className={`border-t border-surface-border bg-surface-0 transition-[height] ${
				props.open ? "h-64" : "h-0 overflow-hidden"
			}`}
		>
			<Tabs.Root defaultValue="terminal" className="flex h-full flex-col">
				<Tabs.List className="flex gap-px border-b border-surface-border">
					{["terminal", "tools", "git"].map((value) => (
						<Tabs.Trigger
							key={value}
							value={value}
							className="px-3 py-1.5 text-xs capitalize text-white/40 transition hover:text-white/60 data-[state=active]:border-b data-[state=active]:border-accent data-[state=active]:text-accent"
						>
							{value}
						</Tabs.Trigger>
					))}
				</Tabs.List>
				<Tabs.Content value="terminal" className="min-h-0 flex-1">
					{props.supported ? (
						<div ref={terminalRef} className="h-full w-full" />
					) : (
						<div className="flex h-full items-center justify-center text-sm text-white/30">
							Embedded terminal is unavailable on this platform.
						</div>
					)}
				</Tabs.Content>
				<Tabs.Content value="tools" className="min-h-0 flex-1 overflow-auto px-3 py-2">
					<div className="space-y-px">
						{props.toolActivity.map((activity) => (
							<div key={activity.id} className="border-b border-surface-border px-2 py-1.5">
								<div className="flex items-center justify-between text-2xs text-white/30">
									<span className="mono">{activity.toolName}</span>
									<span className={activity.status === "started" || activity.status === "streaming" ? "text-accent" : ""}>
										{activity.status}
									</span>
								</div>
								<div className="mt-0.5 mono text-2xs text-white/40">{activity.argsSummary}</div>
								{activity.outputSnippet ? (
									<div className="mt-0.5 text-2xs text-white/20">{activity.outputSnippet}</div>
								) : null}
							</div>
						))}
					</div>
				</Tabs.Content>
				<Tabs.Content value="git" className="min-h-0 flex-1 overflow-auto px-3 py-2">
					<div className="py-4 text-center text-2xs text-white/20">
						Git output is shown in the diff pane.
					</div>
				</Tabs.Content>
			</Tabs.Root>
		</div>
	);
}
