import path from "node:path";
import { readJsonFile, writeJsonFileAtomic } from "../utils/file.js";
import { nowIso } from "../utils/time.js";

const STATE_VERSION = 1;

export class StateStore {
  constructor(options) {
    this.filePath = options.filePath;
    this.targetUsername = options.targetUsername;
    this.logger = options.logger;
    this.state = createInitialState(this.targetUsername);
  }

  async load() {
    const savedState = await readJsonFile(this.filePath, null);

    if (isUsableState(savedState, this.targetUsername)) {
      this.state = {
        ...createInitialState(this.targetUsername),
        ...savedState,
        version: STATE_VERSION,
        targetUsername: this.targetUsername,
        totalRuns: Number(savedState.totalRuns || 0) + 1,
        lastStartedAt: nowIso()
      };
      return;
    }

    this.state = {
      ...createInitialState(this.targetUsername),
      totalRuns: 1,
      lastStartedAt: nowIso()
    };
  }

  recordConnectionStatus(isConnected, timestamp = nowIso()) {
    this.state.connected = Boolean(isConnected);
    if (isConnected) {
      this.state.lastConnectedAt = timestamp;
      return;
    }
    this.state.lastDisconnectedAt = timestamp;
  }

  recordMessage(isSongRequest, timestamp = nowIso()) {
    this.state.receivedMessages += 1;
    this.state.lastMessageAt = timestamp;
    if (isSongRequest) {
      this.state.detectedRequests += 1;
    }
  }

  reconcileDetectedRequests(totalRequests) {
    const safeTotal = Number(totalRequests) || 0;
    if (safeTotal > this.state.detectedRequests) {
      this.state.detectedRequests = safeTotal;
    }
  }

  markSaved(timestamp = nowIso()) {
    this.state.lastSavedAt = timestamp;
  }

  markExported(timestamp = nowIso()) {
    this.state.lastExportedAt = timestamp;
  }

  getSnapshot() {
    return { ...this.state };
  }

  async save() {
    try {
      await writeJsonFileAtomic(this.filePath, this.state);
    } catch (error) {
      this.logger.error("執行狀態寫入失敗", error, {
        filePath: path.relative(process.cwd(), this.filePath)
      });
      throw error;
    }
  }
}

function createInitialState(targetUsername) {
  const timestamp = nowIso();

  return {
    version: STATE_VERSION,
    targetUsername,
    createdAt: timestamp,
    lastStartedAt: timestamp,
    lastConnectedAt: null,
    lastDisconnectedAt: null,
    lastMessageAt: null,
    lastSavedAt: null,
    lastExportedAt: null,
    connected: false,
    receivedMessages: 0,
    detectedRequests: 0,
    totalRuns: 0
  };
}

function isUsableState(value, targetUsername) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.targetUsername === targetUsername
  );
}
