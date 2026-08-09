# AI Plan Cost Web

零后端静态站，对比 OpenRouter 与官方源的 LLM 单价（每百万 token）。

- 一屏看清几百个 LLM 的输入(命中缓存)/输入(未命中)/输出三档单价
- 官方价格 vs OpenRouter 渠道差价（含官方·CNY / 官方·USD / OR·USD 三种价格口径标记）
- 按月输入/输出/缓存命中算各模型月成本，配 4 种典型用户预设
- 默认人民币计价 + 自动抓取 USD/CNY 实时汇率，换算结果用 `≈` 标注
- GitHub Actions 每天自动更新，部署在 gh-pages 分支，价格历史可直接在分支 commit 里回看

## 快速上手

```bash
git clone https://github.com/plae-tljg/AI_Plan_Cost_Web.git
cd AI_Plan_Cost_Web
node scripts/fetch.js   # 抓数据，零依赖，需要联网
# 然后直接双击 index.html（file:// 可跑）
```

推到 GitHub 后 Settings → Pages → Source 选 **Deploy from branch (gh-pages)**，CI 自动每天 + 每次 push 更新站点。

## 架构

```
scripts/fetch.js  (零依赖 Node 20+ fetch)
   │
   ├─ scripts/lib/openrouter.js   OpenRouter API (384 模型)
   ├─ scripts/lib/deepseek.js     zh-cn 定价页 (CNY 元/百万 token)
   ├─ scripts/lib/minimax.js      paygo md 文档 (CNY 元/百万 token)
   ├─ scripts/lib/xiaomi.js       mimo.mi.com 文档页 (USD)
   ├─ live FX: open.er-api.com/v6/latest/USD
   └─ normalize → USD / 1M tokens (hit / miss / output)
        │
        ▼
   assets/data.js   浏览器 bundle，gitignored，file:// 直接用
        │
        ▼
   index.html + assets/app.js (纯静态前端)
```

## 数据流

- **OpenRouter (USD)**: `/api/v1/models` 拉全量，按价格除以 1M 得到每百万 token 单价；`origin_currency=usd`，含 cache hit/miss 两档。
- **DeepSeek (CNY)**: 抓 `api-docs.deepseek.com/zh-cn/quick_start/pricing` 中文页（元/百万 token），原币保留为 CNY → 展示时精确还原为 ¥1.00 / ¥2.00 等。
- **MiniMax (CNY)**: 抓 `platform.minimaxi.com/docs/guides/pricing-paygo.md`，同样原币 CNY，按官方五折价。
- **Xiaomi MiMo (USD)**: 抓 `mimo.mi.com/docs/price/pay-as-you-go` 文档页（USD 报价）。
- **USD/CNY 汇率**: `open.er-api.com/v6/latest/USD` 每天抓一次（fallback 7.2），用于官方 CNY 价换算为 USD 存储、用户切换货币时的展示。
- **确定性输出**: entries 按 id 排序，去掉所有时间戳，只有价格/模型真正变化时才产生 diff。

## CI/CD

`.github/workflows/fetch.yml`:

1. 触发：每天 UTC 02:17（≈北京时间 10:17）+ 每次 push main + `workflow_dispatch`
2. `npm run fetch` → 重新生成 `data/*.json`（gitignored）+ `assets/data.js`
3. 打包 `_site/`（= index.html + assets/）
4. clone 现有 `gh-pages` 分支 → 与新 `_site` 内容比对
5. **有变化**才 commit + push 到 gh-pages；没变化跳过（避免噪音 commit）
6. GitHub Pages 源 = "Deploy from branch (gh-pages)"，自动接管发布

**核心原则**: `main` 只存代码/结构；`gh-pages` 累积每次部署快照 → 它本身就是价格变更历史。

## 功能

### 表格
- 列：模型 / 厂商 / 渠道(OR·USD / 官方·CNY / 官方·USD) / 输入命中 / 输入未命中 / 输出 / 月成本 / 上下文 / 模态 / Bench / 评价
- 点列头排序，价格最小值绿色高亮
- **价格口径**: 官方 CNY 展示精确（无 ≈）；其他货币由实时汇率换算（≈ 标注）
- **默认排序**: 精选优先（按 `config.json#featured` 顺序），族内再按输出价从低到高
- **版本标签**: 模型名旁的 `(0731)`/`(0423)` 等版本号（从 `canonical_slug` 提取）
- **评价列**: 人工注释 + 自动标签（免费 / 多模态 / 超低价 / 无benchmark / 官方直销）

