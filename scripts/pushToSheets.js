import { readFile } from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import { exportToGoogleSheets } from "../src/exporter/googleSheetsExporter.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const songsFile = path.resolve(process.cwd(), process.env.EXPORT_DIR || "./exports", "songs.json");

const raw = await readFile(songsFile, "utf8");
const data = JSON.parse(raw);
const songs = Array.isArray(data) ? data : data.songs ?? [];

const logger = {
  info: (msg, meta) => console.log(`[INFO] ${msg}`, meta ? JSON.stringify(meta) : ""),
  warn: (msg, meta) => console.warn(`[WARN] ${msg}`, meta ? JSON.stringify(meta) : ""),
  error: (msg, err) => console.error(`[ERROR] ${msg}`, err?.message || err || "")
};

console.log(`讀取到 ${songs.length} 首歌，開始同步至 Google 試算表...`);

await exportToGoogleSheets({
  songs,
  credentialsPath: process.env.GOOGLE_CREDENTIALS_PATH || "./credentials.json",
  sheetId: process.env.GOOGLE_SHEET_ID,
  topLimit: Number(process.env.SHEET_TOP_LIMIT) || 30,
  logger
});
