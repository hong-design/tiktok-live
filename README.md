# TikTok LIVE 點歌統計系統

這是一個 Node.js 專案，用於監聽指定「公開 TikTok LIVE」聊天室留言，判斷哪些留言像是在點歌，並保存原始留言欄位、歌曲統計與 CSV / JSON 報表。

## 合規聲明

- 只讀取公開 TikTok LIVE 聊天室留言。
- 不登入、不模擬登入、不使用他人憑證。
- 不抓私訊，不處理私人直播或權限牆後內容。
- 不做大量監控或大量爬取。
- 原始留言只保存統計必要欄位：時間、公開 ID / 暱稱、留言、解析結果。

## 安裝方式

需求：Node.js 20 以上。

```bash
npm install
```

Windows PowerShell 若因 execution policy 擋住 `npm.ps1`，可改用：

```powershell
npm.cmd install
```

## .env 設定

複製範例檔：

```bash
cp .env.example .env
```

Windows PowerShell 可用：

```powershell
Copy-Item .env.example .env
```

編輯 `.env`：

```env
TIKTOK_USERNAME=target_username
EXPORT_INTERVAL_SECONDS=60
SAVE_INTERVAL_SECONDS=30
RECONNECT_DELAY_SECONDS=10
WAIT_FOR_LIVE=true
LIVE_POLL_INTERVAL_SECONDS=30
RETAIN_LIVE_SESSIONS=5

DATA_DIR=./data
EXPORT_DIR=./exports
LOG_DIR=./logs

ENABLE_RAW_MESSAGE_LOG=true
ENABLE_MESSAGE_CLASSIFICATION_LOG=true
ENABLE_CHAT_MESSAGE_LOG=false
ENABLE_FULL_TRANSCRIPT_LOG=true
ENABLE_JSON_EXPORT=true
ENABLE_CSV_EXPORT=true
ENABLE_SHEET_EXPORT=true
SHEET_TOP_LIMIT=30

MIN_SHORT_SONG_LENGTH=2
MAX_SHORT_SONG_LENGTH=8
MAX_EXAMPLES_PER_SONG=5

REQUIRE_CATALOG_FOR_SHORT_CANDIDATES=true
COUNT_UNKNOWN_EXPLICIT_REQUESTS=true
SAVE_UNCERTAIN_CANDIDATES=true
MIN_EXPLICIT_SONG_LENGTH=2
MAX_EXPLICIT_SONG_LENGTH=30
```

`TIKTOK_USERNAME` 請填公開 LIVE 帳號，不需要 `@`。若未設定或仍是 `target_username`，程式會直接停止。

## 啟動方式

```bash
npm start
```

Windows PowerShell 可用：

```powershell
npm.cmd start
```

執行後終端會顯示目前連線帳號、連線狀態、收到留言數、偵測到的點歌數、候選未計入數、目前 Top 5 歌曲與匯出檔案位置。若 `ENABLE_MESSAGE_CLASSIFICATION_LOG=true`，每筆留言也會即時顯示為 `[點歌]`、`[候選][未計入]` 或 `[聊天]`。

若目前未開直播，程式會顯示「目前未偵測到直播」，並在 `WAIT_FOR_LIVE=true` 時依 `LIVE_POLL_INTERVAL_SECONDS` 自動輪詢；對方一開公開 LIVE，系統會自動連上。直播結束後也會回到等待下一場直播的狀態。

## 完整直播留言紀錄

若 `ENABLE_FULL_TRANSCRIPT_LOG=true`，系統會從程式成功連線後開始，完整保存每一則收到的公開聊天室留言：

- `data/live-comments.jsonl`
- `exports/live-comments.csv`

此檔案不會只保存點歌，也不會因為解析結果刪減留言內容。`comment` 欄位會保留 connector 收到的原始留言字串；程式只會略過完全空白的留言。

限制：此工具只能保存「程式啟動並成功連線後」收到的公開 LIVE 留言，無法補抓啟動前的歷史留言。

## 保留多場直播

`RETAIN_LIVE_SESSIONS=5` 代表至少保留最近 5 場成功連線的直播場次。每次連線取得新的 TikTok LIVE `roomId` 時，系統會建立獨立場次資料夾：

- `data/sessions/<YYYY-MM-DD_HHMMSS_username_roomId>/live-comments.jsonl`
- `data/sessions/<YYYY-MM-DD_HHMMSS_username_roomId>/messages.jsonl`
- `data/sessions/<YYYY-MM-DD_HHMMSS_username_roomId>/songs.json`
- `data/sessions/<YYYY-MM-DD_HHMMSS_username_roomId>/session.json`
- `exports/sessions/<YYYY-MM-DD_HHMMSS_username_roomId>/live-comments.csv`
- `exports/sessions/<YYYY-MM-DD_HHMMSS_username_roomId>/messages.csv`
- `exports/sessions/<YYYY-MM-DD_HHMMSS_username_roomId>/songs.csv`
- `exports/sessions/<YYYY-MM-DD_HHMMSS_username_roomId>/songs.json`

資料夾名稱會包含日期、時間、帳號與 roomId。匯出資料夾內也會額外產生帶同樣標籤的檔案，例如 `<label>_live-comments.csv`，方便人工整理。超過保留數量時，會清理最舊的場次資料夾。根目錄的 `data/live-comments.jsonl`、`data/messages.jsonl`、`data/songs.json` 仍會保留作為目前累積紀錄。

## 降低錯誤率策略

此版本預設採用「高精準度」策略：

