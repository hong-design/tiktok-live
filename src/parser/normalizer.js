import { TRAILING_PARTICLES } from "./patterns.js";

const KEEP_CHINESE_ENGLISH_NUMBER_SPACE = /[^\p{Script=Han}A-Za-z0-9\s]/gu;

export function normalizeBaseSongName(input) {
  if (input === null || input === undefined) {
    return "";
  }

  let value = String(input)
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(KEEP_CHINESE_ENGLISH_NUMBER_SPACE, " ")
    .replace(/\s+/g, " ")
    .trim();

  value = stripBoundaryParticles(value);
  return value.replace(/\s+/g, " ").trim();
}

export function createAliasResolver(aliases = {}) {
  const aliasMap = new Map();

  for (const [alias, canonical] of Object.entries(aliases || {})) {
    const normalizedAlias = normalizeBaseSongName(alias);
    const normalizedCanonical = normalizeBaseSongName(canonical);
    if (normalizedAlias && normalizedCanonical) {
      aliasMap.set(normalizedAlias, normalizedCanonical);
    }
  }

  return function resolveAlias(normalizedSong) {
    return aliasMap.get(normalizedSong) || normalizedSong;
  };
}

export function normalizeSongName(input, options = {}) {
  const normalized = normalizeBaseSongName(input);
  if (!normalized) {
    return "";
  }

  if (typeof options.aliasResolver === "function") {
    return options.aliasResolver(normalized);
  }

  return normalized;
}

export function stripBoundaryParticles(input) {
  let value = String(input || "").trim();
  let changed = true;

  while (changed && value) {
    changed = false;

    for (const particle of TRAILING_PARTICLES) {
      if (value.startsWith(particle)) {
        value = value.slice(particle.length).trim();
        changed = true;
      }
      if (value.endsWith(particle)) {
        value = value.slice(0, -particle.length).trim();
        changed = true;
      }
    }
  }

  return value;
}
