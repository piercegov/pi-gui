import { create } from "zustand";

type LayoutState = {
	terminalOpen: boolean;
	settingsOpen: boolean;
	reviewPaneOpen: boolean;
	sidebarWidth: number;
	diffPaneWidth: number;
	toggleTerminal: () => void;
	setTerminalOpen: (open: boolean) => void;
	setSettingsOpen: (open: boolean) => void;
	toggleReviewPane: () => void;
	setReviewPaneOpen: (open: boolean) => void;
	setSidebarWidth: (width: number) => void;
	adjustSidebarWidth: (delta: number) => void;
	setDiffPaneWidth: (width: number, maxWidth?: number) => void;
	adjustDiffPaneWidth: (delta: number, maxWidth?: number) => void;
};

export const useLayoutStore = create<LayoutState>((set) => ({
	terminalOpen: true,
	settingsOpen: false,
	reviewPaneOpen: true,
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
	toggleReviewPane() {
		set((state) => ({ reviewPaneOpen: !state.reviewPaneOpen }));
	},
	setReviewPaneOpen(open) {
		set({ reviewPaneOpen: open });
	},
	setSidebarWidth(width) {
		set({ sidebarWidth: Math.max(160, Math.min(400, width)) });
	},
	adjustSidebarWidth(delta) {
		set((state) => ({ sidebarWidth: Math.max(160, Math.min(400, state.sidebarWidth + delta)) }));
	},
	setDiffPaneWidth(width, maxWidth = 9999) {
		set({ diffPaneWidth: Math.max(280, Math.min(maxWidth, width)) });
	},
	adjustDiffPaneWidth(delta, maxWidth = 9999) {
		set((state) => ({ diffPaneWidth: Math.max(280, Math.min(maxWidth, state.diffPaneWidth + delta)) }));
	},
}));
