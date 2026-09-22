import { spawn } from "node:child_process";
import { createServer } from "./server.js";

const PORT = Number(process.env.PORT ?? 4600);

const app = createServer();
app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  plantance is running at ${url}\n`);
  openBrowser(url);
});

/** Best-effort open the local UI; harmless if it fails (headless etc.). */
function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
  } catch {
    /* user can open it manually */
  }
}
