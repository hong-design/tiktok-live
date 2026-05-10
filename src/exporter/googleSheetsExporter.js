import path from "node:path";
import { fileURLToPath } from "node:url";

export async function exportToGoogleSheets({ songs, credentialsPath, sheetId, topLimit = 30, logger }) {
  if (!credentialsPath || !sheetId) return;

  let google;
  try {
    ({ google } = await import("googleapis"));
  } catch {
    logger?.warn("googleapis 套件未安裝，跳過 Google Sheets 匯出。請執行: npm install googleapis");
    return;
  }

  try {
    const resolvedCreds = path.resolve(process.cwd(), credentialsPath);
    const auth = new google.auth.GoogleAuth({
      keyFile: resolvedCreds,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    });

    const sheets = google.sheets({ version: "v4", auth });
    const now = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
    const topSongs = songs.slice(0, topLimit);
    const allSongs = [...songs].sort((a, b) =>
      String(a.firstSeenAt ?? "").localeCompare(String(b.firstSeenAt ?? ""))
    );

    await writeSheet(sheets, sheetId, "點歌排行", [
      [`更新時間：${now}`],
      ["排名", "歌名", "點歌次數", "首次點歌時間", "最後點歌時間"],
      ...topSongs.map((s, i) => [
        i + 1,
        s.song,
        s.count,
        formatTw(s.firstSeenAt),
        formatTw(s.lastSeenAt)
      ])
    ]);

    await writeSheet(sheets, sheetId, "全部點歌", [
      [`更新時間：${now}`],
      ["依時間排序", "歌名", "點歌次數", "首次點歌時間", "最後點歌時間"],
      ...allSongs.map((s, i) => [
        i + 1,
        s.song,
        s.count,
        formatTw(s.firstSeenAt),
        formatTw(s.lastSeenAt)
      ])
    ]);

    logger?.info("已同步至 Google 試算表", { songs: topSongs.length });
  } catch (error) {
    logger?.error("Google 試算表匯出失敗", error);
  }
}

async function writeSheet(sheets, spreadsheetId, sheetName, values) {
  await ensureSheetExists(sheets, spreadsheetId, sheetName);
  const range = `${sheetName}!A1`;
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: `${sheetName}!A:Z` });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "RAW",
    requestBody: { values }
  });
}

async function ensureSheetExists(sheets, spreadsheetId, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === title);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title } } }]
      }
    });
  }
}

function formatTw(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
}