1. **直接短留言不再無條件計入。** 例如 `晴天`、`跳樓機` 這類短留言，必須命中 `config/songCatalog.json` 或 `config/songAliases.json` 才會被統計。
2. **未命中的短留言會進入候選區。** 例如 `未知歌名` 會被標記為 `messageType=uncertain_candidate`，但不會加到歌曲排行榜。
3. **明確請求句仍可統計未知歌名。** 例如 `想聽某首歌`，預設會計入，因為語意比單純短留言更明確。若要更嚴格，可把 `COUNT_UNKNOWN_EXPLICIT_REQUESTS=false`。
4. **否定句不計入。** 例如 `不要播跳樓機`、`可以不要唱晴天嗎` 不會被統計。
5. **聊天詞優先排除。** 例如 `晴天好好聽`、`哈哈笑死`、`主播加油` 不會被統計。

最保守設定：

```env
REQUIRE_CATALOG_FOR_SHORT_CANDIDATES=true
COUNT_UNKNOWN_EXPLICIT_REQUESTS=false
SAVE_UNCERTAIN_CANDIDATES=true
```

這會把「不在歌名庫裡的歌」全部丟到候選區，不直接統計。錯誤率最低，但漏判率最高。

## songCatalog.json 用法

`config/songCatalog.json` 是降低誤判的核心。短留言只有命中這份歌名庫才會被計入。

範例：

```json
[
  "晴天",
  "跳樓機",
  "生日快樂",
  "稻香",
  "告白氣球"
]
```

建議把常見會被點的歌逐步加入。直播跑一段時間後，到 `exports/messages.csv` 篩選：

```text
messageType = uncertain_candidate
```

把確定是歌的候選字加入 `config/songCatalog.json`，下一次就會自動統計。

## songAliases.json 用法

`config/songAliases.json` 可把不同寫法歸到同一首歌：

```json
{
  "生日快樂歌": "生日快樂",
  "happy birthday": "生日快樂",
  "告白汽球": "告白氣球"
}
```

左側是使用者可能輸入的別名，右側是統一後的歌名。系統會先正規化再比對，因此英文大小寫與標點差異通常不影響匹配。

## 輸出檔案

資料保存：

- `data/messages.jsonl`：每行一筆已保存留言與解析結果，包含 `messageType`。
- `data/live-comments.jsonl`：完整公開聊天室留言紀錄，需 `ENABLE_FULL_TRANSCRIPT_LOG=true`。
- `data/songs.json`：歌曲統計資料，依點歌次數排序。
- `data/sessions/`：分場直播資料，依 `RETAIN_LIVE_SESSIONS` 保留最近 N 場。

報表匯出：

- `exports/songs.csv`
- `exports/songs.json`
- `exports/messages.csv`
- `exports/live-comments.csv`
- `exports/song-sheet.csv`：Google Sheets / Excel 相容歌單，左側為「整場直播有人點」，右側為「最多人點 / 點歌次數」。
- `exports/sessions/`

錯誤日誌：

- `logs/error.log`

CSV 會處理逗號、換行與雙引號 escaping，避免留言內容破壞欄位格式。

每場直播的資料夾也會輸出 `song-sheet.csv` 與 `<label>_song-sheet.csv`。`SHEET_TOP_LIMIT` 可控制右側「最多人點」最多列出幾首，預設 30。若沒有任何歌曲被點超過 1 次，右側會改列目前點歌排行，避免報表空白。

`exports/messages.csv` 可用 `messageType` 或 `isSongRequest` 篩選：

- `messageType=song_request` / `isSongRequest=true`：被判定為點歌，已統計。
- `messageType=uncertain_candidate` / `isSongRequest=false`：疑似歌名，但因未命中歌名庫或信心不足，所以未統計。
- `messageType=chat` / `isSongRequest=false`：一般聊天；只有在 `ENABLE_CHAT_MESSAGE_LOG=true` 時才會被保存。

## 點歌辨識邏輯

系統使用三層判斷：

1. 高信心：留言包含明確請求語意，例如 `可以唱`、`想聽`、`播`、`來一首`、`點歌`、`幫我唱`，且候選歌名有效。
2. 高信心：留言直接命中 `config/songCatalog.json` 或 `config/songAliases.json`。
3. 候選但不統計：短留言看起來像歌名，但未命中歌名庫。

排除詞設定在 `config/blacklistWords.json`，例如 `哈哈`、`笑死`、`好聽`、`謝謝`、`666`。若留言沒有明確點歌語意且命中排除詞，不會列入點歌。

解析後會清洗歌名並產生 `normalizedSong`：去除標點、合併空白、英文轉小寫、移除前後語氣詞，只保留中文、英文與數字。空字串不會統計。

## 測試

此版本包含 parser 測試：

```bash
npm test
```

測試涵蓋：

- 直接歌名命中
- 明確點歌句
- 常見聊天誤判排除
- 否定句排除
- 未知短候選不直接統計

## 已知限制

- `tiktok-live-connector` 依賴 TikTok 公開 LIVE 介面，平台變更可能導致連線失敗。
- 自然語言辨識無法完全避免誤判或漏判。
- 高精準度設定會降低誤判，但會提高漏判率。
- `songCatalog.json` 品質越高，統計結果越準。
- 大型長時間直播的 `messages.jsonl` 可能持續變大，建議定期封存或輪替。
- 未開直播、直播結束或網路中斷時，系統只會等待後自動重連，不會嘗試繞過平台限制。
