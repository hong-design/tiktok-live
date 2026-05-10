import {
  BEFORE_CANDIDATE_REQUEST_WORDS,
  CLEANING_WORDS,
  DEFAULT_BLACKLIST_WORDS,
  DEFAULT_REQUEST_WORDS,
  REQUEST_PREFIX_FILLERS,
  SINGLE_ACTION_REQUEST_WORDS,
  TRAILING_PARTICLES,
  VERSION_QUALIFIER_WORDS
} from "./patterns.js";
import {
  createAliasResolver,
  normalizeBaseSongName,
  normalizeSongName,
  stripBoundaryParticles
} from "./normalizer.js";
import { createSongCatalogIndex } from "./songCatalogIndex.js";

const PUNCTUATION_AND_SPACES_AT_EDGES = /^[\s~～?!！？，,。.]+|[\s~～?!！？，,。.]+$/g;

const BLOCK_SHORT_CANDIDATE_WORDS = [
  "我在",
  "你在",
  "正在",
  "講話",
  "說話",
  "聊天",
  "主播",
  "加油",
  "不要唱",
  "不要播",
  "不要聽",
  "別唱",
  "別播",
  "不用唱",
  "不用播",
  "不要"
];

const NEGATIVE_REQUEST_WORDS = [
  "不要唱",
  "不要播",
  "不要聽",
  "別唱",
  "別播",
  "別聽",
  "不用唱",
  "不用播",
  "不用聽",
  "先不要",
  "不要",
  "先不用唱",
  "先不用播",
  "不想聽",
  "不要放",
  "先別唱",
  "先別播",
  "不用放",
  "別放",
  "先別放"
];

const ANNOUNCEMENT_OR_INSTRUCTION_PATTERNS = [
  "都可以留言",
  "留一次就好",
  "請勿刷屏",
  "不要刷屏",
  "主播下播",
  "點歌要歌名",
  "點歌要 歌名",
  "歌名歌手",
  "歌名 歌手",
  "這樣比較好找",
  "建議大家點歌",
  "如：",
  "如:",
  "留言點歌",
  "點歌方式",
  "點歌規則",
  "記得留歌名",
  "要有歌名",
  "加上歌手",
  "刷屏",
  "格式：",
  "格式:",
  "謝謝配合",
  "請大家點歌",
  "點歌需要",
  "歌名加歌手",
  "刷留言"
];

const TRAILING_REQUEST_SUFFIXES = [
  "可以唱嗎",
  "能唱嗎",
  "可以嗎",
  "有嗎",
  "會嗎",
  "好嗎",
  "行嗎",
  "唱嗎",
  "播嗎"
];

const KNOWN_ARTIST_NAMES = [
  "周杰倫",
  "任賢齊",
  "盧廣仲",
  "林俊傑",
  "五月天",
  "蔡依林",
  "鄧紫棋",
  "張惠妹",
  "梁靜茹",
  "陳奕迅",
  "薛之謙",
  "告五人",
  "伍佰",
  "陶喆",
  "方大同",
  "王力宏",
  "張學友",
  "劉德華",
  "羅大佑",
  "李宗盛",
  "孫燕姿",
  "王菲",
  "鄭秀文",
  "范瑋琪",
  "許茹芸",
  "張韶涵",
  "魏如萱",
  "周興哲",
  "艾怡良",
  "陳綺貞",
  "徐佳瑩",
  "蘇打綠",
  "老王樂隊",
  "動力火車",
  "張信哲",
  "古巨基",
  "黃明志",
  "蕭煌奇",
  "江蕙",
  "葉啟田",
  "鄭進一",
  "黃乙玲",
  "草東沒有派對",
  "茄子蛋",
  "楊丞琳",
  "楊乃文",
  "田馥甄",
  "楊宗緯",
  "蕭敬騰",
  "許廷鏗",
  "謝安琪",
  "容祖兒",
  "莫文蔚",
  "林憶蓮",
  "李克勤",
  "張國榮",
  "梅豔芳",
  "鄧麗君",
  "玖壹壹",
  "韋禮安",
  "盧巧音",
  "A-Lin",
  "9m88",
  "吳青峰",
  "盧廣仲",
  "顏人中",
  "郭頂",
  "李榮浩",
  "毛不易",
  "趙雷",
  "隔壁老樊",
  "陳雪凝",
  "鄧寓君",
  "徐秉龍",
  "告五人",
  "茄子蛋",
  "白安",
  "蔡健雅",
  "品冠",
  "光良",
  "蕭亞軒",
  "張震嶽",
  "周傳雄",
  "潘瑋柏",
  "黃品源",
  "Crowd Lu",
  "周杰倫",
  "五月天",
  "S.H.E",
  "F.I.R",
  "Elva"
];

