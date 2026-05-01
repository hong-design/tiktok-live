import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const catalogPath = path.join(root, 'config', 'songCatalog.json');
const additionsPath = path.join(root, 'config', 'songCatalog.additions.mass.zh-tw.json');
const aliasPath = path.join(root, 'config', 'songAliases.json');
const aliasAddPath = path.join(root, 'config', 'songAliases.mass.zh-tw.json');

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function dedupeKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s\-—_，,。.!！?？:：;；「」『』()（）\[\]【】/\\]/g, '')
    .trim();
}

function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

const current = readJson(catalogPath, []);
if (!fs.existsSync(additionsPath)) {
  console.error(`Missing additions file: ${additionsPath}`);
  console.error('Expected config/songCatalog.additions.mass.zh-tw.json before running this script.');
  process.exit(1);
}
const additions = readJson(additionsPath, []);
if (!Array.isArray(current) || !Array.isArray(additions)) {
  throw new Error('songCatalog.json and songCatalog.additions.mass.zh-tw.json must be JSON arrays');
}

const seen = new Set();
const merged = [];
for (const song of [...current, ...additions]) {
  const clean = String(song || '').trim();
  const key = dedupeKey(clean);
  if (!clean || !key || seen.has(key)) continue;
  seen.add(key);
  merged.push(clean);
}

ensureDir(catalogPath);
if (fs.existsSync(catalogPath)) {
  const backup = catalogPath.replace(/\.json$/, `.backup-${Date.now()}.json`);
  fs.copyFileSync(catalogPath, backup);
  console.log(`Backup created: ${backup}`);
}
fs.writeFileSync(catalogPath, JSON.stringify(merged, null, 2), 'utf8');
console.log(`Merged catalog written: ${catalogPath}`);
console.log(`Total songs: ${merged.length}`);

const currentAliases = readJson(aliasPath, {});
const addAliases = readJson(aliasAddPath, {});
const mergedAliases = { ...currentAliases, ...addAliases };
ensureDir(aliasPath);
if (fs.existsSync(aliasPath)) {
  const backup = aliasPath.replace(/\.json$/, `.backup-${Date.now()}.json`);
  fs.copyFileSync(aliasPath, backup);
  console.log(`Alias backup created: ${backup}`);
}
fs.writeFileSync(aliasPath, JSON.stringify(mergedAliases, null, 2), 'utf8');
console.log(`Merged aliases written: ${aliasPath}`);
console.log(`Total aliases: ${Object.keys(mergedAliases).length}`);
