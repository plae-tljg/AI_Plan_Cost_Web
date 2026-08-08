import { fetchText, parseFloatCell, nowIso } from './common.js';

export async function scrapeMiniMax(config) {
  const page = config.sources.minimax.pricing_page;
  const md = await fetchText(page);

  const lines = md.split('\n');
  const rows = [];
  let inLang = false;
  let inHistory = false;

  for (const line of lines) {
    if (/^##\s+语言模型/.test(line)) {
      inLang = true;
      continue;
    }
    if (inLang && /^##\s+语音/.test(line)) break;
    if (!inLang) continue;
    if (/历史模型|Accordion/.test(line)) {
      inHistory = true;
      continue;
    }
    if (!line.trim().startsWith('|') || inHistory) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim())
      .filter((c) => c.length);
    if (cells.length < 4) continue;
    const name = (cells[0].replace(/\*\*/g, '').match(/MiniMax-M[\d][\w.-]*/) || [])[0];
    if (!name) continue;
    const nums = cells.map(parseFloatCell);
    rows.push({ name, input: nums[1], output: nums[2], cache: nums[3], raw: cells[0] });
  }

  // 同一模型取第一次出现(标准档), 跳过优先档/历史档
  const seen = new Set();
  const entries = [];
  for (const r of rows) {
    if (seen.has(r.name)) continue;
    seen.add(r.name);
    if (r.input == null || r.output == null) continue;
    entries.push({
      id: `minimax:${r.name.toLowerCase()}@official`,
      model: r.name.toLowerCase(),
      provider: 'minimax',
      channel: 'official',
      source: 'minimax-official',
      origin_currency: 'cny',
      source_url: page,
      input_cache_hit: r.cache,
      input_cache_miss: r.input,
      output: r.output,
      currency: 'cny',
      context: /m3/.test(r.name) ? 512000 : null,
      modality: ['text'],
      benchmark: false,
      free: false,
      note: `官方按量计价 (元/1M tokens)`,
    });
  }

  return { entries, url: page, fetched_at: nowIso(), count: entries.length };
}
