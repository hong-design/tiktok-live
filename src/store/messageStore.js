import path from "node:path";
import { appendJsonLine, ensureDir } from "../utils/file.js";

export class MessageStore {
  constructor(options) {
    this.filePath = options.filePath;
    this.enabled = options.enabled;
    this.logger = options.logger;
    this.writeQueue = Promise.resolve();
  }

  async prepare() {
    await ensureDir(path.dirname(this.filePath));
  }

  append(record) {
    if (!this.enabled) {
      return Promise.resolve();
    }

    this.writeQueue = this.writeQueue
      .then(() => appendJsonLine(this.filePath, record))
      .catch((error) => {
        this.logger.error("原始留言 JSONL 寫入失敗", error, {
          filePath: path.relative(process.cwd(), this.filePath)
        });
      });

    return this.writeQueue;
  }

  async flush() {
    await this.writeQueue;
  }
}
