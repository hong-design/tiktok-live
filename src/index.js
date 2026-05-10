import { exec } from "node:child_process";
import path from "node:path";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { exportMessagesCsv, exportSongsCsv } from "./exporter/csvExporter.js";
import { exportSongsJson } from "./exporter/jsonExporter.js";
import { exportSongSheetCsv } from "./exporter/sheetExporter.js";
import { exportToGoogleSheets } from "./exporter/googleSheetsExporter.js";
import { createSongParser } from "./parser/songParser.js";
import { LiveSessionManager } from "./store/liveSessionManager.js";
import { MessageStore } from "./store/messageStore.js";
import { SongStore } from "./store/songStore.js";
import { CandidateStore } from "./store/candidateStore.js";
import { createDashboardServer } from "./ui/server.js";
import { TikTokClient } from "./tiktokClient.js";
import { ensureDir } from "./utils/file.js";
import { nowIso } from "./utils/time.js";

let shuttingDown = false;

// 同一用戶同一首歌 60 秒內只計一次
const DEDUP_WINDOW_MS = 60_000;
const recentRequestCache = new Map();

setInterval(() => {
  const cutoff = Date.now() - DEDUP_WINDOW_MS;
  for (const [key, ts] of recentRequestCache) {
    if (ts < cutoff) recentRequestCache.delete(key);
  }
}, DEDUP_WINDOW_MS).unref?.();

function isDuplicateRequest(uniqueId, normalizedSong) {
  if (!uniqueId || !normalizedSong) return false;
  const last = recentRequestCache.get(`${uniqueId}:${normalizedSong}`);
  return last !== undefined && Date.now() - last < DEDUP_WINDOW_MS;
}

function markRequest(uniqueId, normalizedSong) {
  if (uniqueId && normalizedSong) {
    recentRequestCache.set(`${uniqueId}:${normalizedSong}`, Date.now());
  }
}

