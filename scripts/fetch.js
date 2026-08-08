import { scrapeOpenRouter } from './lib/openrouter.js';
import { scrapeDeepSeek } from './lib/deepseek.js';
import { scrapeMiniMax } from './lib/minimax.js';
import { scrapeXiaomi } from './lib/xiaomi.js';
import { readJson, writeJson, writeJs, nowIso, modelBaseSlug, fetchJson } from './lib/common.js';

const config = readJson('config.json');

async function run(fn, cfg) {
  const meta = { ok: true, error: null, count: 0, fetched_at: null, url: null };
  try {
    const res = await fn(cfg);
    meta.count = res.count;
    meta.fetched_at = res.fetched_at;
    meta.url = res.url;
    return { entries: res.entries, meta };
  } catch (err) {
    meta.ok = false;
    meta.error = String(err?.message || err);
    return { entries: [], meta };
  }
}

/** 抓取 USD->CNY 汇率; 失败返回 null(由调用方回退到配置默认值) */
async function fetchFx(config) {
  const meta = { ok: true, error: null, count: 1, fetched_at: nowIso(), url: config.sources.fx.url };
  try {
    const data = await fetchJson(config.sources.fx.url);
    const path = (config.fx.rate_path || 'rates.CNY').split('.');
    let v = data;
    for (const p of path) v = v?.[p];
    v = Number(v);
    if (!isFinite(v) || v <= 0) throw new Error('bad FX rate from API');
    const round = Number(config.fx.round_to ?? 3);
    return { fx: Number(v.toFixed(round)), meta };
  } catch (err) {
    meta.ok = false;
    meta.error = String(err?.message || err);
    meta.count = 0;
    return { fx: null, meta };
  }
}

function normalizeOfficial(entries, fx) {
  return entries.map((e) => {
    const out = { ...e };
    if (out.currency === 'cny') {
      const cnyIn = out.input_cache_miss;
      const cnyOut = out.output;
      out.input_cache_hit = out.input_cache_hit != null ? out.input_cache_hit / fx : null;
      out.input_cache_miss = out.input_cache_miss / fx;
      out.output = out.output / fx;
      out.currency = 'usd';
      out.note = `官方按量计价 (CNY ¥${cnyIn}/${cnyOut}/1M → USD @ ${fx})`;
    }
    return out;
  });
}

function crossFillMeta(officialEntries, openrouterEntries) {
  const bySlug = new Map();
  for (const e of openrouterEntries) {
    if (!bySlug.has(e.model)) bySlug.set(e.model, e);
  }
  return officialEntries.map((e) => {
    const src = bySlug.get(e.model);
    if (!src) return e;
    return {
      ...e,
      context: e.context ?? src.context,
      modality: e.modality && e.modality.length ? e.modality : src.modality,
      benchmark: e.benchmark || src.benchmark,
    };
  });
}

async function main() {
  const generated_at = nowIso();
  const sources = {};

  // 先抓实时汇率(用于 Minimax 官方人民币换算 + 页面展示); 失败则用配置默认值
  const fxRes = await fetchFx(config);
  sources.fx = fxRes.meta;
  const fx = fxRes.fx ?? (Number(config.fx?.fallback_usd_per_cny) || 7.2);

  const or = await run(scrapeOpenRouter, config);
  sources.openrouter = or.meta;
  const openrouterEntries = or.entries;

  const ds = await run(scrapeDeepSeek, config);
  sources.deepseek = ds.meta;
  const dsEntries = ds.entries;

  const mm = await run(scrapeMiniMax, config);
  sources.minimax = mm.meta;
  const mmEntries = mm.entries;

  const xm = await run(scrapeXiaomi, config);
  sources.xiaomi = xm.meta;
  const xmEntries = xm.entries;

  let officialEntries = [...dsEntries, ...mmEntries, ...xmEntries];
  officialEntries = normalizeOfficial(officialEntries, fx);
  officialEntries = crossFillMeta(officialEntries, openrouterEntries);

  // 保证输出确定性: 只有价格/模型真正变化时才产生 diff, 避免"仅时间戳变化"导致天天 commit
  openrouterEntries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  officialEntries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // data/meta.json 含时间戳, 仅作本地诊断用 -> 已加入 .gitignore
  const metaPath = writeJson('data/meta.json', { generated_at, fx, sources });
  const openrouterPath = writeJson('data/models.json', openrouterEntries);
  const officialPath = writeJson('data/official.json', officialEntries);

  // 浏览器 bundle: 只放确定性字段, 时间戳会污染 diff
  const bundleMeta = {
    fx,
    sources: Object.fromEntries(
      Object.entries(sources).map(([k, v]) => [k, { ok: v.ok, count: v.count, url: v.url }]),
    ),
  };
  const bundleData = {
    config,
    models: openrouterEntries,
    official: officialEntries,
    meta: bundleMeta,
  };
  const bundlePath = writeJs('assets/data.js', 'window.PRICING_DATA = ' + JSON.stringify(bundleData) + ';\n');

  console.log(`[${generated_at}] fx = 1 USD = ${fx} CNY`);
  for (const [k, s] of Object.entries(sources)) {
    const status = s.ok ? `ok (${s.count} entries)` : `FAILED: ${s.error}`;
    console.log(`  ${k.padEnd(11)} ${status}`);
  }
  console.log(`\n  openrouter -> ${openrouterPath}`);
  console.log(`  official   -> ${officialPath}`);
  console.log(`  meta       -> ${metaPath}`);
  console.log(`  bundle     -> ${bundlePath}`);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