### 筛选
- 搜索框（匹配模型/厂商/备注）
- 厂商 / 渠道 / 模态下拉
- **预设视角**: 免费 / 多模态 / **便宜精选**（DeepSeek→MiniMax→MiMo→Longcat→Qwen→GPT-OSS→Ling→Gemma，官方 + OR 都进）
- **模型规模筛子**: ≥10B / ≥30B / ≥70B，只隐藏确认小、名字里带参数量的模型（深寻/MiMo/MiniMax/Longcat 等无参数量的保持可见）

### 计算器
- 月输入 / 月输出（百万 token）/ 缓存命中% / 月预算（按当前展示货币理解）
- 4 个**典型用户预设**: 编程 Agent (300M/60M/30%) · 日常 Agent (500M/20M/60%) · 批量/垃圾任务 (100M/5M/10%) · 阅读/检索问答 RAG (800M/8M/80%)
- 一键填参 + 按月成本排序，最便宜高亮

### 货币
- 默认 **CNY**（适合人民币收支）；可切 USD
- 顶栏 `1 USD ≈ ¥x (自动抓取)` 显示实时汇率
- 切 USD 时官方 CNY 行显示 ≈$（换算近似）

### 实时刷新
- 页面加载时直接连 OpenRouter API 拉最新价（CORS 允许）
- 失败回退 bundle 缓存（`assets/data.js`）

## 配置 (config.json)

| 字段 | 作用 |
|---|---|
| `currency_default` | 页面默认货币 (`usd` / `cny`) |
| `fx.source_url` / `fx.fallback_usd_per_cny` | 汇率抓取源与回退默认值 |
| `sources.*` | 各模型源 URL（OpenRouter / DeepSeek / MiniMax / Xiaomi） |
| `featured` | 精选短名单（id 数组，决定「便宜精选」顺序与默认排序优先级） |
| `model_comments` | 人工单行注释，key 为 `${provider}/${model}` |
| `model_family_overrides` | 同一模型不同版本的族映射（如 `deepseek-v4-flash-0731 → deepseek-v4-flash`） |
| `workload_presets` | 计算器的典型用户预设（in/out/hit） |
| `tips` | 页面底部的提示列表 |

改 `config.json` 后 `git push`，CI 重新生成 bundle 并自动部署。

## 开发

### 添加新的模型源
在 `scripts/lib/` 新建 `{name}.js`，导出 `scrape{Name}(config)`，返回 `{entries, url, count, fetched_at}`：

```js
import { fetchText, parseFloatCell, nowIso } from './common.js';

export async function scrapeExample(config) {
  const html = await fetchText(config.sources.example.url);
  const entries = [];
  // ... 解析 html → 推 entries ...
  return { entries, url: config.sources.example.url, count: entries.length, fetched_at: nowIso() };
}
```

然后在 `scripts/fetch.js` 中：
1. `config.sources` 加 `example: { url: "..." }`
2. import + `await run(scrapeExample, config)`，写入 `xmEntries`
3. 必要时在 `normalizeOfficial` 处理币种

### 抓取分层原则（按优先级降级）
1. 静态 HTML（最稳，curl 即可拿到）
2. Markdown 文档（如 MiniMax 的 `paygo.md`）
3. JSON API（最干净，没有 HTML 噪音）
4. JS 渲染的 SPA → 需要 Playwright（不在本项目当前支持范围）

## 部署

- 推 `main` → CI 跑 → gh-pages 推送（如有变化）
- **Pages 设置**: Settings → Pages → Source → **Deploy from branch (gh-pages)**
- 站点 URL: `https://<owner>.github.io/AI_Plan_Cost_Web/`
- `data/` 和 `assets/data.js` 已 gitignore，`main` 不会泄露数据

## 已知限制

- **模型规模筛子**只对名字里带参数量且确认小于阈值的模型生效（`qwen3-32b`→32B 等）。名字里无参数的（DeepSeek / MiMo / MiniMax / Longcat）保持可见。
- **反爬/登录墙站点**（如 Xiaomi Token Plan 后台）当前不支持。
- **每日汇率变化**会让 gh-pages 每日多一个 commit（这是预期部署历史，不是噪音）。
- **官方积分套餐**（如小米 MiMo Credits）非按 token 计费，不在单价对比范围；评价列注释了这点。
- **CI 抓取偶发失败**（网络/CI 限速）不会让站点下线，只是当天数据没刷新——页面会保留上次成功抓取的 bundle。