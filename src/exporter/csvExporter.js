import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { ensureDir } from "../utils/file.js";
import { toCsvRow } from "../utils/csvEscape.js";

export async function exportSongsCsv(options) {
  const outputFile = options.outputFile;
  await ensureDir(path.dirname(outputFile));

  const rows = [
    toCsvRow(["rank", "song", "normalizedSong", "count", "firstSeenAt", "lastSeenAt", "examples"])
  ];

  options.songs.forEach((song, index) => {
    rows.push(
      toCsvRow([
        index + 1,
        song.song,
        song.normalizedSong,
        song.count,
        song.firstSeenAt,
        song.lastSeenAt,
        song.examples.join(" | ")
      ])
    );
  });

  await fs.promises.writeFile(outputFile, `${rows.join("\n")}\n`, "utf8");
  return outputFile;
}

export async function exportMessagesCsv(options) {
  const outputFile = options.outputFile;
  await ensureDir(path.dirname(outputFile));

  const output = fs.createWriteStream(outputFile, { encoding: "utf8" });
  output.write(
    `${toCsvRow([
      "timestamp",
      "uniqueId",
      "nickname",
      "comment",
      "messageType",
      "isSongRequest",
      "detectedSong",
      "normalizedSong",
      "confidence",
      "reason"
    ])}\n`
  );

  if (!fs.existsSync(options.messageFile)) {
    output.end();
    await waitForStream(output);
    return outputFile;
  }

  const input = fs.createReadStream(options.messageFile, { encoding: "utf8" });
  const lines = createInterface({
    input,
    crlfDelay: Infinity
  });

  for await (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    try {
      const message = JSON.parse(line);
      const messageType =
        message.messageType || (message.isSongRequest ? "song_request" : "chat");
      output.write(
        `${toCsvRow([
          message.timestamp,
          message.uniqueId,
          message.nickname,
          message.comment,
          messageType,
          message.isSongRequest,
          message.detectedSong,
          message.normalizedSong,
          message.confidence,
          message.reason
        ])}\n`
      );
    } catch (error) {
      options.logger?.warn("略過無法解析的 messages.jsonl 行", {
        error: error.message
      });
    }
  }

  output.end();
  await waitForStream(output);
  return outputFile;
}

function waitForStream(stream) {
  return new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
}
