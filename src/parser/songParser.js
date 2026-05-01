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

const PUNCTUATION_AND_SPACES_AT_EDGES = /^[\s~～?!！？，,。.]+|[\s~～?!！？，,。.]+$/g;

export function createSongParser(options = {}) {
  const aliasResolver = createAliasResolver(options.songAliases || {});

  return function configuredParseSongRequest(comment) {
    return parseSongRequest(comment, {
      ...options,
      aliasResolver
    });
  };
}

export function parseSongRequest(comment, options = {}) {
  const rawComment = String(comment ?? "").trim();
  const normalizerOptions =
    typeof options.aliasResolver === "function"
      ? options
      : {
          ...options,
          aliasResolver: createAliasResolver(options.songAliases || {})
        };
  const minShortSongLength = Number(options.minShortSongLength ?? 2);
  const maxShortSongLength = Number(options.maxShortSongLength ?? 8);
  const requestWords = sortByLengthDesc(options.requestWords || DEFAULT_REQUEST_WORDS);
  const blacklistWords = options.blacklistWords || DEFAULT_BLACKLIST_WORDS;

  if (!rawComment) {
    return noMatch("empty_comment");
  }

  const explicitRequest = extractExplicitRequest(rawComment, requestWords, {
    minShortSongLength
  });

  if (explicitRequest) {
    const cleanedSong = cleanSongCandidate(explicitRequest.candidate, {
      requestWords,
      removeRequestWords: true
    });
    const normalizedSong = normalizeSongName(cleanedSong, normalizerOptions);

    if (!normalizedSong) {
      return noMatch("empty_after_normalization");
    }

    return {
      isSongRequest: true,
      song: cleanedSong,
      normalizedSong,
      confidence: "high",
      reason: `explicit_request_word:${explicitRequest.word}`
    };
  }

  const blacklistWord = findContainedWord(rawComment, blacklistWords);
  if (blacklistWord) {
    return noMatch(`blacklisted_chat_word:${blacklistWord}`);
  }

  const cleanedShortSong = cleanSongCandidate(rawComment, {
    requestWords,
    removeRequestWords: false
  });
  const normalizedShortSong = normalizeSongName(cleanedShortSong, normalizerOptions);
  const shortSongLength = countMeaningfulLength(normalizedShortSong);

  if (
    normalizedShortSong &&
    shortSongLength >= minShortSongLength &&
    shortSongLength <= maxShortSongLength
  ) {
    return {
      isSongRequest: true,
      song: cleanedShortSong,
      normalizedSong: normalizedShortSong,
      confidence: "medium",
      reason: "short_song_candidate"
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

function findContainedWord(value, words) {
  return words.find((word) => word && value.includes(word)) || null;
}

function countMeaningfulLength(value) {
  return String(value || "").replace(/\s+/g, "").length;
}

function sortByLengthDesc(words) {
  return [...words].sort((a, b) => b.length - a.length);
}

function noMatch(reason) {
  return {
    isSongRequest: false,
    song: null,
    normalizedSong: null,
    confidence: "low",
    reason
  };
}
