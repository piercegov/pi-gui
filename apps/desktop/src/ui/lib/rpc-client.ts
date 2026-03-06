import { Electroview } from "electrobun/view";
import type { AppRpcSchema } from "@shared/rpc-schema";

const RPC_REQUEST_TIMEOUT_MS = 15 * 60 * 1000;

export const rpc = Electroview.defineRPC<AppRpcSchema>({
	maxRequestTime: RPC_REQUEST_TIMEOUT_MS,
	handlers: {
		requests: {},
		messages: {},
	},
});

let initialized = false;

export function initializeRpc() {
	if (initialized) return;
	initialized = true;
	new Electroview({ rpc });
}
