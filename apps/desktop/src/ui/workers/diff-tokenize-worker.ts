import { tokenize } from "react-diff-view";
import type { HunkData } from "react-diff-view";
import { refractorCompat } from "@ui/lib/refractor-compat";

type TokenizeRequest = {
	jobId: number;
	language?: string;
	hunks: HunkData[];
};

type TokenizeSuccess = {
	jobId: number;
	success: true;
	tokens: ReturnType<typeof tokenize> | null;
};

type TokenizeFailure = {
	jobId: number;
	success: false;
	error: string;
};

function respond(message: TokenizeSuccess | TokenizeFailure) {
	self.postMessage(message);
}

self.addEventListener("message", (event: MessageEvent<TokenizeRequest>) => {
	const { jobId, language, hunks } = event.data;
	if (!language || !refractorCompat.registered(language)) {
		respond({ jobId, success: true, tokens: null });
		return;
	}
	try {
		const tokens = tokenize(hunks, {
			highlight: true,
			refractor: refractorCompat,
			language,
		});
		respond({ jobId, success: true, tokens });
	} catch (error) {
		respond({
			jobId,
			success: false,
			error: error instanceof Error ? error.message : "Tokenization failed",
		});
	}
});