const INVALID_EXPLICIT_CANDIDATES = [
  "我",
  "你",
  "他",
  "她",
  "它",
  "我們",
  "你們",
  "他們",
  "講話",
  "說話",
  "聊天",
  "直播",
  "一下",
  "一首",
  "這首",
  "那首",
  "歌",
  "歌名",
  "歌手",
  "日文歌",
  "英文歌",
  "中文歌",
  "可以",
  "拜託",
  "嗎"
];

export function createSongParser(options = {}) {
  const aliasResolver = createAliasResolver(options.songAliases || {});
  const catalogIndex = createSongCatalogIndex({
    songCatalog: options.songCatalog || [],
    aliasResolver
  });

  return function configuredParseSongRequest(comment) {
    return parseSongRequest(comment, {
      ...options,
      aliasResolver,
      catalogIndex
    });
  };
}

export function parseSongRequest(comment, options = {}) {
  const rawComment = String(comment ?? "").trim();
  const aliasResolver =
    typeof options.aliasResolver === "function"
      ? options.aliasResolver
      : createAliasResolver(options.songAliases || {});
  const catalogIndex =
    options.catalogIndex ||
    createSongCatalogIndex({
      songCatalog: options.songCatalog || [],
      aliasResolver
    });

  const normalizerOptions = {
    ...options,
    aliasResolver
  };
  const minShortSongLength = Number(options.minShortSongLength ?? 2);
  const maxShortSongLength = Number(options.maxShortSongLength ?? 8);
  const minExplicitSongLength = Number(options.minExplicitSongLength ?? 2);
  const maxExplicitSongLength = Number(options.maxExplicitSongLength ?? 30);
  const requireCatalogForShortCandidates = options.requireCatalogForShortCandidates !== false;
  const countUnknownExplicitRequests = options.countUnknownExplicitRequests !== false;
  const requestWords = sortByLengthDesc(options.requestWords || DEFAULT_REQUEST_WORDS);
  const blacklistWords = options.blacklistWords || DEFAULT_BLACKLIST_WORDS;

  if (!rawComment) {
    return noMatch("empty_comment");
  }

  if (isAnnouncementOrInstruction(rawComment)) {
    return noMatch("announcement_or_instruction");
  }

  const requestContext = {
    requestWords,
    normalizerOptions,
    catalogIndex,
    minExplicitSongLength,
    maxExplicitSongLength,
    countUnknownExplicitRequests
  };

  const leadingHaveRequest = extractLeadingHaveRequest(rawComment);
  if (leadingHaveRequest) {
    return resolveExplicitCandidate(leadingHaveRequest, requestContext);
  }

  const tailQuestionRequest = extractTailQuestionRequest(rawComment, {
    catalogIndex,
    normalizerOptions
  });
  if (tailQuestionRequest) {
    return resolveExplicitCandidate(tailQuestionRequest, requestContext);
  }

  const explicitRequest = extractExplicitRequest(rawComment, requestWords, {
    minShortSongLength
  });
  if (explicitRequest) {
    return resolveExplicitCandidate(explicitRequest, requestContext);
  }

  // 否定詞檢查放在明確點歌詞之後，避免「播不要說話」等情況被誤擋
  if (containsNegativeRequest(rawComment)) {
    return noMatch("negative_request_word");
  }

  const blacklistWord = findContainedWord(rawComment, blacklistWords);
  if (blacklistWord) {
    return noMatch(`blacklisted_chat_word:${blacklistWord}`);
  }

  const blockShortWord = findContainedWord(rawComment, BLOCK_SHORT_CANDIDATE_WORDS);
  if (blockShortWord) {
    return noMatch(`blocked_short_candidate_word:${blockShortWord}`);
  }

  if (containsRequestCue(rawComment, requestWords)) {
    return noMatch("request_cue_without_valid_song_candidate");
  }

  const artistCandidate = extractArtistCandidate(rawComment);
  if (artistCandidate) {
    const cleanedArtistSong = cleanSongCandidate(artistCandidate.candidate, {
      requestWords,
      removeRequestWords: false
    });
    const normalizedArtistSong = normalizeSongName(cleanedArtistSong, normalizerOptions);

    if (normalizedArtistSong) {
      const artistCatalogMatch = catalogIndex.findExact(normalizedArtistSong);
      if (artistCatalogMatch) {
        return {
          isSongRequest: true,
          song: artistCatalogMatch.song || cleanedArtistSong,
          normalizedSong: normalizedArtistSong,
          confidence: "high",
          reason: `artist_song_catalog_match:${artistCandidate.word}`,
          isKnownSong: true
        };
      }
      return noMatch("artist_song_candidate", {
        candidateSong: cleanedArtistSong,
        normalizedCandidate: normalizedArtistSong
      });
    }
  }

  const cleanedShortSong = cleanSongCandidate(rawComment, {
    requestWords,
    removeRequestWords: false
  });
  const normalizedShortSong = normalizeSongName(cleanedShortSong, normalizerOptions);
  const shortSongLength = countMeaningfulLength(normalizedShortSong);
  const shortCatalogMatch = catalogIndex.findExact(normalizedShortSong);

  if (normalizedShortSong && shortCatalogMatch) {
    return {
      isSongRequest: true,
      song: shortCatalogMatch.song || cleanedShortSong,
      normalizedSong: normalizedShortSong,
      confidence: "high",
      reason: "direct_catalog_match",
      isKnownSong: true
    };
  }

  if (
    normalizedShortSong &&
    shortSongLength >= minShortSongLength &&
    shortSongLength <= maxShortSongLength
  ) {
    if (requireCatalogForShortCandidates) {
      return noMatch("short_candidate_not_in_catalog", {
        candidateSong: cleanedShortSong,
        normalizedCandidate: normalizedShortSong
      });
    }

    return {
      isSongRequest: true,
      song: cleanedShortSong,
      normalizedSong: normalizedShortSong,
      confidence: "medium",
      reason: "short_song_candidate_without_catalog",
      isKnownSong: false
    };
  }

  return noMatch("not_song_request");
}

