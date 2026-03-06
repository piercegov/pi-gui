/** @type {import('tailwindcss').Config} */
export default {
	content: ["./apps/desktop/src/ui/**/*.{ts,tsx,html}"],
	theme: {
		extend: {
			fontFamily: {
				sans: ["'IBM Plex Sans'", "ui-sans-serif", "system-ui"],
				mono: ["'IBM Plex Mono'", "ui-monospace", "monospace"],
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
			boxShadow: {
				panel: "0 16px 40px rgba(7, 16, 28, 0.12)",
			},
		},
	},
	plugins: [],
};
