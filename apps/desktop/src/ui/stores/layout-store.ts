import { create } from "zustand";

type LayoutState = {
	terminalOpen: boolean;
	settingsOpen: boolean;
	sidebarWidth: number;
	diffPaneWidth: number;
	toggleTerminal: () => void;
	setTerminalOpen: (open: boolean) => void;
	setSettingsOpen: (open: boolean) => void;
	setSidebarWidth: (width: number) => void;
	adjustSidebarWidth: (delta: number) => void;
	setDiffPaneWidth: (width: number) => void;
	adjustDiffPaneWidth: (delta: number) => void;
};

export const useLayoutStore = create<LayoutState>((set) => ({
	terminalOpen: true,
	settingsOpen: false,
	sidebarWidth: 240,
	diffPaneWidth: 480,
	toggleTerminal() {
		set((state) => ({ terminalOpen: !state.terminalOpen }));
	},
	setTerminalOpen(open) {
		set({ terminalOpen: open });
	},
	setSettingsOpen(open) {
		set({ settingsOpen: open });
	},
	setSidebarWidth(width) {
		set({ sidebarWidth: Math.max(160, Math.min(400, width)) });
	},
	adjustSidebarWidth(delta) {
		set((state) => ({ sidebarWidth: Math.max(160, Math.min(400, state.sidebarWidth + delta)) }));
	},
	setDiffPaneWidth(width) {
		set({ diffPaneWidth: Math.max(280, Math.min(900, width)) });
	},
	adjustDiffPaneWidth(delta) {
		set((state) => ({ diffPaneWidth: Math.max(280, Math.min(900, state.diffPaneWidth + delta)) }));
	},
}));