function resolveExplicitCandidate(explicitRequest, context) {
  const {
    requestWords,
    normalizerOptions,
    catalogIndex,
    minExplicitSongLength,
    maxExplicitSongLength,
    countUnknownExplicitRequests
  } = context;
  const candidate = selectBestCleanedCandidate(explicitRequest.candidate, {
    requestWords,
    normalizerOptions,
    catalogIndex
  });
  const cleanedSong = candidate.cleanedSong;
  const normalizedCandidate = candidate.normalizedSong;
  const catalogMatch = candidate.catalogMatch;
  const normalizedSong = catalogMatch?.normalizedSong || normalizedCandidate;
  const displaySong = catalogMatch?.song || cleanedSong;
  const length = countMeaningfulLength(normalizedSong);
  const isKnownSong = Boolean(catalogMatch);

  if (!normalizedSong) {
    return noMatch("empty_after_normalization");
  }

  if (isInvalidExplicitCandidate(cleanedSong, normalizedSong)) {
    return noMatch("invalid_explicit_candidate");
  }

  if (length < minExplicitSongLength || length > maxExplicitSongLength) {
    return noMatch("explicit_candidate_length_out_of_range", {
      candidateSong: cleanedSong,
      normalizedCandidate: normalizedSong
    });
  }

  if (!isKnownSong && !countUnknownExplicitRequests) {
    return noMatch("explicit_candidate_not_in_catalog", {
      candidateSong: cleanedSong,
      normalizedCandidate: normalizedSong
    });
  }

  return {
    isSongRequest: true,
    song: displaySong,
    normalizedSong,
    confidence: isKnownSong ? "high" : "medium",
    reason: isKnownSong
      ? `explicit_request_catalog_match:${explicitRequest.word}`
      : `explicit_request_word:${explicitRequest.word}`,
    isKnownSong
  };
}

