import { codeToHtml } from "shiki";

const cache = new Map<string, Promise<string>>();

export function highlightCode(code: string, language: string) {
	const key = `${language}:${code}`;
	if (!cache.has(key)) {
		cache.set(
			key,
			codeToHtml(code, {
				lang: language || "text",
				theme: "github-light-default",
			}),
		);
	}
	return cache.get(key)!;
}
