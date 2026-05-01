import { writeJsonFileAtomic } from "../utils/file.js";
import { nowIso } from "../utils/time.js";

export async function exportSongsJson(options) {
  const songs = options.songs;
  const payload = {
    generatedAt: nowIso(),
    targetUsername: options.targetUsername,
    totalSongs: songs.length,
    totalRequests: songs.reduce((sum, item) => sum + item.count, 0),
    songs
  };

  await writeJsonFileAtomic(options.outputFile, payload);
  return options.outputFile;
}
