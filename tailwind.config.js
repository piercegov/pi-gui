/** @type {import('tailwindcss').Config} */
export default {
	content: ["./apps/desktop/src/ui/**/*.{ts,tsx,html}"],
	theme: {
		extend: {
			fontFamily: {
				sans: [
					"-apple-system",
					"BlinkMacSystemFont",
					"SF Pro Text",
					"system-ui",
					"Segoe UI",
					"sans-serif",
				],
				mono: [
					"SF Mono",
					"Menlo",
					"Monaco",
					"Consolas",
					"monospace",
				],
			},
			colors: {
				surface: {
					0: "var(--surface-0)",
					1: "var(--surface-1)",
					2: "var(--surface-2)",
					3: "var(--surface-3)",
					border: "var(--surface-border)",
				},
				accent: {
					DEFAULT: "var(--accent)",
					soft: "var(--accent-soft)",
				},
				state: {
					running: "var(--state-running)",
					review: "var(--state-review)",
					error: "var(--state-error)",
					applied: "var(--state-applied)",
				},
			},
			fontSize: {
				"2xs": ["0.6875rem", "1rem"],
			},
		},
	},
	plugins: [],
};
