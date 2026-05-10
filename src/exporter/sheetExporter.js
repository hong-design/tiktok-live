import fs from "node:fs/promises";
import path from "node:path";
import { toCsvRow } from "../utils/csvEscape.js";
import { ensureDir } from "../utils/file.js";

export async function exportSongSheetCsv(options) {
  const outputFile = options.outputFile;
  const songs = Array.isArray(options.songs) ? options.songs : [];
  const topLimit = Math.max(1, Math.floor(Number(options.topLimit ?? 30)));
  await ensureDir(path.dirname(outputFile));

  const allRequestedSongs = [...songs].sort(compareByFirstSeen);
  const mostRequestedSongs = [...songs]
    .filter((song) => Number(song.count) > 1)
    .sort(compareByCountThenFirstSeen)
    .slice(0, topLimit);
  const visibleTopSongs =
    mostRequestedSongs.length > 0
      ? mostRequestedSongs
      : [...songs].sort(compareByCountThenFirstSeen).slice(0, topLimit);
  const rowCount = Math.max(allRequestedSongs.length, visibleTopSongs.length);
  const rows = [
    toCsvRow(["整場直播有人點", "", "", "最多人點", "", ""]),
    toCsvRow(["序號", "歌名", "點歌次數", "排名", "歌名", "點歌次數"])
  ];

  for (let index = 0; index < rowCount; index += 1) {
    const allSong = allRequestedSongs[index];
    const topSong = visibleTopSongs[index];
    rows.push(
      toCsvRow([
        allSong ? index + 1 : "",
        allSong?.song || "",
        allSong?.count || "",
        topSong ? index + 1 : "",
        topSong?.song || "",
        topSong?.count || ""
      ])
    );
  }

  await fs.writeFile(outputFile, `\uFEFF${rows.join("\n")}\n`, "utf8");
  return outputFile;
}

function compareByFirstSeen(a, b) {
  const firstSeenCompare = String(a.firstSeenAt || "").localeCompare(String(b.firstSeenAt || ""));
  if (firstSeenCompare !== 0) {
    return firstSeenCompare;
  }
  return String(a.song || "").localeCompare(String(b.song || ""));
}

function compareByCountThenFirstSeen(a, b) {
  const countCompare = Number(b.count || 0) - Number(a.count || 0);
  if (countCompare !== 0) {
    return countCompare;
  }
  return compareByFirstSeen(a, b);
}
