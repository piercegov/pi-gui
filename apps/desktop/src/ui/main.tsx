import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { initializeRpc } from "./lib/rpc-client";
import { App } from "./app";
import { PerfProfiler } from "./components/shell/perf-overlay";

initializeRpc();

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<PerfProfiler id="App">
			<App />
		</PerfProfiler>
	</StrictMode>,
);
