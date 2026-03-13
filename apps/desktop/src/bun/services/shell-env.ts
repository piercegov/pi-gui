/**
 * Resolves the user's full shell environment by spawning a login shell.
 *
 * macOS GUI apps launched from Finder/Dock/Spotlight receive a minimal
 * environment from launchd that lacks PATH entries added by shell rc files
 * (e.g. Homebrew's `/opt/homebrew/bin` set up in `.zprofile`).
 *
 * This module spawns a login interactive shell at startup, captures its
 * environment, and merges it into `process.env` so all downstream consumers
 * (terminal PTY, git operations, pi agent) get the user's real PATH.
 */

const DEFAULT_TIMEOUT_MS = 10_000;
const ENV_CAPTURE_SENTINEL = "__PI_ENV_START__";

function parseEnvNul(raw: string): Record<string, string> {
	const env: Record<string, string> = {};
	for (const entry of raw.split("\0")) {
		if (!entry) continue;
		const eq = entry.indexOf("=");
		if (eq === -1) continue;
		env[entry.slice(0, eq)] = entry.slice(eq + 1);
	}
	return env;
}

function shellBasename(shell: string) {
	const trimmed = shell.trim();
	if (!trimmed) return "";
	const parts = trimmed.split("/");
	return parts[parts.length - 1] ?? trimmed;
}

function buildEnvCaptureCommand(shell: string) {
	const shellName = shellBasename(shell);
	if (shellName === "zsh" || shellName === "bash") {
		return [
			shell,
			"-i",
			"-l",
			"-c",
			`printf '%s\\0' '${ENV_CAPTURE_SENTINEL}'; env -0`,
		];
	}
	return [shell, "-l", "-c", "env -0"];
}

function extractCapturedEnv(raw: string) {
	const marker = `${ENV_CAPTURE_SENTINEL}\0`;
	const markerIndex = raw.indexOf(marker);
	return markerIndex === -1 ? raw : raw.slice(markerIndex + marker.length);
}

export async function resolveShellEnvironment(
	timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<void> {
	if (process.platform === "win32") return;

	const shell = process.env.SHELL ?? "/bin/zsh";

	try {
		const proc = Bun.spawn(buildEnvCaptureCommand(shell), {
			stdout: "pipe",
			stderr: "pipe",
		});

		const result = await Promise.race([
			proc.exited,
			new Promise<"timeout">((resolve) =>
				setTimeout(() => resolve("timeout"), timeoutMs),
			),
		]);

		if (result === "timeout") {
			proc.kill();
			console.warn(
				"[shell-env] Login shell timed out after %dms — using default environment",
				timeoutMs,
			);
			return;
		}

		if (result !== 0) {
			console.warn(
				"[shell-env] Login shell exited with code %d — using default environment",
				result,
			);
			return;
		}

		const stdout = extractCapturedEnv(await new Response(proc.stdout).text());
		if (!stdout) {
			console.warn("[shell-env] Login shell produced no output — using default environment");
			return;
		}

		const resolved = parseEnvNul(stdout);
		if (!resolved.PATH) {
			console.warn("[shell-env] Resolved environment has no PATH — using default environment");
			return;
		}

		// Merge resolved env into process.env.
		// We overwrite existing keys so the shell's fully-constructed PATH wins
		// over the minimal launchd PATH, but we preserve any keys that only
		// exist in the current process.env (e.g. Electrobun internals).
		for (const [key, value] of Object.entries(resolved)) {
			process.env[key] = value;
		}
	} catch (err) {
		console.warn("[shell-env] Failed to resolve shell environment:", err);
	}
}
