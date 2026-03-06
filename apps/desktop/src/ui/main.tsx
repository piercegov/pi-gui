import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { initializeRpc } from "./lib/rpc-client";
import { App } from "./app";

initializeRpc();

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
