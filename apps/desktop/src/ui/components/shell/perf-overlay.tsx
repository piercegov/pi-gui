import { Profiler, useCallback, useEffect, useRef, useState } from "react";
import type { ProfilerOnRenderCallback, ReactNode } from "react";

type PerfStats = {
	fps: number;
	frameTime: number; // ms, average
	frameTimeMax: number; // ms, worst frame in window
	reactCommits: number; // React commits per second
	reactAvg: number; // avg commit duration (ms)
	reactMax: number; // worst commit duration (ms)
	longTasks: number; // long tasks (>50ms) per second
};

// Shared render tracking — written to by PerfProfiler, read by PerfOverlay
const renderLog: { time: number; duration: number }[] = [];
let longTaskCount = 0;

/**
 * Wrap a subtree in this to feed render timing into the perf overlay.
 * Usage: <PerfProfiler id="App"><App /></PerfProfiler>
 */
export function PerfProfiler({ id, children }: { id: string; children: ReactNode }) {
	const onRender: ProfilerOnRenderCallback = useCallback(
		(_id, _phase, actualDuration) => {
			renderLog.push({ time: performance.now(), duration: actualDuration });
			// Keep bounded
			if (renderLog.length > 300) renderLog.splice(0, renderLog.length - 150);
		},
		[],
	);
	return (
		<Profiler id={id} onRender={onRender}>
			{children}
		</Profiler>
	);
}

/**
 * Transparent performance overlay showing FPS, frame times, React render
 * costs, and long-task counts.
 * Toggle with Ctrl+Shift+P (or Cmd+Shift+P on macOS).
 */
export function PerfOverlay() {
	const [visible, setVisible] = useState(false);
	const [stats, setStats] = useState<PerfStats>({
		fps: 0, frameTime: 0, frameTimeMax: 0,
		reactCommits: 0, reactAvg: 0, reactMax: 0,
		longTasks: 0,
	});
	const rafRef = useRef(0);
	const frameTimes = useRef<number[]>([]);
	const lastTime = useRef(0);

	// Toggle hotkey
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "P") {
				e.preventDefault();
				setVisible((v) => !v);
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, []);

	// Long task observer (tasks > 50ms on main thread)
	useEffect(() => {
		if (!visible) return;
		longTaskCount = 0;
		if (typeof PerformanceObserver === "undefined") return;
		try {
			const obs = new PerformanceObserver((list) => {
				longTaskCount += list.getEntries().length;
			});
			obs.observe({ type: "longtask", buffered: false });
			return () => obs.disconnect();
		} catch {
			// longtask not supported in this runtime
		}
	}, [visible]);

	const tick = useCallback((now: DOMHighResTimeStamp) => {
		if (lastTime.current > 0) {
			const dt = now - lastTime.current;
			frameTimes.current.push(dt);
			if (frameTimes.current.length > 120) {
				frameTimes.current = frameTimes.current.slice(-60);
			}
		}
		lastTime.current = now;

		// Update display ~4 times per second
		if (frameTimes.current.length > 0 && frameTimes.current.length % 15 === 0) {
			const times = frameTimes.current.slice(-60);
			const avg = times.reduce((a, b) => a + b, 0) / times.length;
			const max = Math.max(...times);

			// React render stats from the last ~1 second
			const cutoff = now - 1000;
			const recent = renderLog.filter((r) => r.time >= cutoff);
			const reactAvg =
				recent.length > 0
					? recent.reduce((a, r) => a + r.duration, 0) / recent.length
					: 0;
			const reactMax =
				recent.length > 0 ? Math.max(...recent.map((r) => r.duration)) : 0;

			setStats({
				fps: Math.round(1000 / avg),
				frameTime: Math.round(avg * 10) / 10,
				frameTimeMax: Math.round(max * 10) / 10,
				reactCommits: recent.length,
				reactAvg: Math.round(reactAvg * 10) / 10,
				reactMax: Math.round(reactMax * 10) / 10,
				longTasks: longTaskCount,
			});
			longTaskCount = 0;
		}

		rafRef.current = requestAnimationFrame(tick);
	}, []);

	useEffect(() => {
		if (!visible) {
			cancelAnimationFrame(rafRef.current);
			lastTime.current = 0;
			frameTimes.current = [];
			return;
		}
		rafRef.current = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(rafRef.current);
	}, [visible, tick]);

	if (!visible) return null;

	const fpsColor =
		stats.fps >= 110 ? "text-green-400" :
		stats.fps >= 55 ? "text-yellow-400" :
		"text-red-400";

	return (
		<div className="pointer-events-none fixed left-2 top-8 z-[9999] font-mono text-[11px] leading-tight">
			<div className="rounded bg-black/70 px-2 py-1.5 tabular-nums">
				<div className={fpsColor}>{stats.fps} FPS</div>
				<div className="text-white/60">
					{stats.frameTime} ms avg · {stats.frameTimeMax} ms max
				</div>
				{stats.reactCommits > 0 && (
					<div className="mt-1 border-t border-white/10 pt-1">
						<div className="text-blue-300">
							{stats.reactCommits} renders/s
						</div>
						<div className="text-white/60">
							{stats.reactAvg} ms avg · {stats.reactMax} ms max
						</div>
					</div>
				)}
				{stats.longTasks > 0 && (
					<div className="text-red-300 mt-0.5">
						{stats.longTasks} long tasks
					</div>
				)}
			</div>
		</div>
	);
}
