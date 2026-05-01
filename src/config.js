import path from "node:path";
import dotenv from "dotenv";
import {
  DEFAULT_BLACKLIST_WORDS,
  DEFAULT_REQUEST_WORDS
} from "./parser/patterns.js";
import { readJsonFile } from "./utils/file.js";
import { secondsToMs } from "./utils/time.js";

dotenv.config({
  path: path.resolve(process.cwd(), ".env")
});

export async function loadConfig() {
  const dataDir = resolveFromCwd(process.env.DATA_DIR || "./data");
  const exportDir = resolveFromCwd(process.env.EXPORT_DIR || "./exports");
  const logDir = resolveFromCwd(process.env.LOG_DIR || "./logs");
  const targetUsername = normalizeUsername(process.env.TIKTOK_USERNAME);

  if (!targetUsername || targetUsername === "target_username") {
    throw new Error("TIKTOK_USERNAME 未設定。請複製 .env.example 為 .env，並填入公開 LIVE 帳號。");
  }

  const requestWords = await readJsonFile(
    path.resolve(process.cwd(), "config/requestWords.json"),
    DEFAULT_REQUEST_WORDS
  );
  const blacklistWords = await readJsonFile(
    path.resolve(process.cwd(), "config/blacklistWords.json"),
    DEFAULT_BLACKLIST_WORDS
  );
  const songAliases = await readJsonFile(
    path.resolve(process.cwd(), "config/songAliases.json"),
    {}
  );
  const songCatalog = await readJsonFile(
    path.resolve(process.cwd(), "config/songCatalog.json"),
    []
  );

  return {
    targetUsername,
    reconnectDelayMs: secondsToMs(readPositiveNumber("RECONNECT_DELAY_SECONDS", 10)),
    saveIntervalMs: secondsToMs(readPositiveNumber("SAVE_INTERVAL_SECONDS", 30)),
    exportIntervalMs: secondsToMs(readPositiveNumber("EXPORT_INTERVAL_SECONDS", 60)),
    dataDir,
    exportDir,
    logDir,
    enableRawMessageLog: readBoolean("ENABLE_RAW_MESSAGE_LOG", true),
    enableMessageClassificationLog: readBoolean("ENABLE_MESSAGE_CLASSIFICATION_LOG", true),
    enableChatMessageLog: readBoolean("ENABLE_CHAT_MESSAGE_LOG", false),
    enableJsonExport: readBoolean("ENABLE_JSON_EXPORT", true),
    enableCsvExport: readBoolean("ENABLE_CSV_EXPORT", true),
    minShortSongLength: readPositiveNumber("MIN_SHORT_SONG_LENGTH", 2),
    maxShortSongLength: readPositiveNumber("MAX_SHORT_SONG_LENGTH", 8),
    minExplicitSongLength: readPositiveNumber("MIN_EXPLICIT_SONG_LENGTH", 2),
    maxExplicitSongLength: readPositiveNumber("MAX_EXPLICIT_SONG_LENGTH", 30),
    maxExamplesPerSong: readPositiveNumber("MAX_EXAMPLES_PER_SONG", 5),
    requireCatalogForShortCandidates: readBoolean("REQUIRE_CATALOG_FOR_SHORT_CANDIDATES", true),
    countUnknownExplicitRequests: readBoolean("COUNT_UNKNOWN_EXPLICIT_REQUESTS", true),
    saveUncertainCandidates: readBoolean("SAVE_UNCERTAIN_CANDIDATES", true),
    requestWords: Array.isArray(requestWords) ? requestWords : DEFAULT_REQUEST_WORDS,
    blacklistWords: Array.isArray(blacklistWords) ? blacklistWords : DEFAULT_BLACKLIST_WORDS,
    songAliases: isPlainObject(songAliases) ? songAliases : {},
    songCatalog: Array.isArray(songCatalog) ? songCatalog : []
  };
}

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "");
}

function resolveFromCwd(value) {
  return path.resolve(process.cwd(), value);
}

function readBoolean(key, fallback) {
  const value = process.env[key];
  if (value === undefined) {
    return fallback;
  }
  return ["1", "true", "yes", "y", "on"].includes(value.trim().toLowerCase());
}

function readPositiveNumber(key, fallback) {
  const value = Number(process.env[key] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
