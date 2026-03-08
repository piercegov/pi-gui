import { create } from "zustand";
import { rpc } from "@ui/lib/rpc-client";

type TerminalState = {
	terminalIds: Record<string, string>;
	output: Record<string, string>;
	exits: Record<string, number>;
	registerTerminal: (sessionId: string, terminalId: string) => void;
	ensureTerminal: (sessionId: string) => Promise<string | undefined>;
	appendOutput: (sessionId: string, data: string) => void;
	markExit: (sessionId: string, exitCode: number) => void;
	resize: (sessionId: string, cols: number, rows: number) => Promise<void>;
	write: (sessionId: string, data: string) => Promise<void>;
	isRunning: (sessionId: string) => boolean;
	stopTerminal: (sessionId: string) => Promise<void>;
};

export const useTerminalStore = create<TerminalState>((set, get) => ({
	terminalIds: {},
	output: {},
	exits: {},
	registerTerminal(sessionId, terminalId) {
		set((state) => {
			const { [sessionId]: _ignoredExit, ...remainingExits } = state.exits;
			return {
				terminalIds: {
					...state.terminalIds,
					[sessionId]: terminalId,
				},
				exits: remainingExits,
			};
		});
	},
	async ensureTerminal(sessionId) {
		const existing = get().terminalIds[sessionId];
		if (existing && !(sessionId in get().exits)) return existing;
		const created = await rpc.request.openTerminal({ sessionId });
		get().registerTerminal(sessionId, created.terminalId);
		return created.terminalId;
	},
	appendOutput(sessionId, data) {
		set((state) => ({
			output: {
				...state.output,
				[sessionId]: `${state.output[sessionId] ?? ""}${data}`,
			},
		}));
	},
	markExit(sessionId, exitCode) {
		set((state) => {
			const { [sessionId]: _ignoredTerminalId, ...remainingTerminalIds } =
				state.terminalIds;
			return {
				terminalIds: remainingTerminalIds,
				exits: {
					...state.exits,
					[sessionId]: exitCode,
				},
			};
		});
	},
	async resize(sessionId, cols, rows) {
		if (cols <= 0 || rows <= 0) return;
		const terminalId = get().terminalIds[sessionId];
		if (!terminalId) return;
		await rpc.request.resizeTerminal({ terminalId, cols, rows });
	},
	async write(sessionId, data) {
		const terminalId = await get().ensureTerminal(sessionId);
		if (!terminalId) return;
		await rpc.request.writeTerminal({ terminalId, data });
	},
	isRunning(sessionId) {
		const terminalId = get().terminalIds[sessionId];
		if (!terminalId) return false;
		return !(sessionId in get().exits);
	},
	async stopTerminal(sessionId) {
		const terminalId = get().terminalIds[sessionId];
		if (!terminalId) return;
		await rpc.request.closeTerminal({ terminalId });
		set((state) => {
			const { [sessionId]: _ignoredTerminalId, ...remainingTerminalIds } =
				state.terminalIds;
			return {
				terminalIds: remainingTerminalIds,
			};
		});
	},
}));
