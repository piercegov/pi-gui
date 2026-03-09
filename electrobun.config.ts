import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "Pi GUI",
		identifier: "dev.piercegovernale.pi-gui",
		version: "0.1.0",
		description: "Desktop workflow for Pi coding sessions, diffs, and review rounds",
	},
	build: {
		bun: {
			entrypoint: "apps/desktop/src/bun/index.ts",
		},
		views: {},
		copy: {
			"apps/desktop/dist/index.html": "views/mainview/index.html",
			"apps/desktop/dist/assets": "views/mainview/assets",
			"build/lazy-providers/amazon-bedrock.js": "bun/amazon-bedrock.js",
		},
		watchIgnore: ["apps/desktop/dist/**"],
		mac: {
			bundleCEF: process.env.USE_CEF === "1",
		},
		linux: {
			bundleCEF: true,
		},
		win: {
			bundleCEF: false,
		},
	},
} satisfies ElectrobunConfig;
