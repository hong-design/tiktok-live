import path from "node:path";
import { readJsonFile, writeJsonFileAtomic } from "../utils/file.js";

export class SongStore {
  constructor(options) {
    this.filePath = options.filePath;
    this.maxExamplesPerSong = options.maxExamplesPerSong;
    this.logger = options.logger;
    this.songs = new Map();
  }

  async load() {
    const savedSongs = await readJsonFile(this.filePath, []);
    const songList = Array.isArray(savedSongs) ? savedSongs : savedSongs.songs || [];

    for (const item of songList) {
      if (!item?.normalizedSong) {
        continue;
      }

      this.songs.set(item.normalizedSong, {
        song: item.song || item.normalizedSong,
        normalizedSong: item.normalizedSong,
        count: Number(item.count) || 0,
        firstSeenAt: item.firstSeenAt || null,
        lastSeenAt: item.lastSeenAt || null,
        examples: Array.isArray(item.examples) ? item.examples.slice(0, this.maxExamplesPerSong) : []
      });
    }
  }

  increment(parsedSong, originalComment, timestamp) {
    if (!parsedSong?.normalizedSong) {
      return null;
    }

    const key = parsedSong.normalizedSong;
    const existing = this.songs.get(key);

    if (existing) {
      existing.count += 1;
      existing.lastSeenAt = timestamp;

      if (
        originalComment &&
        existing.examples.length < this.maxExamplesPerSong &&
        !existing.examples.includes(originalComment)
      ) {
        existing.examples.push(originalComment);
      }

      return existing;
    }

    const item = {
      song: parsedSong.song || parsedSong.normalizedSong,
      normalizedSong: parsedSong.normalizedSong,
      count: 1,
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
      examples: originalComment ? [originalComment] : []
    };

    this.songs.set(key, item);
    return item;
  }

  getSortedSongs() {
    return [...this.songs.values()].sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return String(a.firstSeenAt || "").localeCompare(String(b.firstSeenAt || ""));
    });
  }

  getTopSongs(limit = 5) {
    return this.getSortedSongs().slice(0, limit);
  }

  getTotalRequests() {
    return this.getSortedSongs().reduce((sum, item) => sum + item.count, 0);
  }

  async save() {
    try {
      await writeJsonFileAtomic(this.filePath, this.getSortedSongs());
    } catch (error) {
      this.logger.error("歌曲統計資料寫入失敗", error, {
        filePath: path.relative(process.cwd(), this.filePath)
      });
      throw error;
    }
  }
}
