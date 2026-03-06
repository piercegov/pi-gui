import type { AppSettings } from "../../shared/models";
import { AppDb } from "./db";

const SETTINGS_KEY = "app-settings";

export const defaultAppSettings: AppSettings = {
	defaultDiffView: "split",
	defaultSessionMode: "worktree",
	defaultEditor: "code",
	terminalShell: process.env.SHELL ?? "/bin/zsh",
	markdownFontSize: 15,
	codeFontSize: 14,
	archiveRetentionPolicy: "manual",
	showArchived: false,
	uiDensity: "compact",
	accentColor: "#05A0D1",
	stateRunningColor: "#3ddc84",
	stateReviewColor: "#f0a830",
	stateErrorColor: "#f44336",
	stateAppliedColor: "#66bb6a",
	environmentOverrides: {},
};

type PreferenceRow = {
	value_json: string;
};

export class SettingsService {
	constructor(private readonly db: AppDb) {}

	getAppSettings(): AppSettings {
		const row = this.db.get<PreferenceRow>(
			"select value_json from ui_preferences where key = ?",
			SETTINGS_KEY,
		);
		if (!row) return { ...defaultAppSettings };
		try {
			return { ...defaultAppSettings, ...JSON.parse(row.value_json) };
		} catch {
			return { ...defaultAppSettings };
		}
	}

	updateAppSettings(patch: Partial<AppSettings>): AppSettings {
		const next = { ...this.getAppSettings(), ...patch };
		const now = Date.now();
		this.db.run(
			`
			insert into ui_preferences (key, value_json, updated_at)
			values (?, ?, ?)
			on conflict(key) do update set
				value_json = excluded.value_json,
				updated_at = excluded.updated_at
			`,
			SETTINGS_KEY,
			JSON.stringify(next),
			now,
		);
		return next;
	}
}
