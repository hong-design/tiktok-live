import assert from "node:assert/strict";
import test from "node:test";
import { createSongParser } from "../src/parser/songParser.js";

const parser = createSongParser({
  songCatalog: ["晴天", "跳樓機", "生日快樂", "稻香", "告白氣球"],
  songAliases: {
    "生日快樂歌": "生日快樂",
    "happy birthday": "生日快樂",
    "告白汽球": "告白氣球"
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
