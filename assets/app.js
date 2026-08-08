(() => {
  'use strict';

  const D = window.PRICING_DATA || {};
  const config = D.config || {};
  const bundled = {
    config,
    models: D.models || [],
    official: D.official || [],
    meta: D.meta || { fx: null, sources: {} },
  };

  const state = {
    models: bundled.models,
    official: bundled.official,
    meta: bundled.meta,
    currency: config.currency_default || 'usd',
    fx: bundled.meta.fx || config.fx?.fallback_usd_per_cny || 7.2,
    sort: { key: 'output', dir: 1 },
    filters: { q: '', provider: '', channel: '', modality: '', featured: false },
    calc: null, // { in, out, hit, budget } 或 null
    live: false,
  };

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  const dataCounts = () =>
    `OpenRouter ${state.models.length} 个 · 官方 ${state.official.length} 个`;

  const updateFxChip = () => {
    $('#meta-fx').textContent = `1 USD ≈ ¥${state.fx.toFixed(2)} (自动抓取)`;
  };

  const MOD_SHORT = { text: '文', image: '图', audio: '音', video: '视', file: '文件' };
  const featuredKeys = new Set((config.featured || []).map((f) => f.id));

  function isFeatured(e) {
    return e.channel === 'openrouter' && featuredKeys.has(`${e.provider}/${e.model}`);
  }

  function fmtPrice(v) {
    if (v == null) return '—';
    const x = state.currency === 'cny' ? v * state.fx : v;
    const sym = state.currency === 'cny' ? '¥' : '$';
    if (x >= 100) return sym + x.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (x >= 1) return sym + x.toFixed(2);
    if (x >= 0.01) return sym + x.toFixed(3);
    return sym + x.toFixed(4);
  }

  function fmtCtx(n) {
    if (!n) return '—';
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return Math.round(n / 1e3) + 'K';
    return String(n);
  }

  function fmtMods(arr) {
    if (!arr || !arr.length) return '—';
    return arr.map((m) => `<b>${MOD_SHORT[m] || m}</b>`).join(' ');
  }

  // ---- 数据加载 ----

  async function liveFetchOpenRouter() {
    if (!/^https?:$/.test(location.protocol)) return false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : data.data || [];
      const entries = [];
      for (const m of list) {
        const id = m.id;
        if (!id || String(id).startsWith('~')) continue;
        const p = m.pricing || {};
        const miss = parseFloat(p.prompt);
        const out = parseFloat(p.completion);
        if (!isFinite(miss) || !isFinite(out) || miss < 0 || out < 0) continue;
        const hit = isFinite(parseFloat(p.input_cache_read))
          ? parseFloat(p.input_cache_read) * 1e6
          : null;
        entries.push({
          id: `${id}@openrouter`,
          model: String(id).split('/').pop(),
          provider: String(id).split('/')[0],
          channel: 'openrouter',
          source: 'openrouter',
          input_cache_hit: hit,
          input_cache_miss: miss * 1e6,
          output: out * 1e6,
          currency: 'usd',
          context: m.context_length ?? null,
          modality: (m.architecture && m.architecture.input_modalities) || [],
          benchmark: !!(m.benchmarks && Object.keys(m.benchmarks).length),
          free: miss === 0 && out === 0,
          note: '',
        });
      }
      state.models = entries;
      state.meta = { ...state.meta, live: true };
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  // ---- 过滤 / 排序 / 成本 ----

  function applyCalc() {
    for (const e of state.models) e._cost = null;
    for (const e of state.official) e._cost = null;
    if (!state.calc) return;
    const { in: inM, out: outM, hit, budget } = state.calc;
    const hitF = hit / 100;
    const compute = (e) => {
      const inCost =
        (inM * hitF) * (e.input_cache_hit ?? 0) + (inM * (1 - hitF)) * (e.input_cache_miss ?? 0);
      const outCost = outM * (e.output ?? 0);
      const cost = inCost + outCost;
      return { cost, inCost, outCost };
    };
    for (const e of [...state.models, ...state.official]) {
      const { cost, inCost } = compute(e);
      e._cost = cost;
      e._budgetOut = budget && e.output > 0 ? Math.max(0, (budget - inCost) / e.output) : null;
    }
  }

  function filtered() {
    const { q, provider, channel, modality, featured } = state.filters;
    const ql = q.trim().toLowerCase();
    let list = [...state.models, ...state.official];
    list = list.filter((e) => {
      if (provider && e.provider !== provider) return false;
      if (channel && e.channel !== channel) return false;
      if (modality && !(e.modality || []).includes(modality)) return false;
      if (featured && !isFeatured(e)) return false;
      if (ql) {
        const hay = `${e.model} ${e.provider} ${e.note || ''} ${e.channel}`.toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      return true;
    });
    // 同族(厂商+模型)在多个渠道时, 只标出严格更便宜的渠道
    const fam = new Map();
    for (const e of list) {
      const key = `${e.provider}/${e.model}`;
      let rec = fam.get(key);
      if (!rec) {
        rec = { min: Infinity, max: -Infinity, channels: new Set() };
        fam.set(key, rec);
      }
      rec.min = Math.min(rec.min, e.output ?? Infinity);
      rec.max = Math.max(rec.max, e.output ?? -Infinity);
      rec.channels.add(e.channel);
    }
    for (const e of list) {
      const rec = fam.get(`${e.provider}/${e.model}`);
      e._cheapestChannel =
        rec.channels.size > 1 && rec.min < rec.max && e.output === rec.min;
    }
    const { key, dir } = state.sort;
    const numKeys = new Set([
      'input_cache_hit',
      'input_cache_miss',
      'output',
      'context',
      'cost',
    ]);
    list.sort((a, b) => {
      let av = a[key];
      let bv = b[key];
      if (key === 'benchmark') {
        av = a.benchmark ? 1 : 0;
        bv = b.benchmark ? 1 : 0;
      } else if (key === 'channel') {
        av = a.channel === 'official' ? 1 : 0;
        bv = b.channel === 'official' ? 1 : 0;
      } else if (key === 'modality') {
        av = (a.modality || []).length;
        bv = (b.modality || []).length;
      } else if (numKeys.has(key)) {
        av = av == null ? Infinity : av;
        bv = bv == null ? Infinity : bv;
      }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return cmp * dir;
    });
    return list;
  }

  // ---- 渲染 ----

  function channelBadge(e) {
    if (e.channel === 'openrouter') return '<span class="badge or">OR</span>';
    if (e.free) return '<span class="badge off">官方</span>';
    return '<span class="badge off">官方</span>';
  }

  function priceCell(e, field, minVal) {
    const v = e[field];
    if (v == null) return '<td class="num"><span class="muted">—</span></td>';
    const isMin = v === minVal;
    return `<td class="num"><span class="price ${isMin ? 'min' : ''}">${fmtPrice(v)}</span></td>`;
  }

  function render() {
    applyCalc();
    const list = filtered();
    const hasCalc = !!state.calc;

    const mins = {
      input_cache_hit: null,
      input_cache_miss: null,
      output: null,
      cost: null,
    };
    for (const e of list) {
      for (const k of Object.keys(mins)) {
        const v = e[k === 'cost' ? '_cost' : k];
        if (v == null) continue;
        if (mins[k] == null || v < mins[k]) mins[k] = v;
      }
    }

    const rows = list.map((e) => {
      const cheapChip = e._cheapestChannel
        ? '<span class="badge free" title="该模型在多个渠道中, 此渠道输出价最低">更便宜</span>'
        : '';
      const benchBadge = e.benchmark
        ? '<span class="badge bench">有</span>'
        : '<span class="badge nobench">—</span>';
      const mods = fmtMods(e.modality);
      let costTd = '<td class="num"><span class="muted">—</span></td>';
      if (hasCalc && e._cost != null) {
        const cls = e._cost === mins.cost ? 'min' : e._budgetOut != null && e._budgetOut <= 0 ? 'bad' : '';
        const t = fmtPrice(e._cost);
        const budgetNote =
          e._budgetOut != null ? ` <span class="muted" title="预算内可承担的月输出">(${fmtCtx(e._budgetOut * 1e6)}out)</span>` : '';
        costTd = `<td class="num cost"><span class="price ${cls}">${t}</span>${budgetNote}</td>`;
      }
      return `<tr>
        <td class="model">${e.model} ${cheapChip} ${isFeatured(e) ? '<span class="badge bench" title="精选短名单">★</span>' : ''}</td>
        <td class="provider">${e.provider}</td>
        <td>${channelBadge(e)}</td>
        ${priceCell(e, 'input_cache_hit', mins.input_cache_hit)}
        ${priceCell(e, 'input_cache_miss', mins.input_cache_miss)}
        ${priceCell(e, 'output', mins.output)}
        ${costTd}
        <td class="num">${fmtCtx(e.context)}</td>
        <td class="modality">${mods}</td>
        <td>${benchBadge}</td>
        <td class="muted" style="white-space:normal">${e.note || ''}</td>
      </tr>`;
    });

    $('#tbody').innerHTML = rows.join('');
    $('#row-count').textContent = `${list.length} 个模型`;

    $$('thead th[data-k]').forEach((th) => {
      const k = th.dataset.k;
      const active = state.sort.key === k;
      th.classList.toggle('sorted', active);
      th.dataset.arrow = active ? (state.sort.dir === 1 ? '▲' : '▼') : '';
    });

    $('#calc-result').innerHTML = hasCalc
      ? `已按 输入 ${state.calc.in}M · 输出 ${state.calc.out}M · 命中 ${state.calc.hit}% 估算。绿色=最低月成本。`
      : '未应用工作量。点击「应用工作量」后按月成本排序。';
  }

  // ---- 控件 ----

  function buildSelects() {
    const all = [...state.models, ...state.official];
    const providers = [...new Set(all.map((e) => e.provider))].sort();
    const mods = [...new Set(all.flatMap((e) => e.modality || []))].sort();
    $('#f-provider').innerHTML =
      '<option value="">厂商: 全部</option>' +
      providers.map((p) => `<option value="${p}">${p}</option>`).join('');
    $('#f-modality').innerHTML =
      '<option value="">模态: 全部</option>' +
      mods
        .map((m) => `<option value="${m}">${MOD_SHORT[m] || m} (${m})</option>`)
        .join('');
  }

  function bind() {
    $('#btn-calc').addEventListener('click', () => {
      const budgetInput = parseFloat($('#calc-budget').value) || null;
      // 预算输入按当前展示货币理解; 内部计算统一用 USD
      const budgetUSD =
        budgetInput == null
          ? null
          : state.currency === 'cny'
            ? budgetInput / state.fx
            : budgetInput;
      state.calc = {
        in: parseFloat($('#calc-in').value) || 0,
        out: parseFloat($('#calc-out').value) || 0,
        hit: Math.min(100, Math.max(0, parseFloat($('#calc-hit').value) || 0)),
        budget: budgetUSD,
      };
      state.sort = { key: 'cost', dir: 1 };
      render();
    });
    $('#btn-calc-clear').addEventListener('click', () => {
      state.calc = null;
      state.sort = { key: 'output', dir: 1 };
      render();
    });
    $('#btn-refresh').addEventListener('click', async () => {
      $('#btn-refresh').textContent = '刷新中…';
      const ok = await liveFetchOpenRouter();
      $('#btn-refresh').textContent = '刷新(直连 OpenRouter)';
      if (ok) {
        state.live = true;
        $('#meta-live').classList.remove('hidden');
        $('#meta-updated').textContent = `${dataCounts()} (实时直连)`;
        buildSelects();
        render();
      } else {
        $('#meta-live').textContent = '实时直连失败, 使用缓存';
        $('#meta-live').classList.remove('hidden');
      }
    });

    $('#f-search').addEventListener('input', (ev) => {
      state.filters.q = ev.target.value;
      render();
    });
    $('#f-provider').addEventListener('change', (ev) => {
      state.filters.provider = ev.target.value;
      render();
    });
    $('#f-channel').addEventListener('change', (ev) => {
      state.filters.channel = ev.target.value;
      render();
    });
    $('#f-modality').addEventListener('change', (ev) => {
      state.filters.modality = ev.target.value;
      render();
    });
    $('#f-featured').addEventListener('change', (ev) => {
      state.filters.featured = ev.target.checked;
      render();
    });
    $('#f-currency').addEventListener('change', (ev) => {
      state.currency = ev.target.value;
      render();
    });
    $('#f-fx').addEventListener('change', (ev) => {
      const v = parseFloat(ev.target.value);
      if (v > 0) {
        state.fx = v;
        updateFxChip();
      }
      render();
    });
    $$('thead th[data-k]').forEach((th) => {
      th.addEventListener('click', () => {
        const k = th.dataset.k;
        if (state.sort.key === k) state.sort.dir *= -1;
        else state.sort = { key: k, dir: 1 };
        render();
      });
    });
  }

  function init() {
    $('#tips').innerHTML = (config.tips || []).map((t) => `<li>${t}</li>`).join('');
    $('#meta-updated').textContent = `缓存数据 ${dataCounts()}`;
    updateFxChip();
    $('#f-fx').value = state.fx;
    $('#f-currency').value = state.currency;

    // 默认按 输出价 升序展示, 只显示精选短名单最有用
    state.sort = { key: 'output', dir: 1 };
    buildSelects();
    bind();
    render();

    // 后台尝试实时直连 OpenRouter (http/https 下才可能)
    liveFetchOpenRouter().then((ok) => {
      if (ok) {
        state.live = true;
        $('#meta-live').classList.remove('hidden');
        $('#meta-updated').textContent = `${dataCounts()} (实时直连)`;
        buildSelects();
        render();
      }
    });
  }

  init();
})();
