export type DiffPerfKind =
	| "parse_diff"
	| "tokenize_file"
	| "build_widgets"
	| "diff_render_mode"
	| "diff_render";

export type DiffPerfEvent = {
	kind: DiffPerfKind;
	diffId?: string;
	filePath?: string;
	durationMs: number;
	timestamp: number;
	metadata?: Record<string, number | string | boolean>;
};

declare global {
	interface Window {
		__PI_DIFF_PERF__?: DiffPerfEvent[];
	}
}

const MAX_EVENTS = 100;

function diffPerfEnabled() {
	if (typeof window === "undefined") return false;
	try {
		return window.localStorage.getItem("piDebugDiffPerf") === "1";
	} catch {
		return false;
	}
}

export function recordDiffPerf(event: DiffPerfEvent) {
	if (typeof window === "undefined") return;
	const events = window.__PI_DIFF_PERF__ ?? [];
	events.push(event);
	if (events.length > MAX_EVENTS) {
		events.splice(0, events.length - MAX_EVENTS);
	}
	window.__PI_DIFF_PERF__ = events;
	if (diffPerfEnabled()) {
		console.debug("[pi-diff-perf]", event);
	}
}

export function measureDiffPerf<T>(
	kind: DiffPerfKind,
	run: () => T,
	options?: {
		diffId?: string;
		filePath?: string;
		metadata?: Record<string, number | string | boolean>;
	},
) {
	const start = performance.now();
	const result = run();
	recordDiffPerf({
		kind,
		diffId: options?.diffId,
		filePath: options?.filePath,
		durationMs: performance.now() - start,
		timestamp: Date.now(),
		metadata: options?.metadata,
	});
	return result;
}
