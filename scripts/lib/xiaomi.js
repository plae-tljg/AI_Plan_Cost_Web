import { fetchText, nowIso } from './common.js';

const TITLE_RE = /<h4 class="Models_modelTitle__[^"]*">([^<]*MiMo-V2\.5[^<]*)<\/h4>/g;
const H4_OPEN_RE = /<h4 class="Models_modelTitle__[^"]*">/g;
const PRICE_RE =
  /<span class="Models_label__[^"]*">([^<]*)<\/span>\s*<span class="Models_price__[^"]*">\$([0-9.]+)/g;

export async function scrapeXiaomi(config) {
  const url = config.sources.xiaomi.url;
  const html = await fetchText(url);

  const positions = [...html.matchAll(H4_OPEN_RE)].map((m) => m.index);
  const cards = [];
  for (let i = 0; i < positions.length; i++) {
    const seg = html.slice(positions[i], i + 1 < positions.length ? positions[i + 1] : html.length);
    const title = (seg.match(TITLE_RE) || [])[0]?.replace(/<[^>]+>/g, '')?.trim();
    if (!title) continue;
    cards.push({ title, seg });
  }

  const seen = new Set();
  const entries = [];
  for (const { title, seg } of cards) {
    const price = {};
    for (const m of seg.matchAll(PRICE_RE)) {
      const label = m[1];
      const val = parseFloat(m[2]);
      if (/cache hit/i.test(label)) price.hit = val;
      else if (/cache miss/i.test(label)) price.miss = val;
      else if (/^output/i.test(label)) price.out = val;
    }
    if (price.miss == null || price.out == null) continue; // 跳过 TTS / ASR
    const slug = title.toLowerCase().replace(/\s+/g, '-');
    if (seen.has(slug)) continue; // 页面同时含中英文两套卡片
    seen.add(slug);
    entries.push({
      id: `xiaomi:${slug}@official`,
      model: slug,
      provider: 'xiaomi',
      channel: 'official',
      source: 'xiaomi-official',
      origin_currency: 'usd',
      source_url: url,
      input_cache_hit: price.hit ?? null,
      input_cache_miss: price.miss,
      output: price.out,
      currency: 'usd',
      context: 1050000,
      modality: slug === 'mimo-v2.5' ? ['text', 'image', 'audio', 'video'] : ['text'],
      benchmark: true,
      free: false,
      note: `官方按量计价 (USD/1M tokens)`,
    });
  }

  return { entries, url, fetched_at: nowIso(), count: entries.length };
}
