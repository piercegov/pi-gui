import { useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { useTerminalStore } from "@ui/stores/terminal-store";

export function TerminalDrawer(props: {
	sessionId?: string;
	open: boolean;
	supported: boolean;
}) {
	const terminalRef = useRef<HTMLDivElement | null>(null);
	const xtermRef = useRef<Terminal | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const openRef = useRef(props.open);
	openRef.current = props.open;
	const ensureTerminal = useTerminalStore((state) => state.ensureTerminal);
	const resizeTerminal = useTerminalStore((state) => state.resize);
	const output = useTerminalStore((state) =>
		props.sessionId ? state.output[props.sessionId] ?? "" : "",
	);
	const lastOutputLength = useRef(0);

	useEffect(() => {
		if (!props.supported || !props.sessionId || !terminalRef.current || xtermRef.current) {
			return;
		}
		const terminal = new Terminal({
			fontFamily: "JetBrains Mono, SF Mono, Menlo, Monaco, Consolas, monospace",
			fontSize: 13,
			theme: {
				background: "#1a1a1a",
				foreground: "#e8e8e8",
				cursor: "#3ddc84",
				selectionBackground: "rgba(61, 220, 132, 0.2)",
			},
		});
		const fitAddon = new FitAddon();
		const { sessionId } = props;
		terminal.loadAddon(fitAddon);
		terminal.open(terminalRef.current);
		xtermRef.current = terminal;
		fitAddonRef.current = fitAddon;
		const fitAndResize = () => {
			if (!openRef.current) return;
			fitAddon.fit();
			void resizeTerminal(sessionId, terminal.cols, terminal.rows);
		};
		void ensureTerminal(sessionId).then(() => {
			fitAndResize();
		});
		terminal.onData((data) => {
			void useTerminalStore.getState().write(sessionId, data);
		});
		const observer = new ResizeObserver(() => fitAndResize());
		observer.observe(terminalRef.current);
		return () => {
			observer.disconnect();
			terminal.dispose();
			xtermRef.current = null;
			fitAddonRef.current = null;
		};
	}, [ensureTerminal, props.sessionId, props.supported, resizeTerminal]);

	useEffect(() => {
		lastOutputLength.current = 0;
	}, [props.sessionId]);

	useEffect(() => {
		if (!props.open || !props.sessionId || !fitAddonRef.current || !xtermRef.current) return;
		fitAddonRef.current.fit();
		void resizeTerminal(props.sessionId, xtermRef.current.cols, xtermRef.current.rows);
	}, [props.open, props.sessionId, resizeTerminal]);

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
			<div className="flex h-full flex-col">
				<div className="min-h-0 flex-1">
					{props.supported ? (
						<div ref={terminalRef} data-allow-context-menu className="h-full w-full" />
					) : (
						<div className="flex h-full items-center justify-center text-xs text-white/30">
							Embedded terminal is unavailable on this platform.
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
