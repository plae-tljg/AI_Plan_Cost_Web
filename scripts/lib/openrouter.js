import { fetchJson, modelBaseSlug, nowIso } from './common.js';

/** 从 canonical_slug(如 deepseek-v4-flash-20260731)或 id 尾巴(如 flash-0731)提取版本号, 如 "0731" */
function extractVersion(m) {
  const slug = m.canonical_slug || m.id || '';
  const m8 = slug.match(/-(\d{8})$/);
  if (m8) {
    const d = m8[1];
    return `${d.slice(4, 6)}${d.slice(6, 8)}`;
  }
  const id = m.id || '';
  const m4 = id.match(/-(\d{2})(\d{2})$/);
  if (m4) return m4[1] + m4[2];
  return null;
}

export async function scrapeOpenRouter(config) {
  const url = config.sources.openrouter.url;
  const data = await fetchJson(url);
  const list = Array.isArray(data) ? data : data.data || [];
  const entries = [];
  for (const m of list) {
    const id = m.id;
    if (!id || String(id).startsWith('~')) continue;
    const p = m.pricing || {};
    const miss = parseFloat(p.prompt);
    const out = parseFloat(p.completion);
    if (!isFinite(miss) || !isFinite(out) || miss < 0 || out < 0) continue;
    if (miss === 0 && out === 0 && !m.architecture) continue;
    const hitRaw = parseFloat(p.input_cache_read ?? p.prompt);
    const hit = isFinite(hitRaw) ? hitRaw : null;
    const mods = (m.architecture && m.architecture.input_modalities) || [];
    const bench =
      !!(m.benchmarks && typeof m.benchmarks === 'object' && Object.keys(m.benchmarks).length);
    entries.push({
      id: `${id}@openrouter`,
      model: modelBaseSlug(id),
      provider: String(id).split('/')[0] || 'unknown',
      channel: 'openrouter',
      source: 'openrouter',
      origin_currency: 'usd',
      version: extractVersion(m),
      source_url: `https://openrouter.ai/${id}`,
      input_cache_hit: hit !== null ? hit * 1e6 : null,
      input_cache_miss: miss * 1e6,
      output: out * 1e6,
      currency: 'usd',
      context: m.context_length ?? null,
      modality: mods,
      benchmark: bench,
      free: miss === 0 && out === 0,
      note: '',
    });
  }
  return {
    entries,
    url,
    fetched_at: nowIso(),
    count: entries.length,
  };
}
