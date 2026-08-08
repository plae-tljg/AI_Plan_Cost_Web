import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export async function fetchText(url, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
        Accept: 'text/html,application/xhtml+xml,application/json,*/*;q=0.8',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson(url, timeoutMs = 30000) {
  return JSON.parse(await fetchText(url, timeoutMs));
}

export function readJson(relPath) {
  const p = path.join(ROOT, relPath);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function writeJson(relPath, data) {
  const p = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
  return p;
}

export function writeJs(relPath, code) {
  const p = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, code);
  return p;
}

export function nowIso() {
  return new Date().toISOString();
}

/** 从单元格文本中取最后一个数值, 处理 "~~4.20~~ 2.10" / "$0.0028" / "2.1" 等 */
export function parseFloatCell(cell) {
  const m = String(cell ?? '').match(/\d+(?:\.\d+)?/g);
  if (!m) return null;
  return parseFloat(m[m.length - 1]);
}

/** openrouter id "xiaomi/mimo-v2.5" -> "mimo-v2.5" */
export function modelBaseSlug(id) {
  const s = String(id).replace(/@openrouter$/, '');
  return s.split('/').pop() || s;
}