function openBrowser(url) {
  const cmd =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) console.warn("[WARN] 無法自動開啟瀏覽器:", err.message);
  });
}

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
  const candidateStore = new CandidateStore();
  const messageStore = new MessageStore({
    filePath: path.join(config.dataDir, "messages.jsonl"),
    enabled: config.enableRawMessageLog,
    logger
  });
  const fullTranscriptStore = new MessageStore({
    filePath: path.join(config.dataDir, "live-comments.jsonl"),
    enabled: config.enableFullTranscriptLog,
    logger
  });
  const liveSessionManager = new LiveSessionManager({ config, logger });

  await messageStore.prepare();
  await fullTranscriptStore.prepare();

  // Dashboard 整合進主程式（不需要另開終端機）
  let dashboardServer = null;
  if (config.enableDashboard) {
    dashboardServer = await createDashboardServer({
      port: config.dashboardPort,
      songStore,
      candidateStore,
      logger
    });
  }

  const runtime = {
    connected: false,
    receivedMessages: 0,
    detectedRequests: 0,
    uncertainCandidates: 0,
    lastStatusAt: 0
  };

  logger.info(`目前連線帳號: @${config.targetUsername}`);
  if (dashboardServer) {
    logger.info(`Dashboard: http://localhost:${config.dashboardPort}`);
  }
  printStatus(runtime, songStore, config, true);

  function handleChat(message) {
    try {
      const timestamp = nowIso();
      const parsed = parseSongRequest(message.comment);
      const messageType = parsed.isSongRequest
        ? "song_request"
        : parsed.candidateSong
          ? "uncertain_candidate"
          : "chat";

      runtime.receivedMessages += 1;

      if (parsed.isSongRequest) {
        const isDup = isDuplicateRequest(message.uniqueId, parsed.normalizedSong);
        if (!isDup) {
          runtime.detectedRequests += 1;
          songStore.increment(parsed, message.comment, timestamp);
          markRequest(message.uniqueId, parsed.normalizedSong);
        }
      }

      if (messageType === "uncertain_candidate" && parsed.candidateSong) {
        runtime.uncertainCandidates += 1;
        candidateStore.add({
          comment: message.comment,
          uniqueId: message.uniqueId,
          nickname: message.nickname,
          candidateSong: parsed.candidateSong,
          normalizedCandidate: parsed.normalizedCandidate,
          timestamp
        });
      }

      const record = {
        timestamp,
        uniqueId: message.uniqueId,
        nickname: message.nickname,
        comment: message.comment,
        messageType,
        isSongRequest: parsed.isSongRequest,
        detectedSong: parsed.song,
        normalizedSong: parsed.normalizedSong,
        confidence: parsed.confidence,
        reason: parsed.reason,
        candidateSong: parsed.candidateSong,
        normalizedCandidate: parsed.normalizedCandidate,
        isKnownSong: parsed.isKnownSong
      };
      const saveAnalysisRecord = shouldSaveMessageRecord(parsed, config);

      if (saveAnalysisRecord) messageStore.append(record);
      fullTranscriptStore.append(record);
      liveSessionManager.appendMessage(record, saveAnalysisRecord);

      printMessageClassification(message, parsed, messageType, config);
      printStatus(runtime, songStore, config);
    } catch (error) {
      logger.error("單筆留言處理失敗，已略過該留言", error);
    }
  }

  const client = new TikTokClient({
    username: config.targetUsername,
    reconnectDelayMs: config.reconnectDelayMs,
    waitForLive: config.waitForLive,
    livePollIntervalMs: config.livePollIntervalMs,
    logger,
    onChat: handleChat,
    onStatus(status) {
      runtime.connected = Boolean(status.connected);
      if (runtime.connected) {
        liveSessionManager
          .startSession(status.state)
          .catch((error) => logger.error("建立直播場次紀錄失敗", error));
      }
      printStatus(runtime, songStore, config, true);
    }
  });

  async function saveAll() {
    await messageStore.flush();
    await fullTranscriptStore.flush();
    await songStore.save();
    await liveSessionManager.saveCurrentSession();
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
      if (config.enableFullTranscriptLog) {
        exportedFiles.push(
          await exportMessagesCsv({
            messageFile: path.join(config.dataDir, "live-comments.jsonl"),
            outputFile: path.join(config.exportDir, "live-comments.csv"),
            logger
          })
        );
      }
    }

    if (config.enableSheetExport) {
      exportedFiles.push(
        await exportSongSheetCsv({
          songs,
          outputFile: path.join(config.exportDir, "song-sheet.csv"),
          topLimit: config.sheetTopLimit
        })
      );
    }

    if (config.enableGoogleSheets) {
      await exportToGoogleSheets({
        songs,
        credentialsPath: config.googleCredentialsPath,
        sheetId: config.googleSheetId,
        topLimit: config.sheetTopLimit,
        logger
      });
    }

    exportedFiles.push(...(await liveSessionManager.exportCurrentSession()));

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
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info(`收到 ${signal}，開始安全保存與最後匯出`);
    clearInterval(saveTimer);
    clearInterval(exportTimer);
    await client.stop();
    await saveAll();
    await exportAll();
    logger.info("已完成安全關閉");

    if (dashboardServer && config.openBrowserOnExit) {
      const url = `http://localhost:${config.dashboardPort}`;
      logger.info(`開啟瀏覽器查看結果: ${url}`);
      openBrowser(url);
      // 給瀏覽器一點時間連線後再關閉 server
      await new Promise((resolve) => setTimeout(resolve, 1800));
    }

    if (dashboardServer) {
      await new Promise((resolve) => dashboardServer.close(resolve));
    }

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
  if (!config.enableRawMessageLog) return false;
  return (
    parsed.isSongRequest ||
    (config.saveUncertainCandidates && parsed.candidateSong) ||
    config.enableChatMessageLog
  );
}

function printMessageClassification(message, parsed, messageType, config) {
  if (!config.enableMessageClassificationLog) return;
  const user = message.uniqueId ? `@${message.uniqueId}` : "unknown";
  if (messageType === "song_request") {
    console.log(`[點歌][${parsed.confidence}] ${user}: ${message.comment} => ${parsed.normalizedSong}`);
    return;
  }
  if (messageType === "uncertain_candidate") {
    console.log(`[候選][未計入] ${user}: ${message.comment} => ${parsed.normalizedCandidate} (${parsed.reason})`);
    return;
  }
  console.log(`[聊天] ${user}: ${message.comment} (${parsed.reason})`);
}

function printStatus(runtime, songStore, config, force = false) {
  const now = Date.now();
  if (!force && now - runtime.lastStatusAt < 5000) return;
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
      `候選未計入=${runtime.uncertainCandidates}`,
      `Top5=${topSongs || "尚無"}`
    ].join(" ")
  );
}

main().catch((error) => {
  console.error("[FATAL] 啟動失敗:", error.message);
  process.exit(1);
});
