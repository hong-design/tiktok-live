import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createDashboardServer({ port, songStore, candidateStore, logger }) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      if (url.pathname === "/api/songs") {
        const songs = songStore.getSortedSongs();
        const total = songs.reduce((s, x) => s + (x.count ?? 0), 0);
        json(res, { songs, totalRequests: total, generatedAt: new Date().toISOString() });
        return;
      }

      if (url.pathname === "/api/candidates") {
        json(res, candidateStore.getAll());
        return;
      }

      if (url.pathname === "/api/candidates/accept" && req.method === "POST") {
        const { id } = await readJson(req);
        const accepted = candidateStore.accept(id, songStore);
        json(res, { ok: Boolean(accepted), song: accepted?.candidateSong ?? null });
        return;
      }

      if (url.pathname === "/api/candidates/reject" && req.method === "POST") {
        const { id } = await readJson(req);
        candidateStore.reject(id);
        json(res, { ok: true });
        return;
      }

      if (url.pathname === "/" || url.pathname === "/index.html") {
        const html = await fs.readFile(path.join(__dirname, "index.html"), "utf8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    } catch (error) {
      logger.error("Dashboard 請求處理失敗", error);
      res.writeHead(500);
      res.end("Internal error");
    }
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      logger.info(`Dashboard 已啟動: http://localhost:${port}`);
      resolve(server);
    });
    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        logger.warn(`Dashboard port ${port} 已被占用，跳過啟動`);
        resolve(null);
      } else {
        logger.error("Dashboard 啟動失敗", err);
        resolve(null);
      }
    });
  });
}

function json(res, data) {
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache"
  });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}
