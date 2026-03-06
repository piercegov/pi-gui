import { create } from "zustand";

type LayoutState = {
	terminalOpen: boolean;
	settingsOpen: boolean;
	toggleTerminal: () => void;
	setTerminalOpen: (open: boolean) => void;
	setSettingsOpen: (open: boolean) => void;
};

export const useLayoutStore = create<LayoutState>((set) => ({
	terminalOpen: true,
	settingsOpen: false,
	toggleTerminal() {
		set((state) => ({ terminalOpen: !state.terminalOpen }));
	},
	setTerminalOpen(open) {
		set({ terminalOpen: open });
	},
	setSettingsOpen(open) {
		set({ settingsOpen: open });
	},
}));
