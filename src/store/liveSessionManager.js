import fs from "node:fs/promises";
import path from "node:path";
import { exportMessagesCsv, exportSongsCsv } from "../exporter/csvExporter.js";
import { exportSongsJson } from "../exporter/jsonExporter.js";
import { exportSongSheetCsv } from "../exporter/sheetExporter.js";
import { MessageStore } from "./messageStore.js";
import { SongStore } from "./songStore.js";
import { ensureDir } from "../utils/file.js";
import { nowIso } from "../utils/time.js";

export class LiveSessionManager {
  constructor(options) {
    this.config = options.config;
    this.logger = options.logger;
    this.currentSession = null;
  }

  async startSession(connectionState) {
    const roomId = String(connectionState?.roomId || "unknown");

    if (this.currentSession?.roomId === roomId) {
      return this.currentSession;
    }

    const sessionId = createSessionId({
      roomId,
      targetUsername: this.config.targetUsername
    });
    const dataDir = path.join(this.config.dataDir, "sessions", sessionId);
    const exportDir = path.join(this.config.exportDir, "sessions", sessionId);

    const session = {
      id: sessionId,
      label: sessionId,
      roomId,
      startedAt: nowIso(),
      dataDir,
      exportDir,
      messageStore: new MessageStore({
        filePath: path.join(dataDir, "messages.jsonl"),
        enabled: this.config.enableRawMessageLog,
        logger: this.logger
      }),
      fullTranscriptStore: new MessageStore({
        filePath: path.join(dataDir, "live-comments.jsonl"),
        enabled: this.config.enableFullTranscriptLog,
        logger: this.logger
      }),
      songStore: new SongStore({
        filePath: path.join(dataDir, "songs.json"),
        maxExamplesPerSong: this.config.maxExamplesPerSong,
        logger: this.logger
      })
    };

    await Promise.all([
      ensureDir(dataDir),
      ensureDir(exportDir),
      session.messageStore.prepare(),
      session.fullTranscriptStore.prepare(),
      session.songStore.load()
    ]);

    this.currentSession = session;
    await this.writeSessionMeta(session);
    await this.pruneOldSessions();

    this.logger.info("已建立直播場次紀錄", {
      sessionId,
      roomId,
      dataDir: path.relative(process.cwd(), dataDir),
      exportDir: path.relative(process.cwd(), exportDir)
    });

    return session;
  }

  getCurrentSession() {
    return this.currentSession;
  }

  appendMessage(record, shouldSaveAnalysisRecord) {
    const session = this.currentSession;
    if (!session) return;

    if (shouldSaveAnalysisRecord) {
      session.messageStore.append(record);
    }

    session.fullTranscriptStore.append(record);

    if (record.isSongRequest) {
      session.songStore.increment(
        { song: record.detectedSong, normalizedSong: record.normalizedSong },
        record.comment,
        record.timestamp
      );
    }
  }

  async saveCurrentSession() {
    const session = this.currentSession;
    if (!session) {
      return;
    }

    await session.messageStore.flush();
    await session.fullTranscriptStore.flush();
    await session.songStore.save();
    await this.writeSessionMeta(session);
  }

  async exportCurrentSession() {
    const session = this.currentSession;
    if (!session) {
      return [];
    }

    const exportedFiles = [];
    const songs = session.songStore.getSortedSongs();

    if (this.config.enableJsonExport) {
      exportedFiles.push(
        await exportSongsJson({
          songs,
          outputFile: path.join(session.exportDir, "songs.json"),
          targetUsername: this.config.targetUsername
        })
      );
      exportedFiles.push(
        await exportSongsJson({
          songs,
          outputFile: path.join(session.exportDir, `${session.label}_songs.json`),
          targetUsername: this.config.targetUsername
        })
      );
    }

    if (this.config.enableCsvExport) {
      exportedFiles.push(
        await exportSongsCsv({
          songs,
          outputFile: path.join(session.exportDir, "songs.csv")
        })
      );
      exportedFiles.push(
        await exportSongsCsv({
          songs,
          outputFile: path.join(session.exportDir, `${session.label}_songs.csv`)
        })
      );
      exportedFiles.push(
        await exportMessagesCsv({
          messageFile: path.join(session.dataDir, "messages.jsonl"),
          outputFile: path.join(session.exportDir, "messages.csv"),
          logger: this.logger
        })
      );
      exportedFiles.push(
        await exportMessagesCsv({
          messageFile: path.join(session.dataDir, "messages.jsonl"),
          outputFile: path.join(session.exportDir, `${session.label}_messages.csv`),
          logger: this.logger
        })
      );
      if (this.config.enableFullTranscriptLog) {
        exportedFiles.push(
          await exportMessagesCsv({
            messageFile: path.join(session.dataDir, "live-comments.jsonl"),
            outputFile: path.join(session.exportDir, "live-comments.csv"),
            logger: this.logger
          })
        );
        exportedFiles.push(
          await exportMessagesCsv({
            messageFile: path.join(session.dataDir, "live-comments.jsonl"),
            outputFile: path.join(session.exportDir, `${session.label}_live-comments.csv`),
            logger: this.logger
          })
        );
      }
    }

    if (this.config.enableSheetExport) {
      exportedFiles.push(
        await exportSongSheetCsv({
          songs,
          outputFile: path.join(session.exportDir, "song-sheet.csv"),
          topLimit: this.config.sheetTopLimit
        })
      );
      exportedFiles.push(
        await exportSongSheetCsv({
          songs,
          outputFile: path.join(session.exportDir, `${session.label}_song-sheet.csv`),
          topLimit: this.config.sheetTopLimit
        })
      );
    }

    return exportedFiles;
  }

  async writeSessionMeta(session) {
    const meta = {
      id: session.id,
      label: session.label,
      roomId: session.roomId,
      targetUsername: this.config.targetUsername,
      startedAt: session.startedAt,
      updatedAt: nowIso(),
      files: {
        messages: "messages.jsonl",
        liveComments: "live-comments.jsonl",
        songs: "songs.json",
        labeledExportsPrefix: session.label
      }
    };

    await fs.writeFile(path.join(session.dataDir, "session.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  }

  async pruneOldSessions() {
    await Promise.all([
      pruneDirectory(path.join(this.config.dataDir, "sessions"), this.config.retainLiveSessions),
      pruneDirectory(path.join(this.config.exportDir, "sessions"), this.config.retainLiveSessions)
    ]);
  }
}

async function pruneDirectory(parentDir, retainCount) {
  await ensureDir(parentDir);
  const entries = await fs.readdir(parentDir, { withFileTypes: true });
  const sessionDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const sessionId of sessionDirs.slice(retainCount)) {
    await fs.rm(path.join(parentDir, sessionId), { recursive: true, force: true });
  }
}

function createSessionId(options) {
  const timestamp = formatTimestampForFileName(new Date());
  const safeUsername = sanitizeFilePart(options.targetUsername || "unknown-user");
  const safeRoomId = sanitizeFilePart(options.roomId || "unknown-room");
  return `${timestamp}_${safeUsername}_${safeRoomId}`;
}

function formatTimestampForFileName(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-") + `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function sanitizeFilePart(value) {
  return String(value || "unknown")
    .trim()
    .replace(/^@+/, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "unknown";
}
