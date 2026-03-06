import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const APP_NAME = "Pi GUI";

function resolveAppDataDir() {
	if (process.platform === "darwin") {
		return join(homedir(), "Library", "Application Support", APP_NAME);
	}
	if (process.platform === "win32") {
		return join(
			process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
			APP_NAME,
		);
	}
	return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "pi-gui");
}

const appDataDir = resolveAppDataDir();

export const appPaths = {
	appDataDir,
	dbPath: join(appDataDir, "app.db"),
	logsDir: join(appDataDir, "logs"),
	diffsDir: join(appDataDir, "diffs"),
	checkpointsDir: join(appDataDir, "checkpoints"),
	worktreesDir: join(appDataDir, "worktrees"),
	sessionStoreDir: join(appDataDir, "pi-sessions"),
	tempDir: join(appDataDir, "tmp"),
};

export function ensureAppPaths() {
	mkdirSync(appPaths.appDataDir, { recursive: true });
	mkdirSync(appPaths.logsDir, { recursive: true });
	mkdirSync(appPaths.diffsDir, { recursive: true });
	mkdirSync(appPaths.checkpointsDir, { recursive: true });
	mkdirSync(appPaths.worktreesDir, { recursive: true });
	mkdirSync(appPaths.sessionStoreDir, { recursive: true });
	mkdirSync(appPaths.tempDir, { recursive: true });
}

export function sanitizeBranchSegment(value: string) {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
}
