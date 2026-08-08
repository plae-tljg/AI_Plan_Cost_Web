import { fetchText, parseFloatCell, nowIso } from './common.js';

function cellsOf(rowHtml) {
  const m = rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g);
  return [...m].map((x) => x[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
}

const LABEL_PATTERNS = [
  [/缓存命中|cache hit/i, 'hit'],
  [/缓存未命中|cache miss/i, 'miss'],
  [/百万tokens输出|1m output tokens|output token/i, 'out'],
];

export async function scrapeDeepSeek(config) {
  const url = config.sources.deepseek.url;
  const html = await fetchText(url);
  const rows = html.match(/<tr[\s\S]*?<\/tr>/g) || [];
  const table = rows.map(cellsOf).filter((r) => r.length > 0);

  let headerRow = null;
  for (const r of table) {
    if (r.some((c) => /^模型$|^model$/i.test(c))) {
      headerRow = r;
      break;
    }
  }
  if (!headerRow) throw new Error('DeepSeek: MODEL header row not found');

  const startIdx = headerRow.findIndex((c) => /^模型$|^model$/i.test(c));
  const modelNames = headerRow.slice(startIdx + 1).map((c) => c.toLowerCase());

  const idxByKey = {};
  for (const r of table) {
    let key = null;
    let idx = -1;
    for (const pat of LABEL_PATTERNS) {
      idx = r.findIndex((c) => pat[0].test(c));
      if (idx >= 0) {
        key = pat[1];
        break;
      }
    }
    if (!key || idxByKey[key]) continue;
    const vals = r.slice(idx + 1);
    if (vals.length && vals.some((v) => /\d/.test(v))) idxByKey[key] = vals;
  }

  // 中文页为人民币(元), 英文页为美元($), 按首个价格字符判断
  const sample = Object.values(idxByKey).flat().find((v) => /[0-9]/.test(v)) || '';
  const isCny = /元|¥|￥/.test(sample);
  const currency = isCny ? 'cny' : 'usd';
  const unitLabel = isCny ? '元/1M tokens' : 'USD/1M tokens';

  const entries = [];
  modelNames.forEach((name, i) => {
    const cell = (k) => (idxByKey[k] ? parseFloatCell(idxByKey[k][i]) : null);
    const miss = cell('miss');
    const out = cell('out');
    if (miss == null || out == null) return;
    entries.push({
      id: `deepseek:${name}@official`,
      model: name,
      provider: 'deepseek',
      channel: 'official',
      source: 'deepseek-official',
      origin_currency: currency,
      source_url: url,
      input_cache_hit: cell('hit'),
      input_cache_miss: miss,
      output: out,
      currency,
      context: 1048576,
      modality: ['text'],
      benchmark: true,
      free: false,
      note: `官方按量计价 (${unitLabel})`,
    });
  });

  return { entries, url, fetched_at: nowIso(), count: entries.length };
}
