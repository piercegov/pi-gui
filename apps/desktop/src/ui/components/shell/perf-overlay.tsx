import { useCallback, useEffect, useRef, useState } from "react";

type PerfStats = {
	fps: number;
	frameTime: number; // ms, average
	frameTimeMax: number; // ms, worst frame in window
};

/**
 * Transparent performance overlay showing FPS and frame times.
 * Toggle with Ctrl+Shift+P (or Cmd+Shift+P on macOS).
 */
export function PerfOverlay() {
	const [visible, setVisible] = useState(false);
	const [stats, setStats] = useState<PerfStats>({ fps: 0, frameTime: 0, frameTimeMax: 0 });
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

	const tick = useCallback((now: DOMHighResTimeStamp) => {
		if (lastTime.current > 0) {
			const dt = now - lastTime.current;
			frameTimes.current.push(dt);
			// Keep a 1-second rolling window
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
			setStats({
				fps: Math.round(1000 / avg),
				frameTime: Math.round(avg * 10) / 10,
				frameTimeMax: Math.round(max * 10) / 10,
			});
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
		stats.fps >= 55 ? "text-green-400" :
		stats.fps >= 30 ? "text-yellow-400" :
		"text-red-400";

	return (
		<div className="pointer-events-none fixed left-2 top-8 z-[9999] font-mono text-[11px] leading-tight">
			<div className="rounded bg-black/70 px-2 py-1.5 tabular-nums">
				<div className={fpsColor}>{stats.fps} FPS</div>
				<div className="text-white/60">
					{stats.frameTime} ms avg
				</div>
				<div className="text-white/40">
					{stats.frameTimeMax} ms max
				</div>
			</div>
		</div>
	);
}
