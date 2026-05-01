import path from "node:path";
import { appendJsonLine, ensureDir } from "./utils/file.js";
import { nowIso } from "./utils/time.js";

export function createLogger(config) {
  const errorLogPath = path.join(config.logDir, "error.log");

  async function writeErrorLog(level, message, error, meta = {}) {
    try {
      await ensureDir(config.logDir);
      await appendJsonLine(errorLogPath, {
        timestamp: nowIso(),
        level,
        message,
        error: serializeError(error),
        meta
      });
    } catch (logError) {
      console.error("[logger] 無法寫入 error.log:", logError.message);
    }
  }

  return {
    info(message, meta = {}) {
      console.log(`[INFO] ${message}`, formatMeta(meta));
    },
    warn(message, meta = {}) {
      console.warn(`[WARN] ${message}`, formatMeta(meta));
      void writeErrorLog("warn", message, null, meta);
    },
    error(message, error, meta = {}) {
      console.error(`[ERROR] ${message}`, error?.message || error || "", formatMeta(meta));
      void writeErrorLog("error", message, error, meta);
    },
    async errorAndWait(message, error, meta = {}) {
      console.error(`[ERROR] ${message}`, error?.message || error || "", formatMeta(meta));
      await writeErrorLog("error", message, error, meta);
    }
  };
}

function serializeError(error) {
  if (!error) {
    return null;
  }

  return {
    name: error.name,
    message: error.message,
    stack: error.stack
  };
}

function formatMeta(meta) {
  if (!meta || Object.keys(meta).length === 0) {
    return "";
  }
  return JSON.stringify(meta);
}
