import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir } from "../utils/file.js";

const MAX_BUFFER_SIZE = 200;
const FLUSH_INTERVAL_MS = 4000;

export class MessageStore {
  constructor(options) {
    this.filePath = options.filePath;
    this.enabled = options.enabled !== false;
    this.logger = options.logger;
    this._buffer = [];
    this._flushQueue = Promise.resolve();
    this._flushTimer = null;
  }

  setFilePath(filePath) {
    this.filePath = filePath;
  }

  async prepare() {
    await ensureDir(path.dirname(this.filePath));
    this._flushTimer = setInterval(() => this._scheduleFlush(), FLUSH_INTERVAL_MS);
    this._flushTimer.unref?.();
  }

  append(record) {
    if (!this.enabled) return;
    this._buffer.push(record);
    if (this._buffer.length >= MAX_BUFFER_SIZE) {
      this._scheduleFlush();
    }
  }

  async flush() {
    if (this._flushTimer) {
      clearInterval(this._flushTimer);
      this._flushTimer = null;
    }
    this._scheduleFlush();
    await this._flushQueue;
  }

  _scheduleFlush() {
    this._flushQueue = this._flushQueue
      .then(() => this._doFlush())
      .catch((error) => {
        this.logger?.error("MessageStore 寫入佇列異常", error);
      });
  }

  async _doFlush() {
    if (this._buffer.length === 0) return;
    const records = this._buffer.splice(0);
    try {
      await ensureDir(path.dirname(this.filePath));
      const lines = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
      await fs.appendFile(this.filePath, lines, "utf8");
    } catch (error) {
      this.logger?.error("JSONL 批次寫入失敗", error, {
        filePath: path.relative(process.cwd(), this.filePath),
        count: records.length
      });
      this._buffer.unshift(...records);
    }
  }
}
