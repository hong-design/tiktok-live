import assert from "node:assert/strict";
import test from "node:test";
import { createSongParser } from "../src/parser/songParser.js";

const parser = createSongParser({
  songCatalog: [
    "晴天",
    "跳樓機",
    "生日快樂",
    "稻香",
    "告白氣球",
    "泡沫",
    "我只在乎你",
    "夢一場",
    "一半一半",
    "海與你",
    "海嶼你",
    "苦茶籽",
    "如果可以",
    "溫柔"
  ],
  songAliases: {
    "生日快樂歌": "生日快樂",
    "happy birthday": "生日快樂",
    "告白汽球": "告白氣球",
    "海屿你": "海嶼你"
  },
  requireCatalogForShortCandidates: true,
  countUnknownExplicitRequests: true,
  minShortSongLength: 2,
  maxShortSongLength: 8,
  minExplicitSongLength: 2,
  maxExplicitSongLength: 30
});

const strictParser = createSongParser({
  songCatalog: ["晴天", "跳樓機", "生日快樂", "稻香", "告白氣球"],
  songAliases: {
    "告白汽球": "告白氣球"
  },
  requireCatalogForShortCandidates: true,
  countUnknownExplicitRequests: false,
  minShortSongLength: 2,
  maxShortSongLength: 8,
  minExplicitSongLength: 2,
  maxExplicitSongLength: 30
});

function classify(result) {
  if (result.isSongRequest) {
    return "song_request";
  }

  if (result.candidateSong || result.normalizedCandidate) {
    return "uncertain_candidate";
  }

  return "chat";
}

function detectedSong(result) {
  return result.song || result.candidateSong || "";
}

test("counts direct catalog song names", () => {
  assert.equal(parser("晴天").isSongRequest, true);
  assert.equal(parser("跳樓機").normalizedSong, "跳樓機");
});

test("counts explicit requests", () => {
  assert.equal(parser("可以唱生日快樂嗎").normalizedSong, "生日快樂");
  assert.equal(parser("想聽稻香").normalizedSong, "稻香");
  assert.equal(parser("播告白汽球").normalizedSong, "告白氣球");
});

test("uses catalog candidate matching only for explicit request text", () => {
  const result = parser("可以唱一下生日快樂這首嗎");
  assert.equal(result.isSongRequest, true);
  assert.equal(result.normalizedSong, "生日快樂");
  assert.equal(result.reason, "explicit_request_catalog_match:可以唱");
});

test("does not count common chat as songs", () => {
  for (const message of ["晴天好好聽", "哈哈笑死", "主播加油", "吃飯了", "好可愛", "你幾歲"]) {
    assert.equal(parser(message).isSongRequest, false, message);
  }
});

test("does not count invalid or negative requests", () => {
  for (const message of ["可以唱嗎", "可以不要唱晴天嗎", "我在聽你講話", "不要播跳樓機"]) {
    assert.equal(parser(message).isSongRequest, false, message);
  }
});

test("saves unknown short candidates as uncertain, not counted", () => {
  const result = parser("未知歌名");
  assert.equal(result.isSongRequest, false);
  assert.equal(result.reason, "short_candidate_not_in_catalog");
  assert.equal(result.normalizedCandidate, "未知歌名");
});

test("counts or rejects unknown explicit requests by configuration", () => {
  const looseResult = parser("可以唱未知歌名嗎");
  assert.equal(looseResult.isSongRequest, true);
  assert.equal(looseResult.normalizedSong, "未知歌名");
  assert.equal(looseResult.confidence, "medium");

  const strictResult = strictParser("可以唱未知歌名嗎");
  assert.equal(strictResult.isSongRequest, false);
  assert.equal(strictResult.reason, "explicit_candidate_not_in_catalog");
  assert.equal(strictResult.normalizedCandidate, "未知歌名");
});

test("classifies live chat song extraction cases", () => {
  const cases = [
    ["可以唱泡沫嗎", "song_request", "泡沫"],
    ["想聽我只在乎你", "song_request", "我只在乎你"],
    ["我要點夢一場", "song_request", "夢一場"],
    ["有稻香嗎", "song_request", "稻香"],
    ["一半一半有嗎", "song_request", "一半一半"],
    ["海與你有嗎", "song_request", "海與你"],
    ["海嶼你會嗎", "song_request", "海嶼你"],
    ["苦茶籽可以嗎", "song_request", "苦茶籽"],
    ["如果可以嗎", "song_request", "如果可以"],
    ["周杰倫的溫柔", "song_request", "溫柔"],
    ["聽說你", "uncertain_candidate", "聽說你"],
    ["有想聽的歌都可以留言，留一次就好，請勿刷屏", "chat", ""],
    ["點歌要 歌名 歌手 這樣比較好找", "chat", ""],
    ["建議大家點歌可以 歌名 歌手 如：晴天 周杰倫", "chat", ""],
    ["可以唱盧廣仲的嗎", "chat", ""],
    ["日文歌可以", "uncertain_candidate", "日文歌可以"],
    ["嗨", "chat", ""],
    ["我要點嗨！Happy Day", "song_request", "嗨！Happy Day"]
  ];

  for (const [message, expectedType, expectedSong] of cases) {
    const result = parser(message);
    assert.equal(classify(result), expectedType, message);
    assert.equal(detectedSong(result), expectedSong, message);
  }
});

