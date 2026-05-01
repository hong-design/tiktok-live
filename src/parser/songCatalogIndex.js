import { normalizeBaseSongName } from "./normalizer.js";

const DEFAULT_LONG_SONG_MIN_LENGTH = 9;
const DEFAULT_TOKEN_SIZE = 2;

export function createSongCatalogIndex(options = {}) {
  const aliasResolver =
    typeof options.aliasResolver === "function" ? options.aliasResolver : (value) => value;
  const longSongMinLength = Number(options.longSongMinLength ?? DEFAULT_LONG_SONG_MIN_LENGTH);
  const tokenSize = Number(options.tokenSize ?? DEFAULT_TOKEN_SIZE);
  const normalizedToOriginal = new Map();
  const exactMatchSet = new Set();
  const tokenIndex = new Map();

  for (const rawSong of options.songCatalog || []) {
    const originalSong = String(rawSong || "").trim();
    if (!originalSong) {
      continue;
    }

    const normalizedSong = aliasResolver(normalizeBaseSongName(originalSong));
    if (!normalizedSong || normalizedToOriginal.has(normalizedSong)) {
      continue;
    }

    normalizedToOriginal.set(normalizedSong, originalSong);
    exactMatchSet.add(normalizedSong);

    if (countMeaningfulLength(normalizedSong) >= longSongMinLength) {
      for (const token of createIndexTokens(normalizedSong, tokenSize)) {
        if (!tokenIndex.has(token)) {
          tokenIndex.set(token, []);
        }
        tokenIndex.get(token).push(normalizedSong);
      }
    }
  }

  return {
    normalizedToOriginal,
    exactMatchSet,
    tokenIndex,
    hasExact(normalizedSong) {
      return exactMatchSet.has(normalizedSong);
    },
    getOriginal(normalizedSong) {
      return normalizedToOriginal.get(normalizedSong) || null;
    },
    findExact(normalizedSong) {
      if (!exactMatchSet.has(normalizedSong)) {
        return null;
      }

      return {
        normalizedSong,
        song: normalizedToOriginal.get(normalizedSong) || normalizedSong
      };
    },
    findContainedCandidate(normalizedText) {
      const candidates = getCandidateSongs(normalizedText, tokenIndex, tokenSize);

      for (const normalizedSong of candidates) {
        if (normalizedText.includes(normalizedSong)) {
          return {
            normalizedSong,
            song: normalizedToOriginal.get(normalizedSong) || normalizedSong
          };
        }
      }

      return null;
    },
    size() {
      return normalizedToOriginal.size;
    }
  };
}

function getCandidateSongs(normalizedText, tokenIndex, tokenSize) {
  if (!normalizedText || tokenIndex.size === 0) {
    return [];
  }

  const candidates = new Set();

  for (const token of createIndexTokens(normalizedText, tokenSize)) {
    const songs = tokenIndex.get(token);
    if (!songs) {
      continue;
    }

    for (const song of songs) {
      candidates.add(song);
    }
  }

  return [...candidates].sort((a, b) => b.length - a.length);
}

function createIndexTokens(value, tokenSize) {
  const compact = String(value || "").replace(/\s+/g, "");
  if (!compact) {
    return [];
  }

  if (compact.length <= tokenSize) {
    return [compact];
  }

  const tokens = new Set();
  for (let index = 0; index <= compact.length - tokenSize; index += 1) {
    tokens.add(compact.slice(index, index + tokenSize));
  }
  return tokens;
}

function countMeaningfulLength(value) {
  return String(value || "").replace(/\s+/g, "").length;
}
