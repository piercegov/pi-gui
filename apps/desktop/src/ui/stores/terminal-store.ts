import { create } from "zustand";
import { rpc } from "@ui/lib/rpc-client";

type TerminalState = {
	terminalIds: Record<string, string>;
	output: Record<string, string>;
	exits: Record<string, number>;
	ensureTerminal: (sessionId: string) => Promise<string | undefined>;
	appendOutput: (sessionId: string, data: string) => void;
	markExit: (sessionId: string, exitCode: number) => void;
	write: (sessionId: string, data: string) => Promise<void>;
};

export const useTerminalStore = create<TerminalState>((set, get) => ({
	terminalIds: {},
	output: {},
	exits: {},
	async ensureTerminal(sessionId) {
		const existing = get().terminalIds[sessionId];
		if (existing) return existing;
		const created = await rpc.request.openTerminal({ sessionId });
		set((state) => ({
			terminalIds: {
				...state.terminalIds,
				[sessionId]: created.terminalId,
			},
		}));
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
		set((state) => ({
			exits: {
				...state.exits,
				[sessionId]: exitCode,
			},
		}));
	},
	async write(sessionId, data) {
		const terminalId = await get().ensureTerminal(sessionId);
		if (!terminalId) return;
		await rpc.request.writeTerminal({ terminalId, data });
	},
}));
