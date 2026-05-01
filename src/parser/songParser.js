import {
  BEFORE_CANDIDATE_REQUEST_WORDS,
  CLEANING_WORDS,
  DEFAULT_BLACKLIST_WORDS,
  DEFAULT_REQUEST_WORDS,
  REQUEST_PREFIX_FILLERS,
  SINGLE_ACTION_REQUEST_WORDS,
  TRAILING_PARTICLES
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
  "不要"
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

  if (containsNegativeRequest(rawComment)) {
    return noMatch("negative_request_word");
  }

  const explicitRequest = extractExplicitRequest(rawComment, requestWords, {
    minShortSongLength
  });

  if (explicitRequest) {
    const cleanedSong = cleanSongCandidate(explicitRequest.candidate, {
      requestWords,
      removeRequestWords: true
    });
    const normalizedCandidate = normalizeSongName(cleanedSong, normalizerOptions);
    const catalogMatch =
      catalogIndex.findExact(normalizedCandidate) ||
      catalogIndex.findContainedCandidate(normalizedCandidate);
    const normalizedSong = catalogMatch?.normalizedSong || normalizedCandidate;
    const displaySong = catalogMatch?.song || cleanedSong;
    const length = countMeaningfulLength(normalizedSong);
    const isKnownSong = Boolean(catalogMatch);

    if (!normalizedSong) {
      return noMatch("empty_after_normalization");
    }

    if (isInvalidExplicitCandidate(cleanedSong, normalizedSong)) {
      return noMatch("invalid_explicit_candidate", {
        candidateSong: cleanedSong,
        normalizedCandidate: normalizedSong
      });
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

function extractExplicitRequest(comment, requestWords, options) {
  const value = comment.normalize("NFKC");

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

export function cleanSongCandidate(candidate, options = {}) {
  let value = String(candidate ?? "").normalize("NFKC").trim();
  const requestWords = sortByLengthDesc(options.requestWords || DEFAULT_REQUEST_WORDS);

  value = value.replace(PUNCTUATION_AND_SPACES_AT_EDGES, "").trim();
  value = stripBoundaryParticles(value);

  if (options.removeRequestWords) {
    value = stripRepeatedBoundaryWords(value, requestWords);
    value = stripRepeatedBoundaryWords(value, CLEANING_WORDS);
  }

  value = stripRepeatedBoundaryWords(value, TRAILING_PARTICLES);
  value = value.replace(PUNCTUATION_AND_SPACES_AT_EDGES, "").trim();

  return value.replace(/\s+/g, " ").trim();
}

function containsNegativeRequest(value) {
  return NEGATIVE_REQUEST_WORDS.some((word) => word && value.includes(word));
}

function isInvalidExplicitCandidate(cleanedSong, normalizedSong) {
  const compact = String(normalizedSong || "").replace(/\s+/g, "");
  if (!compact) {
    return true;
  }

  if (/^\d+$/.test(compact)) {
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
