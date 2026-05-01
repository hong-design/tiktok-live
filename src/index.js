import path from "node:path";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { exportMessagesCsv, exportSongsCsv } from "./exporter/csvExporter.js";
import { exportSongsJson } from "./exporter/jsonExporter.js";
import { createSongParser } from "./parser/songParser.js";
import { MessageStore } from "./store/messageStore.js";
import { SongStore } from "./store/songStore.js";
import { TikTokClient } from "./tiktokClient.js";
import { ensureDir } from "./utils/file.js";
import { nowIso } from "./utils/time.js";

let shuttingDown = false;

async function main() {
  const config = await loadConfig();
  await Promise.all([
    ensureDir(config.dataDir),
    ensureDir(config.exportDir),
    ensureDir(config.logDir)
  ]);

  const logger = createLogger(config);
  const parseSongRequest = createSongParser(config);
  const songStore = new SongStore({
    filePath: path.join(config.dataDir, "songs.json"),
    maxExamplesPerSong: config.maxExamplesPerSong,
    logger
  });
  const messageStore = new MessageStore({
    filePath: path.join(config.dataDir, "messages.jsonl"),
    enabled: config.enableRawMessageLog,
    logger
  });

  await songStore.load();
  await messageStore.prepare();

  const runtime = {
    connected: false,
    receivedMessages: 0,
    detectedRequests: 0,
    lastStatusAt: 0
  };

  logger.info(`目前連線帳號: @${config.targetUsername}`);
  printStatus(runtime, songStore, config, true);

  async function handleChat(message) {
    try {
      const timestamp = nowIso();
      const parsed = parseSongRequest(message.comment);
      const messageType = parsed.isSongRequest ? "song_request" : "chat";

      runtime.receivedMessages += 1;
      if (parsed.isSongRequest) {
        runtime.detectedRequests += 1;
        songStore.increment(parsed, message.comment, timestamp);
      }

      if (shouldSaveMessageRecord(parsed, config)) {
        await messageStore.append({
          timestamp,
          uniqueId: message.uniqueId,
          nickname: message.nickname,
          comment: message.comment,
          messageType,
          isSongRequest: parsed.isSongRequest,
          detectedSong: parsed.song,
          normalizedSong: parsed.normalizedSong,
          confidence: parsed.confidence,
          reason: parsed.reason
        });
      }

      printMessageClassification(message, parsed, messageType, config);
      printStatus(runtime, songStore, config);
    } catch (error) {
      logger.error("單筆留言處理失敗，已略過該留言", error);
    }
  }

  const client = new TikTokClient({
    username: config.targetUsername,
    reconnectDelayMs: config.reconnectDelayMs,
    logger,
    onChat: handleChat,
    onStatus(status) {
      runtime.connected = Boolean(status.connected);
      printStatus(runtime, songStore, config, true);
    }
  });

  async function saveAll() {
    await messageStore.flush();
    await songStore.save();
  }

  async function exportAll() {
    const songs = songStore.getSortedSongs();
    const exportedFiles = [];

    if (config.enableJsonExport) {
      exportedFiles.push(
        await exportSongsJson({
          songs,
          outputFile: path.join(config.exportDir, "songs.json"),
          targetUsername: config.targetUsername
        })
      );
    }

    if (config.enableCsvExport) {
      exportedFiles.push(
        await exportSongsCsv({
          songs,
          outputFile: path.join(config.exportDir, "songs.csv")
        })
      );
      exportedFiles.push(
        await exportMessagesCsv({
          messageFile: path.join(config.dataDir, "messages.jsonl"),
          outputFile: path.join(config.exportDir, "messages.csv"),
          logger
        })
      );
    }

    if (exportedFiles.length > 0) {
      logger.info("已匯出報表", {
        files: exportedFiles.map((filePath) => path.relative(process.cwd(), filePath))
      });
    }
  }

  const saveTimer = setInterval(() => {
    saveAll().catch((error) => logger.error("定期保存失敗", error));
  }, config.saveIntervalMs);

  const exportTimer = setInterval(() => {
    exportAll().catch((error) => logger.error("定期匯出失敗", error));
  }, config.exportIntervalMs);

  async function shutdown(signal) {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.info(`收到 ${signal}，開始安全保存與最後匯出`);
    clearInterval(saveTimer);
    clearInterval(exportTimer);
    await client.stop();
    await saveAll();
    await exportAll();
    logger.info("已完成安全關閉");
    process.exit(0);
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("unhandledRejection", (error) => {
    logger.error("未處理的 Promise rejection", error);
  });
  process.on("uncaughtException", (error) => {
    logger.error("未捕捉例外", error);
  });

  client.start();
}

function shouldSaveMessageRecord(parsed, config) {
  if (!config.enableRawMessageLog) {
    return false;
  }

  return parsed.isSongRequest || config.enableChatMessageLog;
}

function printMessageClassification(message, parsed, messageType, config) {
  if (!config.enableMessageClassificationLog) {
    return;
  }

  const user = message.uniqueId ? `@${message.uniqueId}` : "unknown";

  if (messageType === "song_request") {
    console.log(
      `[點歌][${parsed.confidence}] ${user}: ${message.comment} => ${parsed.normalizedSong}`
    );
    return;
  }

  console.log(`[聊天] ${user}: ${message.comment} (${parsed.reason})`);
}

function printStatus(runtime, songStore, config, force = false) {
  const now = Date.now();
  if (!force && now - runtime.lastStatusAt < 5000) {
    return;
  }

  runtime.lastStatusAt = now;
  const topSongs = songStore
    .getTopSongs(5)
    .map((song, index) => `${index + 1}.${song.song}(${song.count})`)
    .join(" | ");

  console.log(
    [
      `[狀態] @${config.targetUsername}`,
      `連線=${runtime.connected ? "成功" : "未連線"}`,
      `收到留言=${runtime.receivedMessages}`,
      `偵測點歌=${runtime.detectedRequests}`,
      `Top5=${topSongs || "尚無"}`
    ].join(" ")
  );
}

main().catch((error) => {
  console.error("[FATAL] 啟動失敗:", error.message);
  process.exit(1);
});
