import fs from "node:fs";
import { createInterface } from "node:readline";
import { fileExists } from "../utils/file.js";

export async function rebuildSongsFromMessages(options) {
  const { messageFilePath, songStore, logger } = options;

  if (await fileExists(songStore.filePath)) {
    return false;
  }

  if (!(await fileExists(messageFilePath))) {
    return false;
  }

  const input = fs.createReadStream(messageFilePath, { encoding: "utf8" });
  const lines = createInterface({
    input,
    crlfDelay: Infinity
  });

  let rebuiltCount = 0;

  for await (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    try {
      const message = JSON.parse(line);
      if (!message.isSongRequest || !message.normalizedSong) {
        continue;
      }

      songStore.increment(
        {
          song: message.detectedSong || message.normalizedSong,
          normalizedSong: message.normalizedSong
        },
        message.comment,
        message.timestamp
      );
      rebuiltCount += 1;
    } catch (error) {
      logger.warn("重建歌曲統計時略過無法解析的 messages.jsonl 行", {
        error: error.message
      });
    }
  }

  if (rebuiltCount > 0) {
    await songStore.save();
    logger.info("已從 messages.jsonl 重建歌曲統計", {
      rebuiltCount
    });
    return true;
  }

  return false;
}
