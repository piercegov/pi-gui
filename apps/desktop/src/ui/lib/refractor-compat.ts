import { refractor } from "refractor";

export const refractorCompat = {
	highlight(code: string, language: string) {
		const highlighted = refractor.highlight(code, language);
		return Array.isArray(highlighted) ? highlighted : (highlighted.children ?? []);
	},
	registered(language: string) {
		return refractor.registered(language);
	},
};
