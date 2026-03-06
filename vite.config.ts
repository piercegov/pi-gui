import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
	plugins: [react()],
	root: "apps/desktop/src/ui",
	resolve: {
		alias: {
			"@bun": resolve(__dirname, "apps/desktop/src/bun"),
			"@shared": resolve(__dirname, "apps/desktop/src/shared"),
			"@ui": resolve(__dirname, "apps/desktop/src/ui"),
		},
	},
	build: {
		outDir: "../../dist",
		emptyOutDir: true,
	},
	server: {
		port: 5173,
		strictPort: true,
	},
});