function selectBestCleanedCandidate(candidate, options) {
  const variants = uniqueNonEmpty([
    cleanSongCandidate(candidate, {
      requestWords: options.requestWords,
      removeRequestWords: true
    }),
    cleanSongCandidate(candidate, {
      requestWords: options.requestWords,
      removeRequestWords: false
    })
  ]);
  const resolvedVariants = variants.map((cleanedSong) => {
    const normalizedSong = normalizeSongName(cleanedSong, options.normalizerOptions);
    const catalogMatch =
      options.catalogIndex.findExact(normalizedSong) ||
      options.catalogIndex.findContainedCandidate(normalizedSong);

    return {
      cleanedSong,
      normalizedSong,
      catalogMatch
    };
  });

  return (
    resolvedVariants.find((variant) => variant.catalogMatch) ||
    resolvedVariants[0] || {
      cleanedSong: "",
      normalizedSong: "",
      catalogMatch: null
    }
  );
}

function extractExplicitRequest(comment, requestWords, options) {
  const value = String(comment ?? "");

  for (const word of requestWords) {
    const index = value.indexOf(word);
    if (index === -1) {
      continue;
    }

    if (isSingleActionWord(word) && !hasValidSingleActionPrefix(value.slice(0, index))) {
      continue;
    }

    const after = value.slice(index + word.length);
    const cleanedAfter = cleanSongCandidate(after, {
      requestWords,
      removeRequestWords: true
    });

    if (cleanedAfter) {
      if (
        isSingleActionWord(word) &&
        countMeaningfulLength(normalizeBaseSongName(cleanedAfter)) < options.minShortSongLength
      ) {
        continue;
      }

      return {
        word,
        candidate: after
      };
    }

    if (BEFORE_CANDIDATE_REQUEST_WORDS.includes(word)) {
      const before = value.slice(0, index);
      const cleanedBefore = cleanSongCandidate(before, {
        requestWords,
        removeRequestWords: false
      });

      if (cleanedBefore) {
        return {
          word,
          candidate: before
        };
      }
    }
  }

  return null;
}

function extractLeadingHaveRequest(comment) {
  const value = trimSentenceEdges(comment);
  const match = value.match(/^有(.+)嗎$/);

  if (!match) {
    return null;
  }

  const candidate = match[1].trim();
  if (!candidate) {
    return null;
  }

  return {
    word: "有...嗎",
    candidate
  };
}

function extractTailQuestionRequest(comment, options) {
  const value = trimSentenceEdges(comment);

  if (!value) {
    return null;
  }

  if (value.endsWith("嗎")) {
    const beforeQuestionParticle = value.slice(0, -1).trim();
    const normalizedBeforeQuestionParticle = normalizeSongName(
      cleanSongCandidate(beforeQuestionParticle, {
        removeRequestWords: false
      }),
      options.normalizerOptions
    );

    if (options.catalogIndex.findExact(normalizedBeforeQuestionParticle)) {
      return {
        word: "嗎",
        candidate: beforeQuestionParticle
      };
    }
  }

  for (const suffix of TRAILING_REQUEST_SUFFIXES) {
    if (!value.endsWith(suffix)) {
      continue;
    }

    const candidate = value.slice(0, -suffix.length).trim();
    if (!candidate) {
      continue;
    }

    return {
      word: suffix,
      candidate
    };
  }

  return null;
}

function extractArtistCandidate(comment) {
  const value = trimSentenceEdges(comment);
  const artistThenSong = value.match(/^(.+?)的\s*(.+)$/);

  if (artistThenSong && artistThenSong[2].trim()) {
    const possibleArtist = artistThenSong[1].trim();
    const isKnownArtist = KNOWN_ARTIST_NAMES.some(
      (a) => possibleArtist.includes(a) || a.includes(possibleArtist)
    );
    if (isKnownArtist) {
      return {
        word: "artist_then_song",
        candidate: artistThenSong[2]
      };
    }
  }

  for (const artist of KNOWN_ARTIST_NAMES) {
    if (value.endsWith(`${artist}的`) && value.length > artist.length + 1) {
      return {
        word: "song_then_artist",
        candidate: value.slice(0, -`${artist}的`.length)
      };
    }
  }

  return null;
}

