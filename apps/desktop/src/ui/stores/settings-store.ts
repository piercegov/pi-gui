import { create } from "zustand";
import type { AppSettings, SessionHydration } from "@shared/models";
import { rpc } from "@ui/lib/rpc-client";

type SettingsState = {
	settings?: AppSettings;
	load: () => Promise<void>;
	hydrate: (hydration: SessionHydration) => void;
	update: (patch: Partial<AppSettings>) => Promise<void>;
};

export const useSettingsStore = create<SettingsState>((set) => ({
	settings: undefined,
	async load() {
		set({ settings: await rpc.request.getAppSettings() });
	},
	hydrate(hydration) {
		set({ settings: hydration.appSettings });
	},
	async update(patch) {
		const settings = await rpc.request.updateAppSettings(patch);
		set({ settings });
	},
}));
