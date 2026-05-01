#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CATALOG_PATH = path.join(ROOT, 'config', 'songCatalog.json');
const SEED_PATH = path.join(ROOT, 'config', 'songCatalog.seed.zh-en.json');
const SOURCES_PATH = path.join(ROOT, process.env.SOURCE_FILE || 'config/songCatalog.sources.json');
const REPORT_DIR = path.join(ROOT, 'exports');
const TARGET = Number(process.env.TARGET_SONG_COUNT || 2000);
const REQUIRE_CJK = String(process.env.REQUIRE_CJK || 'false').toLowerCase() === 'true';

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function readJsonArray(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try { const data = JSON.parse(fs.readFileSync(filePath, 'utf8')); return Array.isArray(data) ? data : []; }
  catch (err) { console.warn(`[WARN] Failed to read JSON array: ${filePath}`, err.message); return []; }
}
function readSources(filePath) { const data = JSON.parse(fs.readFileSync(filePath, 'utf8')); return Array.isArray(data) ? data : data.sources || []; }
function decodeHtml(input) { return String(input || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }
function stripHtml(html) { return decodeHtml(html).replace(/<script[\s\S]*?<\/script>/gi, '\n').replace(/<style[\s\S]*?<\/style>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>|<\/div>|<\/tr>|<\/li>|<\/h\d>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\r/g, '\n').replace(/\n{2,}/g, '\n'); }
function normalizeTitle(title) {
  let t = String(title || '').trim();
  t = decodeHtml(t).replace(/[\u200B-\u200D\uFEFF]/g, '');
  t = t.replace(/^[\s\-–—:：]+|[\s\-–—:：]+$/g, '');
  t = t.replace(/\s*[-–—]\s*(Official|MV|Music Video|Lyric Video|Lyrics|Audio|Visualizer).*$/i, '');
  t = t.replace(/\s*[（(]\s*(Official|MV|Music Video|Lyric Video|Lyrics|Audio|Visualizer|Live|Cover|DJ版|Remix|完整版|純音樂|纯音乐)[^）)]*[）)]\s*/gi, '');
  t = t.replace(/\s*[（(]\s*(電影|电影|電視劇|电视剧|影集|劇集|主題曲|插曲|片尾曲|片頭曲|片头曲)[^）)]*[）)]\s*/gi, '');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}
function hasCjk(str) { return /[\u3400-\u9fff]/.test(str); }
function isLikelySongTitle(title) {
  if (!title) return false;
  const t = title.trim();
  if (t.length < 2 || t.length > 70) return false;
  if (REQUIRE_CJK && !hasCjk(t)) return false;
  if (!/[\u3400-\u9fffA-Za-z0-9]/.test(t)) return false;
  const bad = ['youtube','spotify','itunes','home','charts','artists','countries','streams','views','playlist','weekly','daily','worldwide','trending','login','save this search','reset all filters','content type','source:','read more','official teaser trailer','trailer','podcast'];
  const lower = t.toLowerCase();
  if (bad.some(word => lower.includes(word))) return false;
  if (/^\d+[\s,.:-]/.test(t) || /^[\d,]+$/.test(t) || /^pos\b/i.test(t) || /^\d{1,2}:\d{2}$/.test(t)) return false;
  return true;
}
function extractFromText(text) {
  const out = [];
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  for (const line of lines) {
    if (line.includes(' - ')) {
      const parts = line.split(/\s+-\s+/);
      const title = normalizeTitle(parts.slice(1).join(' - '));
      if (isLikelySongTitle(title)) out.push(title);
      continue;
    }
    const cleaned = normalizeTitle(line);
    if (isLikelySongTitle(cleaned) && (hasCjk(cleaned) || /^[A-Za-z0-9'’!?.:&+\- ]{2,45}$/.test(cleaned))) out.push(cleaned);
  }
  return out;
}
function extractSpotifyEmbedTitles(html) {
  const out = [];
  for (const m of html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)) {
    const title = normalizeTitle(stripHtml(m[1])); if (isLikelySongTitle(title)) out.push(title);
  }
  for (const m of html.matchAll(/###\s*([^\n<]+)/g)) {
    const title = normalizeTitle(m[1]); if (isLikelySongTitle(title)) out.push(title);
  }
  return out;
}
function dedupeKey(title) { return String(title || '').toLowerCase().replace(/[\s\-–—_.,，。!?！？:：;；'"“”‘’()（）\[\]【】<>《》]/g, '').replace(/臺/g, '台').replace(/妳/g, '你').trim(); }
function uniqueMerge(...arrays) {
  const seen = new Set(), result = [];
  for (const arr of arrays) for (const raw of arr || []) {
    const title = normalizeTitle(raw); if (!isLikelySongTitle(title)) continue;
    const key = dedupeKey(title); if (!key || seen.has(key)) continue;
    seen.add(key); result.push(title);
  }
  return result;
}
async function fetchSource(source) {
  const res = await fetch(source.url, { headers: { 'User-Agent': 'Mozilla/5.0 song-catalog-collector/1.0', 'Accept': 'text/html,application/xhtml+xml' }});
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const extracted = extractFromText(stripHtml(html));
  const spotify = source.type === 'spotify-embed' ? extractSpotifyEmbedTitles(html) : [];
  return uniqueMerge(extracted, spotify);
}
async function main() {
  ensureDir(path.dirname(CATALOG_PATH)); ensureDir(REPORT_DIR);
  const existing = readJsonArray(CATALOG_PATH), seed = readJsonArray(SEED_PATH), sources = readSources(SOURCES_PATH);
  const sourceReports = [], sourceSongs = [];
  for (const source of sources) {
    try { console.log(`[FETCH] ${source.name}`); const songs = await fetchSource(source); sourceReports.push({ ...source, ok: true, count: songs.length, sample: songs.slice(0, 10) }); sourceSongs.push(...songs); console.log(`  -> ${songs.length} candidates`); }
    catch (err) { sourceReports.push({ ...source, ok: false, error: err.message }); console.warn(`  -> failed: ${err.message}`); }
  }
  const merged = uniqueMerge(existing, seed, sourceSongs).slice(0, TARGET);
  const backupPath = CATALOG_PATH.replace(/\.json$/, `.backup-${Date.now()}.json`);
  if (fs.existsSync(CATALOG_PATH)) fs.copyFileSync(CATALOG_PATH, backupPath);
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(merged, null, 2), 'utf8');
  const report = { generatedAt: new Date().toISOString(), target: TARGET, requireCjk: REQUIRE_CJK, existingCount: existing.length, seedCount: seed.length, sourceCandidateCount: uniqueMerge(sourceSongs).length, finalCount: merged.length, reachedTarget: merged.length >= TARGET, catalogPath: CATALOG_PATH, backupPath: fs.existsSync(backupPath) ? backupPath : null, sources: sourceReports };
  const reportPath = path.join(REPORT_DIR, `song-catalog-collector-report-${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log('\n[DONE]'); console.log(`Final catalog count: ${merged.length}/${TARGET}`); console.log(`Written: ${CATALOG_PATH}`); console.log(`Report: ${reportPath}`);
  if (merged.length < TARGET) console.log('\n[NOTE] Public sources did not provide enough unique titles to reach target. Add sources or rerun later.');
}
main().catch(err => { console.error('[FATAL]', err); process.exit(1); });