export function cleanSongCandidate(candidate, options = {}) {
  let value = String(candidate ?? "").trim();
  const requestWords = sortByLengthDesc(options.requestWords || DEFAULT_REQUEST_WORDS);

  value = value.replace(PUNCTUATION_AND_SPACES_AT_EDGES, "").trim();
  value = stripBoundaryParticles(value);

  if (options.removeRequestWords) {
    value = stripRepeatedBoundaryWords(value, requestWords);
    value = stripRepeatedBoundaryWords(value, CLEANING_WORDS);
  }

  value = stripRepeatedBoundaryWords(value, TRAILING_PARTICLES);
  value = stripRepeatedBoundaryWords(value, VERSION_QUALIFIER_WORDS);
  value = value.replace(PUNCTUATION_AND_SPACES_AT_EDGES, "").trim();

  return value.replace(/\s+/g, " ").trim();
}

function containsNegativeRequest(value) {
  return NEGATIVE_REQUEST_WORDS.some((word) => word && value.includes(word));
}

function isAnnouncementOrInstruction(value) {
  const compactValue = String(value || "").normalize("NFKC").replace(/\s+/g, "");
  const looseValue = String(value || "").normalize("NFKC");

  return ANNOUNCEMENT_OR_INSTRUCTION_PATTERNS.some((pattern) => {
    const compactPattern = pattern.replace(/\s+/g, "");
    return (
      (compactPattern && compactValue.includes(compactPattern)) ||
      (pattern.includes(" ") && looseValue.includes(pattern))
    );
  });
}

function isInvalidExplicitCandidate(cleanedSong, normalizedSong) {
  const compact = String(normalizedSong || "").replace(/\s+/g, "");
  const rawCompact = String(cleanedSong || "").replace(/\s+/g, "");
  if (!compact) {
    return true;
  }

  if (/^\d+$/.test(compact)) {
    return true;
  }

  if (rawCompact.endsWith("的")) {
    return true;
  }

  return INVALID_EXPLICIT_CANDIDATES.some((word) => compact === normalizeBaseSongName(word));
}

function stripRepeatedBoundaryWords(input, words) {
  let value = String(input || "").trim();
  let changed = true;
  const sortedWords = sortByLengthDesc(words);

  while (changed && value) {
    changed = false;

    for (const word of sortedWords) {
      if (!word) {
        continue;
      }

      if (value.startsWith(word)) {
        value = value.slice(word.length).trim();
        changed = true;
      }

      if (value.endsWith(word)) {
        value = value.slice(0, -word.length).trim();
        changed = true;
      }
    }
  }

  return value;
}

function hasValidSingleActionPrefix(prefix) {
  let value = String(prefix || "").trim();

  if (!value) {
    return true;
  }

  value = stripRepeatedBoundaryWords(value, REQUEST_PREFIX_FILLERS);
  value = value.replace(PUNCTUATION_AND_SPACES_AT_EDGES, "").trim();

  return value.length === 0;
}

function isSingleActionWord(word) {
  return SINGLE_ACTION_REQUEST_WORDS.includes(word);
}

function containsRequestCue(value, words) {
  return words.some((word) => word && value.includes(word));
}

function findContainedWord(value, words) {
  return words.find((word) => word && value.includes(word)) || null;
}

function trimSentenceEdges(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(PUNCTUATION_AND_SPACES_AT_EDGES, "")
    .trim();
}

function uniqueNonEmpty(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function countMeaningfulLength(value) {
  return String(value || "").replace(/\s+/g, "").length;
}

function sortByLengthDesc(words) {
  return [...words].sort((a, b) => b.length - a.length);
}

function noMatch(reason, extra = {}) {
  return {
    isSongRequest: false,
    song: null,
    normalizedSong: null,
    confidence: "low",
    reason,
    candidateSong: extra.candidateSong || null,
    normalizedCandidate: extra.normalizedCandidate || null,
    isKnownSong: false
  };
}
