import { render } from "@solidjs/web";
import App from "./App";
import { traceRendererBoot, watchRendererShell } from "./boot-trace";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("The #root element is missing from index.html.");
}

watchRendererShell();
render(() => <App />, root);
traceRendererBoot("renderer-mounted");
