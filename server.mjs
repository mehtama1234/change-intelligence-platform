import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const port = Number(process.env.PORT ?? 8780);
const packetPath = resolve(root, "data/processed/ai-work-control.packet.json");
const reviewPath = resolve(root, "data/processed/runs/ai-work-control/latest-review-work.json");
const historyPath = resolve(root, "data/processed/runs/ai-work-control/versioned-evidence-ledger.json");
const refreshPath = resolve(root, "data/processed/runs/ai-work-control/latest-refresh.json");
const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

const json = (response, status, body) => {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
};

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    if (request.method !== "GET") return json(response, 405, { error: "Only GET is supported by this read model." });
    if (url.pathname === "/api/health") return json(response, 200, { status: "ok", service: "change-intelligence-read-model", generatedAt: new Date().toISOString() });
    if (url.pathname === "/api/packet") return json(response, 200, await readJson(packetPath, { error: "Packet has not been built." }));
    if (url.pathname === "/api/review-work") return json(response, 200, await readJson(reviewPath, { schemaVersion: "source-review-work-v1", reviewRequired: 0, candidates: [] }));
    if (url.pathname === "/api/evidence-history") return json(response, 200, await readJson(historyPath, { schemaVersion: "versioned-evidence-ledger-v1", records: [], decisionHistory: [] }));
    if (url.pathname === "/api/refresh") return json(response, 200, await readJson(refreshPath, { schemaVersion: "refresh-receipt-v1", status: "not_run", steps: [] }));
    if (url.pathname === "/") {
      response.writeHead(302, { Location: "/web/index.html" });
      return response.end();
    }
    if (url.pathname.startsWith("/web/")) {
      const relative = normalize(url.pathname.slice(1));
      if (relative.includes("..")) return json(response, 400, { error: "Invalid path." });
      const path = resolve(root, relative);
      const body = await readFile(path);
      response.writeHead(200, { "Content-Type": contentTypes[relative.slice(relative.lastIndexOf("."))] ?? "application/octet-stream" });
      return response.end(body);
    }
    return json(response, 404, { error: "Not found." });
  } catch (error) {
    return json(response, error.code === "ENOENT" ? 404 : 500, { error: error.message });
  }
});

server.listen(port, () => console.log(`Change intelligence read model listening on http://127.0.0.1:${port}`));
