import { performance } from "node:perf_hooks";
import { createSongParser } from "../src/parser/songParser.js";

const SONG_COUNT = 5000;
const MESSAGE_COUNT = 10000;

const fixedSongs = [
  "晴天",
  "跳樓機",
  "生日快樂",
  "稻香",
  "告白氣球",
  "夜空中最亮的星",
  "給我一首歌的時間"
];

const songCatalog = [
  ...fixedSongs,
  ...Array.from({ length: SONG_COUNT - fixedSongs.length }, (_, index) => `測試歌名${index + 1}`)
];

const parser = createSongParser({
  songCatalog,
  songAliases: {
    "告白汽球": "告白氣球",
    "happy birthday": "生日快樂"
  },
  requireCatalogForShortCandidates: true,
  countUnknownExplicitRequests: true,
  minShortSongLength: 2,
  maxShortSongLength: 8,
  minExplicitSongLength: 2,
  maxExplicitSongLength: 30
});

const messages = Array.from({ length: MESSAGE_COUNT }, (_, index) => {
  if (index % 10 === 0) return "晴天";
  if (index % 10 === 1) return "想聽稻香";
  if (index % 10 === 2) return "可以唱一下生日快樂這首嗎";
  if (index % 10 === 3) return `測試歌名${(index % (SONG_COUNT - fixedSongs.length)) + 1}`;
  if (index % 10 === 4) return `可以唱測試歌名${(index % (SONG_COUNT - fixedSongs.length)) + 1}嗎`;
  if (index % 10 === 5) return "晴天好好聽";
  if (index % 10 === 6) return "主播加油";
  if (index % 10 === 7) return "吃飯了";
  if (index % 10 === 8) return "未知歌名";
  return "哈哈笑死";
});

const startedAt = performance.now();
let songRequests = 0;
let uncertainCandidates = 0;

for (const message of messages) {
  const result = parser(message);
  if (result.isSongRequest) {
    songRequests += 1;
  } else if (result.candidateSong) {
    uncertainCandidates += 1;
  }
}

const elapsedMs = performance.now() - startedAt;
const averageMs = elapsedMs / MESSAGE_COUNT;

console.log(
  JSON.stringify(
    {
      catalogSongs: SONG_COUNT,
      messages: MESSAGE_COUNT,
      elapsedMs: Number(elapsedMs.toFixed(2)),
      averageMsPerMessage: Number(averageMs.toFixed(4)),
      messagesPerSecond: Math.round(MESSAGE_COUNT / (elapsedMs / 1000)),
      songRequests,
      uncertainCandidates
    },
    null,
    2
  )
);
