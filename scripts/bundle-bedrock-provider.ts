/**
 * Pre-bundles the amazon-bedrock provider module as a standalone file.
 *
 * The pi-ai SDK lazy-loads this module via `import("./amazon-bedrock.js")` at runtime,
 * which defeats static bundler analysis. Electrobun's Bun.build produces a single index.js
 * and the relative import fails because the file doesn't exist next to it.
 *
 * This script bundles amazon-bedrock.js (and its @aws-sdk deps) into a self-contained file
 * that gets copied into the app bundle next to index.js.
 */
const result = await Bun.build({
	entrypoints: [
		"node_modules/@mariozechner/pi-ai/dist/providers/amazon-bedrock.js",
	],
	outdir: "build/lazy-providers",
	target: "bun",
	format: "esm",
	naming: "amazon-bedrock.js",
});

if (!result.success) {
	console.error("Failed to bundle amazon-bedrock provider:", result.logs);
	process.exit(1);
}

console.log(
	`Bundled amazon-bedrock.js (${(result.outputs[0].size / 1024).toFixed(0)} KB)`,
);
