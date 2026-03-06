import { codeToHtml } from "shiki";

const cache = new Map<string, Promise<string>>();
const resolved = new Map<string, string>();

export function highlightCode(code: string, language: string) {
	const key = `${language}:${code}`;
	if (!cache.has(key)) {
		const promise = codeToHtml(code, {
			lang: language || "text",
			theme: "github-dark-default",
		}).then((html) => {
			resolved.set(key, html);
			return html;
		});
		cache.set(key, promise);
	}
	return cache.get(key)!;
}

export function getHighlightedSync(code: string, language: string): string | null {
	return resolved.get(`${language}:${code}`) ?? null;
}