test("correctly handles songs with negative words in title", () => {
  // 「不要說話」是 catalog 裡的歌，確保用點歌詞帶出時不被否定詞誤擋
  assert.equal(parser("播不要說話").isSongRequest, true, "播不要說話");
  assert.equal(parser("播不要說話").song, "不要說話", "播不要說話 song");
  assert.equal(parser("想聽不要說話").isSongRequest, true, "想聽不要說話");
  // 不含點歌詞的否定情況應被擋下
  assert.equal(parser("不要唱晴天").isSongRequest, false, "不要唱晴天");
  assert.equal(parser("先不要播稻香").isSongRequest, false, "先不要播稻香");
  assert.equal(parser("別播").isSongRequest, false, "別播");
});

test("handles artist+song format when artist is known", () => {
  // 已知歌手 + catalog 歌名 → 應算點歌
  assert.equal(parser("周杰倫的晴天").isSongRequest, true, "周杰倫的晴天");
  assert.equal(parser("周杰倫的晴天").song, "晴天");
  assert.equal(parser("五月天的溫柔").isSongRequest, true, "五月天的溫柔");
  // 未知歌手 → 不算點歌，但應記錄候選
  const unknownArtist = parser("路人的晴天");
  assert.equal(unknownArtist.isSongRequest, false, "路人的晴天 not a request");
});

test("handles simplified Chinese aliases", () => {
  // 簡體字應透過 alias 對應到繁體 catalog
  const parser2 = createSongParser({
    songCatalog: ["告白氣球", "說好不哭", "不要說話"],
    songAliases: {
      "告白气球": "告白氣球",
      "说好不哭": "說好不哭",
      "不要说话": "不要說話"
    },
    requireCatalogForShortCandidates: true,
    countUnknownExplicitRequests: true
  });
  assert.equal(parser2("播告白气球").isSongRequest, true, "簡體告白氣球");
  assert.equal(parser2("播告白气球").song, "告白氣球");
  assert.equal(parser2("想聽说好不哭").isSongRequest, true, "簡體說好不哭");
});

test("trailing request suffixes work correctly", () => {
  assert.equal(parser("晴天好嗎").isSongRequest, true, "晴天好嗎");
  assert.equal(parser("溫柔行嗎").isSongRequest, true, "溫柔行嗎");
  assert.equal(parser("晴天唱嗎").isSongRequest, true, "晴天唱嗎");
  // 無 catalog 對應的不應算點歌
  assert.equal(strictParser("未知歌名好嗎").isSongRequest, false, "未知歌名好嗎 strict");
});

test("new request word patterns work", () => {
  assert.equal(parser("老師唱晴天").isSongRequest, true, "老師唱晴天");
  assert.equal(parser("老師唱晴天").song, "晴天");
  assert.equal(parser("主播播稻香").isSongRequest, true, "主播播稻香");
  assert.equal(parser("求唱溫柔").isSongRequest, true, "求唱溫柔");
});

test("announcement and instruction patterns are filtered", () => {
  for (const msg of [
    "留言點歌",
    "請勿刷屏",
    "刷屏的請注意",
    "點歌方式：歌名加歌手"
  ]) {
    assert.equal(parser(msg).isSongRequest, false, msg);
  }
});

test("strips version qualifiers from song candidates", () => {
  assert.equal(parser("可以唱晴天 live版嗎").normalizedSong, "晴天", "live版");
  assert.equal(parser("想聽稻香 piano").normalizedSong, "稻香", "piano");
  assert.equal(parser("播告白氣球 cover").normalizedSong, "告白氣球", "cover");
  assert.equal(parser("想聽溫柔 原版").normalizedSong, "溫柔", "原版");
});

test("does not double-count same song from same user", () => {
  // 此測試驗證 parser 本身不受影響；去重邏輯在 index.js 層
  // parser 應仍正常識別每一次請求
  assert.equal(parser("晴天").isSongRequest, true, "first request");
  assert.equal(parser("晴天").isSongRequest, true, "second request still parsed");
});
