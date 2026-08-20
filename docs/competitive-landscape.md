# 紫微斗数 生态竞品调研 / Competitive Landscape

> All observations dated **2026-08-19** unless otherwise stated. Star counts, licences and
> activity dates come from the GitHub REST API on that date; `pushed_at` (last commit push)
> is used for activity, **not** `updated_at` (which moves on stars and metadata edits).
> Download counts come from the npm registry API on the same date.
> Anything I could not confirm from a fetched source is marked **unknown** rather than guessed.

---

## 0. TL;DR

1. **spec §2 is out of date and its headline claim is too strong.** "紫微生态只有一个真引擎"
   is right about the *iztro-derived* mainstream, but wrong as a statement about the ecosystem:
   there are at least four genuinely independent 排盘 engines with real code
   (`airicyu/Fortel` 中州派 Java, `cka4913/zwds` 北派 TS, `RedSC1/ziwei_core` Dart on a
   real ephemeris, `destinynet/destiny-core` Kotlin), plus a whole Vietnamese
   **Tử Vi Đẩu Số** branch the survey never looked at.
2. **spec §2 listed 9 projects; this survey verified ~60**, including **20+ MCP servers**
   against spec's 4. It missed the two that matter most: a direct time-layer peer
   (`Brhiza/mingyu` — IANA timezones, historical DST, gap/fold detection, equation of time)
   and a much richer MCP tool surface (`Czerror/ziwei-iztro-mcp` — 17 tools to our 3).
3. **The single largest gap for ziwei-mcp is not correctness — it is that it does not exist yet
   as a shipped artefact.** `@lhk714/ziwei-mcp` returns 404 on npm and
   `github.com/listen-hai/ziwei-mcp` returns 404 on the GitHub API (2026-08-19). Every badge and
   the `npx -y @lhk714/ziwei-mcp` quickstart in `README.md` currently points at nothing. The
   sibling `@lhk714/bazi-mcp` **is** published (v2.1.2, 2,268 downloads in its first week).
4. **The distribution race is, however, wide open** (§7). No 紫微 MCP server has real
   adoption: the largest on npm is 361 downloads/month, the official MCP registry contains
   exactly **one** 紫微 server, PulseMCP contains **zero**, and no awesome-mcp-servers list
   carries any. The two real footprints are `spyfree/mingli-mcp` (976 Smithery uses) and
   `hhszzzz/taibu` (459 Glama downloads). Publishing well is a bigger lever than any feature.
5. Where ziwei-mcp genuinely leads: the **立春-instant year boundary as a first-class,
   selectable convention** with the Z1 bypass, and the **classical-rules parity oracle**
   (independent 安星诀 implementation, not an iztro-to-iztro port). Nobody else has both.
6. **The Vietnamese Tử Vi branch is real and competitive**, and spec §2 never looked at it:
   PyPI's `tuvi-mcp-server` pulls 1,458 downloads/month — **more than any Chinese-language
   紫微 MCP server on either registry**.
7. **The year boundary really is the unclaimed ground.** Across every MCP server, library,
   consumer app and paid API surveyed (§4), the 立春-instant question is either undocumented,
   hardcoded to 正月初一, or — in iztro's case — exposed and implemented wrongly. That is the
   one dimension where nobody has beaten us, and it is worth saying plainly *because* so much
   else on this list has.
8. **Upstream is moving into our layer.** `iztro` now ships a key-gated hosted charting API
   (`chat-api.iztro.com`, models `iztro-ziwei-v3`) and official OpenAI-Agents-SDK kits
   (`SylarLong/openai-iztro-agents-{js,python}`, MIT, created 2026-06-27). The engine author
   becoming the agent vendor is the largest structural risk to this project.

---

## 1. Corrections to `docs/spec.md` §2

| spec §2 claim | Verdict (2026-08-19) | Evidence |
|---|---|---|
| `SylarLong/iztro` is the one real engine, MIT | **Confirmed, and dominant.** 4,073★, MIT, pushed 2026-08-19, 106,743 npm downloads last month. | [repo](https://github.com/SylarLong/iztro) · npm API |
| "所有紫微 MCP、网站、移植，底下全是它" | **Overstated.** True of nearly every *high-star* project, false as a blanket claim. See §3. | §3 |
| `ziweiknows/ziwei-chart` is **GPL-3.0** | **Confirmed.** GPL-3.0 via GitHub licence API; app is `iztro ^2.5.8`. | [licence](https://github.com/ziweiknows/ziwei-chart/blob/main/LICENSE) |
| `Renhuai123/ziwei-doushu` = "Next.js + 倪海厦体系知识库, iztro + lunar-javascript" | **Confirmed** — despite its own description calling itself an "开源排盘引擎…含完整排盘算法", its `package.json` depends on `iztro ^2.5.8` + `lunar-javascript ^1.7.3`. It is a consumer, not an engine. Now the second-largest repo in the space at 3,576★, MIT, but **last pushed 2026-06-24** — ~2 months stale. | fetched `package.json` |
| `smogievogie/ziwei_iztro-mcpserver` = "唯一处理真太阳时的 MCP" | **No longer true.** At least five MCP servers now do true-solar correction (§2). smogievogie itself is stale: last push **2025-08-15**, 13★, 72 npm downloads/month, still hard-bound to the AMap (高德) geocoding API and 120°E. | fetched source, npm API |
| `spyfree/mingli-mcp` "不明，未实测" | **Now measured.** Real project: 20 test files / ~350 test functions, PyPI + Smithery + `server.json`, Docker, stdio+HTTP. But no timezone handling whatsoever and no equation of time. §2. | fetched source |
| `SiwuXue/ziwei-mcp` / `Timmy9527/agentziwei` "偏解读产品" | **Confirmed**, and both are **unlicensed** (no LICENSE file → all rights reserved). SiwuXue last push 2025-08-02; agentziwei 2026-05-11. | GitHub licence API |
| `EdwinXiang/dart_iztro` | MIT, 153★, but **last pushed 2025-06-27** — over a year stale, will have drifted from iztro 2.6.0. | GitHub API |
| **"没有任何一个 MCP 是「iztro + 完整时间处理」。这就是本项目的位置。"** | **No longer true.** `Brhiza/mingyu` (343★, pushed 2026-08-18) does iztro + IANA historical timezones + DST gap/fold + equation of time + day-crossing, over an MCP server, a public API and a skill. Our remaining differentiators against it are narrower and specific: the **立春 instant** as a selectable year boundary (mingyu hardcodes 正月初一), exposed school parameters (mingyu hardcodes `dayDivide:'forward'`), and the classical-rules oracle. | fetched `packages/core/src/calendar/true-solar-time.ts` and `ziwei/runtime.ts` |
| (not in spec) Ecosystem size | spec listed 9 projects. Verified here: **~60**, incl. **20+ MCP servers**, 4+ independent engines, a Vietnamese lineage, and a commercial API/app market. | §2–§4 |

---

## 2. Comparison table — MCP servers (the direct competitive set)

Dimensions abbreviated: **TST** = true solar time; **EoT** = equation of time;
**TZ** = timezone handling; **Year** = how the year ganzhi boundary is decided.

| Project | MCP? | Engine | Lang | Licence | ★ | Last push | TST | EoT | TZ / DST | Year boundary | 運限 | School params | Output size | Verification |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **ziwei-mcp** (this) | yes (stdio) | iztro 2.6.0 (pinned) | TS/Bun | MIT | — (repo not public) | 2026-08-19 (local) | yes, `trueSolar` default **on** | yes (Meeus) | **IANA + historical DST + gap/fold + `dstFold`** | **立春 instant** (default) or 正月初一, selectable; Z1 bypassed | separate tool, 6 scopes, per-scope age compensation, `horoscopeDivide` locked | 9 params exposed + `mutagens`/`brightness` | trimmed, split across 2 tools | **216 tests; independent 安星诀 oracle (~18k assertions); 303,582-assertion 運限 oracle; 立春 scan** |
| [`Brhiza/mingyu`](https://github.com/Brhiza/mingyu) | yes (`mcp/`) + public API + skill | iztro ^2.5.8 + tyme4ts | TS | **NONE** ⚠ | 343 | 2026-08-18 | yes, requires longitude | **yes** | **IANA (`timeZoneId`) + historical DST + gap/fold status + China 1986–91 DST flag** | `yearDivide:'normal'` **hardcoded** → 正月初一 only, no 立春 option | yes; `horoscopeDivide:'normal'` hardcoded | **not exposed** (`dayDivide:'forward'` hardcoded) | text + JSON + "evidence chain" | 125 test files / ~1,399 cases across 12 systems |
| [`Czerror/ziwei-iztro-mcp`](https://github.com/Czerror/ziwei-iztro-mcp) | yes | `iztro: "latest"` ⚠ unpinned | TS | MIT | 0 | 2026-06-24 | yes, **default `false`**; silently skipped for 时辰 input | yes (Meeus) | **none** — 120°E Beijing anchor; JD computed from server-local `Date` getters | `yearDivide` exposed incl. **`'exact'` → inherits Z1** | yes, 6 layers | 7 via a stateful global `configure` tool | **17 tools**, `reconstructionKey` for granular queries | **no tests** |
| [`spyfree/mingli-mcp`](https://github.com/spyfree/mingli-mcp) | yes (stdio + HTTP, Docker, Smithery) | `iztro-py` 0.5 + `lunar_python` | Python | MIT | 6 | 2026-08-12 | yes, `use_solar_time` default **false** | **no** — pure `(lon−120)×4min` | **none**; hard UTC+8 Beijing assumption, 200+ city lon table | 紫微 always 正月初一; documented as a convention note, not selectable (八字 side does use 立春) | yes | minimal | markdown + JSON | 20 test files / ~350 tests incl. cross-engine vectors, boundary, property tests |
| [`hhszzzz/taibu`](https://github.com/hhszzzz/taibu) | yes (`packages/mcp-server`, hosted HTTP) | iztro ^2.5.4 + lunar-javascript | TS | **AGPL-3.0 root / MIT packages** ⚠ | 469 | 2026-08-01 | yes, reports `correctionMinutes` + `dayOffset` | yes (`equationOfTime` in `shared/true-solar.ts`) | IANA present in 奇门/大六壬/星盘 modules; **紫微 path: unknown** | unknown / not surfaced | yes | unknown | JSON + text, 12 systems | unknown |
| [`cka4913/zwds`](https://github.com/cka4913/zwds) | yes (`packages/mcp`) | **own 北派 engine** (lunar-javascript only) | TS | MIT | 2 | 2026-07-23 | no | no | **IANA `tz` param**, falls back to system TZ | ⚠ **stub** — `(year−4)%10` on the *Gregorian* year, with a source comment admitting 立春 is "待實作". Wrong ganzhi for every Jan–early-Feb birth. | **6 layers 本命/大限/流年/流月/流時 with 飛化/自化** | 北派 only | JSON + text | unknown |
| [`smogievogie/ziwei_iztro-mcpserver`](https://github.com/smogievogie/ziwei_iztro-mcpserver) | yes | iztro | JS | MIT | 13 | **2025-08-15** (stale) | yes | yes | **none**; 120°E anchor; **requires an AMap API key** → mainland-China geocoding only | not exposed | no | no | full passthrough | none |
| [`SiwuXue/ziwei-mcp`](https://github.com/SiwuXue/ziwei-mcp) | yes | iztro | JS | **NONE** ⚠ | 23 | **2025-08-02** (stale) | longitude accepted, correction unverified | unknown | `timezone` string accepted, default `Asia/Shanghai`; depth unknown | not exposed | timeline tool | no | large — SVG charts, SQLite persistence, ~20 interpretation tools | none |
| [`Timmy9527/agentziwei`](https://github.com/Timmy9527/agentziwei) | yes (`mcp-server/`) | iztro | JS | **NONE** ⚠ | 7 | 2026-05-11 | no | no | none | not exposed | interpretation-level | no | interpretation product | none |
| [`xavieryang007/ziwei-mcp`](https://github.com/xavieryang007/ziwei-mcp) | yes | bundled `iztro.min.js` in a Go binary | Go | **NONE** ⚠ | 1 | **2025-04-29** (stale) | no | no | none | not exposed | no | no | passthrough | none |
| [`snapyharry-potter/iztro-openai-mcp-railway`](https://github.com/snapyharry-potter/iztro-openai-mcp-railway) | yes | iztro | JS | **NONE** ⚠ | 0 | 2026-04-24 | unknown | unknown | unknown | unknown | unknown | unknown | unknown | none |
| [`wuunicorn/MCPIztro`](https://github.com/wuunicorn/MCPIztro) | yes | iztro 2.5.3 | JS | MIT | 5 | 2025-09-05 | **no** — params are `birthday`/`hour`/`gender` only | no | **none** | not exposed | `get_horoscope` + `targetDate` | **none** — iztro's `config()` is not surfaced | passthrough | none |
| [`ChesterRa/mingpan`](https://github.com/ChesterRa/mingpan) (npm `mingpan`) | yes | iztro | TS | Apache-2.0 | 105 | 2025-12-30 | unknown | unknown | unknown | unknown | unknown | unknown | 八字 + 紫微 | unknown |
| [`LouisLin0723/fatestar-ziwei`](https://github.com/LouisLin0723/fatestar-ziwei) | yes — **the only 紫微 server in the official MCP registry** | unknown | Python | MIT | 0 | 2026-07-31 | unknown | unknown | unknown | unknown | unknown | unknown | unknown | unknown |
| npm `@xzkcz/iztro-chart-mcp-server` | yes | iztro | JS | ISC | — (no GitHub repo reachable) | npm 2026-02-05 | n/a | n/a | n/a | n/a | n/a | n/a | **renders chart images via Playwright** | none |
| PyPI `tuvi-mcp-server` ([nmhaaa3218/TuViMCP](https://github.com/nmhaaa3218/TuViMCP)) | yes | own (Vietnamese Tử Vi) | Python | MIT | unknown | PyPI 2026-08-03 | unknown | unknown | unknown | unknown | unknown | Bắc phái lineage | unknown | unknown — **but 1,458 dl/month, the most-downloaded 紫微-family MCP server found** |
| npm long tail: `ziwei-cli` (361/mo), `mythsensus-mcp` (1,046/mo, 26 systems), `taibu-mcp` (619/mo), `ziweidoushu-mcp` (73/mo), `ziwei-mcp-server` (48/mo), `peixuan-mcp` (25/mo ⚠ **CC-BY-NC-SA-4.0**), `chinese-astrology-mcp` / `purple-star-astrology` (26/mo), `xuanxue-ziwei-chart` (13/mo), plus the `@iflow-mcp/*` republish shims | yes | iztro (all) | JS/TS | mostly MIT | — | 2025–2026 | mostly none | mostly none | mostly none | not exposed | varies | rarely | passthrough | none found |

---

## 3. Comparison table — engines and libraries (non-MCP)

| Project | What it is | Engine | Lang | Licence | ★ | Last push | Notable on our dimensions |
|---|---|---|---|---|---|---|---|
| [`SylarLong/iztro`](https://github.com/SylarLong/iztro) | The engine | own | TS | MIT | 4,073 | 2026-08-19 | 106,743 npm dl/month. `yearDivide:'exact'` = the Z1 date-not-instant bug we bypass. |
| [`SylarLong/react-iztro`](https://github.com/SylarLong/react-iztro) | Chart component | iztro | TS | MIT | 531 | 2026-08-16 | 1,516 npm dl/month. **Visualisation we don't have.** |
| `SylarLong/iztro-hook` | React hook incl. 運限 | iztro | TS | MIT | 52 | 2026-08-16 | |
| `SylarLong/openai-iztro-agents-{js,python}` | Upstream's own agent kits on the OpenAI Agents SDK | iztro | TS/Py | MIT | 0 / 1 | 2026-07-28 | Upstream is moving into the agent space itself. |
| [`Renhuai123/ziwei-doushu`](https://github.com/Renhuai123/ziwei-doushu) | Next.js app + 倪海厦 knowledge base | **iztro** (verified) | TS | MIT | 3,576 | 2026-06-24 | Largest non-engine repo. Interpretation corpus is its real asset. |
| [`DestinyLinker/MingLi-Bench`](https://github.com/DestinyLinker/MingLi-Bench) | **Benchmark for LLMs on 八字/紫微** | n/a | Py | MIT | 2,312 | 2026-05-09 | An *external* evaluation target that ziwei-mcp does not run against. See §5. |
| [`FANzR-arch/Numerologist_skills`](https://github.com/FANzR-arch/Numerologist_skills) | "Framework to stop LLM hallucination in Chinese astrology" | unknown | Py | **NONE** ⚠ | 948 | 2026-08-03 | Same thesis as ours (deterministic 排盘 under the LLM), delivered as skills. |
| [`dzcmemory-web/bazi-ziwei-skill`](https://github.com/dzcmemory-web/bazi-ziwei-skill) | Claude/Codex/Cursor skill, 八字+紫微, ink-wash HTML chart poster | unknown | TS | MIT | 833 | 2026-06-14 | **Distribution as a skill, not an MCP** — the format most of this ecosystem now ships in. |
| [`learnwithu/mingli-master`](https://github.com/learnwithu/mingli-master) | Skill on `iztro-py`, generates visual HTML chart | iztro-py | Py | MIT | 647 | 2026-08-15 | |
| [`hhszzzz/taibu`](https://github.com/hhszzzz/taibu) | 12-system app + hosted MCP + iOS/Android | iztro | TS | AGPL/MIT split ⚠ | 469 | 2026-08-01 | Product depth far beyond ours. |
| [`Brhiza/mingyu`](https://github.com/Brhiza/mingyu) | 12-system 排盘 + API + MCP + skill | iztro | TS | **NONE** ⚠ | 343 | 2026-08-18 | **The closest time-layer peer.** |
| [`tradecatlabs/fatecat`](https://github.com/tradecatlabs/fatecat) | "Measurement infrastructure" — reproducible 八字/紫微 with evidence weighting | multiple | HTML/Py | MIT | 202 | 2026-07-22 | Ships pytest goldens for 1900–2030 节气, 月令/立春 boundary, 起运 samples. Verification-first, like us. |
| [`x-haose/py-iztro`](https://github.com/x-haose/py-iztro) | Python port of iztro | iztro port | Py | **NONE** ⚠ | 132 | 2025-08-01 | Unlicensed port of an MIT library. |
| [`zhenheco/life-chart-engine`](https://github.com/zhenheco/life-chart-engine) | Western natal + Human Design + 紫微 in one CLI, JSON for agents | astronomy-engine + iztro | Py | MIT | 75 | 2026-08-08 | Offline, deterministic, 19 README translations. Cross-system triangulation is a genuinely different product idea. |
| [`airicyu/Fortel`](https://github.com/airicyu/Fortel) + [`fortel-ziweidoushu`](https://github.com/airicyu/fortel-ziweidoushu) | **Independent 中州派 engine**, Java + JS | **own** | Java/TS | MIT | 34 / 32 | 2026-03-02 / 2025-05-05 | Falsifies "only one engine". 中州派-native, where iztro's `zhongzhou` mode is unverified even by us. |
| [`destinynet/destiny-core`](https://github.com/destinynet/destiny-core) | Long-running Kotlin metaphysics library incl. 紫微 | **own** | Kotlin | **NONE** ⚠ | 36 | 2026-08-18 | Active since 2017. |
| [`RedSC1/ziwei_core`](https://github.com/RedSC1/ziwei_core) | **Config-driven engine, ~1000 BC – AD 5000** | **own**, on `sxwnl_spa_dart` (寿星万年历) + `bazi_core` | Dart | MIT | 20 | 2026-07-13 | **Beats us on calendar range** (we stop at 1900–2100) and on **school configurability via JSON hot-patching**. Real 節氣 timeline, real 立春 lookup. Honest README warning that UTC+7 lunar rules (Vietnam/Laos) are *not* solved by changing `timeZone` — a subtlety our `lunarDateFrame` should be checked against. |
| [`x-haose/x-iztro`](https://github.com/x-haose/x-iztro) | Rust core + Python/Go bindings, claims 100% iztro parity on 660k gold cases | iztro reimplementation | Rust | MIT | 0 | 2026-08-18 | **82 MB of golden fixtures** in `tests/` (`golden_tier1`, `golden_horoscope`, `golden_astrotype`, `golden_i18n`, `golden_contract`). Published to crates.io + PyPI + pkg.go.dev. Has `astrolabe_to_prompt()` — LLM-ready text output, i.e. it has thought about context cost too. **Caveat: its oracle is iztro itself**, so it pins a port, not the classical rules. |
| [`cka4913/zwds`](https://github.com/cka4913/zwds) | **Independent 北派 engine** + API + CLI + MCP + Workers | **own** | TS | MIT | 2 | 2026-07-23 | 飛化層次 / 自化 / 我宮他宮 — a 北派 feature set iztro simply does not model. Year-ganzhi is a stub (§2). |
| `JinyangWang27/iztro-rs`, `qiyangdev/ZiweiKit`, `TaoracleHQ/izthon`, `matharts/ziwei`, `wlhyl/ziwei` | Ports to Rust / Swift / Python / Zig | iztro or own | — | MIT (wlhyl: **NONE**) | ≤6 | 2026 | Ports are proliferating; iztro's placement tables are becoming a de-facto standard. |
| [`lzm0x219/ziwei`](https://github.com/lzm0x219/ziwei) → npm `@ziweijs/core` | **Independent 北派 engine** on `tyme4ts` + React renderer | **own** | TS | MIT | unknown | npm 2025-11-09 | 239 npm dl/month. A fourth genuinely non-iztro engine. |
| PyPI `purplestar` ([jason-chao](https://github.com/jason-chao/purplestar)) | Independent English-facing 紫微 engine | **own** | Py | MIT | unknown | PyPI 2026-05-09 | 267 PyPI dl/month. The only English-first independent engine found. |
| `RedSC1/py-ephemeris` → PyPI `py-ephemeris-ziwei` | Python bindings for the same "太阴 ephemeris" behind `ziwei_core` | own | Py | **MPL-2.0** | unknown | PyPI 2026-08-18 | Published *yesterday*; 1,733 downloads in its first week. Weak copyleft — file-level, so linking is fine, but do not edit-and-close its files. |
| **Vietnamese Tử Vi Đẩu Số branch** — PyPI `tuvi-mcp-server` (1,458 dl/mo, MIT, **MCP**), `lasotuvi` (740/mo), `ansaotuvi` (294/mo); npm `tuvi-neo` (1,008/mo, **no licence field**), `@luangiai/laso-tuvi` (195/mo); [`thaylinh/tuvi-api`](https://github.com/thaylinh/tuvi-api) PHP (**unlicensed**) | Same system, different lineage | own | Py/JS/PHP | mixed | — | active | **`tuvi-mcp-server` at 1,458 dl/month out-distributes every Chinese-language 紫微 MCP server on npm or PyPI.** Different 安星 conventions *and* a UTC+7 lunar calendar. spec §2 missed this entirely. |
| `EdwinXiang/dart_iztro`, `osmandemiroz/astro-iztro` | Dart/Flutter ports | iztro | Dart | MIT | 153 / 11 | 2025-06-27 / 2025-11-20 | Both stale relative to iztro 2.6.0. |
| PyPI `iztro-py` (26,150 dl/mo) · `py-iztro` (17,354 dl/mo) | The two dominant Python engines | iztro reimplementation / port | Py | ⚠ **no licence declared on either** | 17 / 132 | 2026-07-25 / 2025-08-01 | Between them ~43k downloads/month on a legally undefined basis. See §8. |

---

---

## 4. The commercial / Chinese-language market (spec §2 never looked here)

Every claim below has a source URL. Where a vendor does not document a dimension it is marked
**unknown** — for most of this market the year boundary is simply undocumented.

### Paid 排盘 APIs

| API | Pricing | True solar time | Timezone / non-CN | Year boundary | School switches | 運限 |
|---|---|---|---|---|---|---|
| [缘份居 `Bazi/zwpan`](https://doc.yuanfenju.com/bazi/zwpan.html) | unknown (free test key; claims 300+ platform customers) | **tri-state `zhen`**: 1 = China (needs 省/市), 2 = none, 3 = **global** (needs decimal lon/lat) | **IANA `timezone`, default `Asia/Shanghai`** — the only paid API found that models this | unknown | `sect` for 晚子时日柱; **闰月 explicitly out of scope** ("本接口不处理闰月") | **none** — natal only |
| [极速数据 紫微斗数](https://www.jisuapi.com/api/ziwei/) | **¥980 / 10,000 calls** | `istaiyang` flag + `city`; **official sample sets `istaiyang = 0`** (off) | free-text city, no timezone → non-UTC+8 unlikely | unknown | none exposed | `DaXian` with age ranges; 流年 not documented |
| [showapi 秀派 排盘-紫微斗数](https://www.showapi.com/apiGateway/view/1647) | free tier | **none** — only params are `time` and `gender` | **none** | unknown | none | unknown |
| **iztro's own hosted API** — `chat-api.iztro.com/v2/...`, models `iztro-ziwei-v3` / `iztro-qimen-v3`, plus an "Iztro Agents SDK" (Py + TS over the OpenAI Agents SDK) | unknown (console-gated) | inherits the library — none | none | `yearDivide` config | full `Config` | full | 

**Strategic note:** the last row matters. **Upstream is commercialising into exactly our layer** —
a hosted charting API plus agent SDKs that pick the 大限/流年/流月/流日 scope per question.
`SylarLong/openai-iztro-agents-{js,python}` (MIT, created 2026-06-27) are the open half of that.

### Consumer apps and web 排盘

| Product | True solar time | Timezone | Year boundary | School switches | 運限 |
|---|---|---|---|---|---|
| **文墨天机** (category leader; iOS/Android, IAP ¥68–¥168 per module) | **default ON**, driven by 出生地经度 | **yes** — explicit 时区 selector for births outside UTC+8 | unknown | **extensive** — user-editable 四化表, multiple 排盘方法; **安星码** encodes a whole settings combination as a short portable code (e.g. `8GDPB` for a 倪海厦《天纪》 preset) | 大限/小限/流年/流月/流日/流时, deeper tiers paywalled |
| [神机阁](https://www.shenjige.cn/ziwei/base) | optional checkbox; their teaching page insists it is mandatory practice | unknown | **states 正月初一 as doctrine, explicitly not 立春** ("我们不讲节气，我们也不从立春开始") | fixed 三合派 | full drill-down |
| [aiioo](https://aiioo.com/) (TW) | offered, **optional** | 台/中/馬/菲/新/汶 only, **no timezone conversion** | unknown | **the richest switch surface found** — 派別 ∈ {斗數全集, 中州派, 斗數全書, 北派, 占驗門}; 早晚子時 ∈ {子初換日, 子正換日}; **閏月 三種排法** | not listed |
| [天机爻](https://tianjiyao.com/zh/ziwei) | **mandatory** lat/lon correction | unknown | unknown | 中州派 declared | unknown |
| 星理, 问真八字, 大师八字, 辰星网 | present; 辰星网 says **default on** | unknown | unknown | 星理 claims school-configurable | yes |
| 元亨利贞, 灵匣網, 测测 | unknown (403 / not documented) | unknown | unknown | unknown | unknown |

### Vietnam (Tử Vi Đẩu Số)

No public paid API found; the model is free 排盘 → paid human/AI reading. Two notes worth having:

- [Luangiai.vn](https://luangiai.vn/lap-la-so-tu-vi/) explicitly instructs users to check the
  **pre-/post-1975 Vietnamese timezone regime change** — a historical-offset correction of exactly
  the class our time layer exists to handle, and one **no mainland tool in this survey addresses**.
- [Mèo Béo Studio](https://meobeostudio.com/tu-vi) states its lineage (Bắc phái / 斗數全書) and
  its lunar algorithm (Hồ Ngọc Đức) explicitly, including 闰月 handling — more doctrinal
  transparency than most Chinese products.

### What this market tells us

1. **Our thesis is validated by the gap, not by the competition.** The single dimension
   ziwei-mcp treats as most load-bearing — 立春 instant vs date vs 正月初一 — is
   **undocumented by every commercial app and every paid API in this survey**. iztro is the only
   product that even exposes it as a switch, and it implements it wrongly (Z1).
2. **True solar time is table stakes in the Chinese market and absent from the developer layer.**
   文墨天机 defaults it on; 天机爻 requires it; 缘份居 makes it tri-state. Meanwhile iztro's entry
   point is a bare `timeIndex 0–12`, so every iztro-derived MCP server inherits that hole unless
   it bolts on its own correction layer — §2 shows five that now do (mingyu, Czerror, taibu,
   mingli-mcp, smogievogie), of widely varying quality, and a long tail that does not.
   Our correctness advantage over *MCP servers* is real; over *Chinese consumer apps* it is not.
3. **Defaults disagree in ways that silently change charts.** iztro defaults `dayDivide:'forward'`
   (晚子时 → next day); 神机阁 defaults the opposite. iztro defaults 正月初一; 极速数据's own
   sample defaults true-solar **off**. Any cross-tool comparison must pin all three — which is
   an argument for our `diagnostics.convention` block, and for the next point.
4. **文墨天机's 安星码 is the best idea in this survey and we should steal it.** A short code that
   encodes an entire settings combination makes charts reproducible across tools and lets a user
   say "cast this with 倪海厦's settings" in one token. We already emit
   `diagnostics.convention` — hashing it into a short stable code, and accepting it as an input,
   is a small change with real interop value.

## 5. Where ziwei-mcp genuinely leads

These are the claims I could not find matched anywhere else after checking every project above.

1. **立春-instant as a selectable year convention, with the Z1 bypass.**
   This is the real moat and it is narrower than the spec implies — not because others solved it,
   but because **almost nobody offers 立春 for 紫微 at all**. mingyu and mingli-mcp both hardcode
   正月初一; Czerror exposes iztro's `'exact'` and therefore ships the Z1 bug verbatim;
   cka4913 has a Gregorian-year stub that is worse than Z1. We are the only project where
   "which boundary, and at what instant" is an answered, tested, parameterised question.
2. **A parity oracle written from the classical rules, not from iztro.**
   x-haose/x-iztro's 660k golden cases are the only comparable corpus, but they are
   iztro-vs-port. Ours is 安星诀-vs-iztro: it can catch an *upstream* error, not just a port
   error. Combined with the 303,582-assertion 運限 oracle, this is the strongest verification
   story in the space. fatecat is the only other project with a genuine golden-data culture.
3. **DST gaps and folds treated as first-class**, with `dstFold` as an input and a refusal
   rather than a guess. mingyu detects the same conditions ("含夏令时重复时段/不存在时段") — it is
   the one peer here — nobody else even models it.
4. **Refusing to answer rather than answering wrongly**: no `timeUnknown`,
   `shichenAmbiguity` with candidate `timeIndex` values, `ageDivide:'birthday'` rejected in the
   horoscope tool, pre-birth targets rejected. Czerror silently skips solar correction for
   时辰 input; mingli-mcp silently ignored a missing longitude until a documented bugfix.
   This posture is unusual and defensible.
5. **Per-call config isolation.** iztro's `config` is global and `horoscope()` reads it lazily.
   Czerror ships a stateful `configure` tool, which means one caller's school override rewrites
   the next caller's chart. We isolate; they do not.

## 6. Where we merely match

- **True solar time with Meeus EoT**: matched by Czerror, smogievogie, taibu, mingyu.
  Not a differentiator any more, whatever spec §2 said.
- **IANA timezones with historical offsets**: matched by mingyu (`Intl.DateTimeFormat`-backed)
  and partially by cka4913. Still rare, but no longer unique.
- **Exposing school switches as parameters**: Czerror exposes 7 (badly — globally);
  RedSC1/ziwei_core exposes more than we do, via JSON rule patching. And on the consumer side
  we are behind, not ahead: **aiioo** offers 5 派別 (斗數全集/中州派/斗數全書/北派/占驗門),
  2 早晚子時 rules and **3 閏月 排法** against our single boolean `fixLeap`; 文墨天机 lets users
  edit the 四化表 outright. Our claim should be "every switch is *named and reported*", not
  "we expose the most switches" — the latter is false.
- **Trimmed LLM-oriented output**: x-iztro's `astrolabe_to_prompt()`, taibu's canonical JSON,
  mingyu's prompt payloads all solve the same problem.
- **Test volume**: mingyu has ~1,399 cases across 12 systems; mingli-mcp ~350 for 2 systems;
  we have 216 for 1. Our assertion *density* is far higher, but "216 tests" is not the flex
  the README implies when stated as a bare number.

## 7. Distribution reality check

The most actionable numbers in this report. All observed 2026-08-19.

### Registry presence

| Registry | 紫微 servers indexed | Top entry | Our presence |
|---|---|---|---|
| **Smithery** | 1 | `@spyfree/mingli-mcp` — **976 uses** (Smithery's tool-call metric) | none |
| **Glama** | ~13 | `taibu` 459 downloads; then `SiwuXue/ziwei-mcp` 12, `smogievogie` 10, `spyfree` 7, `agentziwei` 7 | `@lhk714/bazi-mcp` auto-ingested, 0 downloads, "unclaimed" |
| **Official MCP registry** | **1** — `io.github.LouisLin0723/fatestar-ziwei` | — | none |
| **PulseMCP** | **0** | — | none |
| **punkpeye / appcypher / yzfly awesome-mcp-servers** | **0 across all three** | — | none |
| **mcp-get** (15,937 packages) | 1 (`@spyfree/mingli-mcp`) | — | none |
| mcp.so, mcpmarket.com | **unknown** — both blocked fetching (403 / Vercel challenge) | — | unknown |

### Package downloads (last month)

| Package | Registry | Downloads/mo | What it is |
|---|---|---|---|
| `iztro` | npm | **106,743** | the engine |
| `lunar-typescript` / `lunar-lite` | npm | 308,819 / 98,593 | calendar substrate |
| `iztro-py` / `py-iztro` | PyPI | 26,150 / 17,354 | Python engines |
| `mingyu-core` | npm | 4,233 | mingyu's engine |
| **`@lhk714/bazi-mcp`** | npm | **2,268** (first week) | our sibling |
| `py-ephemeris-ziwei` | PyPI | 1,733 (first week) | RedSC1's ephemeris |
| **`tuvi-mcp-server`** | PyPI | **1,458** | **Vietnamese Tử Vi MCP — the most-downloaded 紫微-family MCP server found** |
| `mythsensus-mcp` | npm | 1,046 | 26-system divination MCP |
| `tuvi-neo` | npm | 1,008 | Vietnamese Tử Vi lib (⚠ no licence field) |
| `fortel-ziweidoushu` | npm | 788 | 中州派 engine |
| `x-iztro` | PyPI | 701 (first week) | Rust/Py/Go parity port |
| `mingli-mcp` | PyPI | 641 | spyfree's MCP |
| `taibu-mcp` | npm | 619 | taibu's MCP |
| `ziwei-cli` | npm | 361 | **the largest npm 紫微 MCP/CLI** |
| `ziwei` (no repo) | npm | 333 | tyme4ts lib |
| `@ziweijs/core` | npm | 239 | 北派 engine |
| `SiwuXue` `ziwei-mcp` | npm | 134 | |
| `mingpan`, `ziweidoushu-mcp`, `ziwei_iztro-mcpserver`, … | npm | 121 / 73 / 72 | the long tail |
| **`@lhk714/ziwei-mcp`** | npm | **404 — does not exist** | us |

**Read of this:** the engine layer is a monoculture with real traffic; the *MCP server* layer
has no winner at all. `spyfree/mingli-mcp` leads on Smithery presence and `taibu` on Glama, but
in absolute terms the category is at hobby scale. Two distribution channels — Smithery and the
official MCP registry — are effectively unoccupied. `@lhk714/bazi-mcp` hitting 2,268 in week one
without any registry listing suggests the ceiling here is set by shipping, not by demand.

Two more MCP servers worth knowing about, found only via registries:

- **`LouisLin0723/fatestar-ziwei`** — the sole 紫微 entry in the official MCP registry
  (v2.0.0, site fatestar.top). Not otherwise visible on GitHub search.
- **`@xzkcz/iztro-chart-mcp-server`** (npm, ISC, 25 dl/mo) — **renders chart images via
  Playwright over MCP.** The visualisation gap in §9 already has an implementation to copy.
- **`peixuan-mcp`** (npm, 25 dl/mo) is **CC-BY-NC-SA-4.0** — non-commercial. See §10.

---

## 8. Where something else is actually better

This is the part worth acting on.

1. **Distribution — we are at zero.**
   `@lhk714/ziwei-mcp` is a 404 on npm; `listen-hai/ziwei-mcp` is a 404 on GitHub.
   mingli-mcp ships on PyPI via `uvx` with a `smithery.yaml` and a `server.json`;
   smogievogie is on npm (72 dl/month even while abandoned since 2025-08); taibu runs a hosted
   auth-free HTTP MCP endpoint; mingyu ships an installable skill via `npx skills add`;
   x-iztro is on crates.io + PyPI + pkg.go.dev simultaneously. **Correctness that nobody can
   install loses to approximations that are one command away.** See §7 for the numbers.
2. **`Czerror/ziwei-iztro-mcp` has a far better tool surface.** 17 tools against our 3, and in
   particular a `reconstructionKey` pattern: create the chart once, then query
   `get_palace_info` / `get_surrounded_palaces` / `analyze_palace` / `get_star_info` against the
   key. That is a *better answer to context cost than trimming the JSON* — the LLM pulls what it
   needs instead of receiving a curated dump. It also has 41-pattern (格局) detection, 合盘
   (synastry), 三方四正 as a first-class query, and 倪海厦 knowledge resources. Its time layer is
   much weaker than ours, but a caller comparing feature lists will not see that.
3. **運限 depth: `cka4913/zwds` models 飛化 / 自化 / 我宮他宮 (北派)**, which iztro does not
   express at all, so neither do we. Our 運限 tool is more *correct* about time; theirs is more
   *expressive* about the technique. Different axes, and theirs is the one a practitioner asks for.
4. **Calendar range: `RedSC1/ziwei_core` covers ~1000 BC – AD 5000** on a real ephemeris
   (寿星万年历), against our 1900–2100. Our spec's goal is literally "任意年代"; we do not meet it.
   It also handles the pre-Gregorian / Julian reform era, which we do not touch.
5. **Visualisation: we have none.** react-iztro (531★), learnwithu/mingli-master (647★),
   dzcmemory-web/bazi-ziwei-skill (833★), ziweiknows/ziwei-chart (435★) and taibu all render a
   chart. For an LLM caller, an HTML/SVG 命盘 is often the deliverable, and the highest-star
   projects in this space are *visual* ones, not correct ones.
6. **External evaluation: `MingLi-Bench` (2,312★) exists and we do not run against it.**
   It is the closest thing this field has to a shared oracle for the LLM layer. Our README
   admits the ziwei.pub comparison is manual and not automated — that is the weakest sentence
   in an otherwise strong verification section.
7. **Interpretation corpora**: Renhuai123 (3,576★, 倪海厦 体系 + 古籍原文), taskyoooo's
   古籍-distilled skill, Czerror's 格局 knowledge base. We deliberately delegate interpretation
   upward, which is defensible — but it means we compete on a dimension users rank second.
8. **`Brhiza/mingyu`'s evidence-chain output** attaches explicit `limitations` strings to each
   computed fact ("这些步骤不得据此生成候选时辰/概率/观测级精度声明"). That is a smarter
   anti-hallucination device than our `diagnostics` block, which reports facts but does not tell
   the model what it may *not* infer from them. Cheap to copy.

---

## 9. Gaps worth closing, ranked by effort ÷ payoff

| # | Gap | Effort | Payoff | Note |
|---|---|---|---|---|
| 1 | **Publish.** `npm publish` + make the GitHub repo public + fix the dead badges. | hours | **decisive** | Nothing else on this list matters until this is done. Every claim in the README is currently unverifiable by a third party. |
| 2 | List on Smithery / mcp.so / Glama / the MCP registry; add `server.json` + `smithery.yaml`. Copy mingli-mcp's setup. | hours | high | This is how the Chinese-language MCP audience actually discovers servers. |
| 3 | Add `limitations` / "what you may not infer" strings to `diagnostics`, per mingyu. | hours | medium-high | Directly serves the anti-hallucination thesis the whole project rests on. |
| 3b | **A short portable convention code**, per 文墨天机's 安星码 — hash `diagnostics.convention` into a stable short string and accept it as an input. | hours | medium-high | Makes charts reproducible across tools and lets a user say "cast with 倪海厦's settings" in one token. Best single idea found in the whole survey (§4). |
| 4 | **Granular query tools over a chart handle** (Czerror's `reconstructionKey`): `get_palace`, `get_surrounded_palaces`, `get_star`. | 1–2 days | high | Better context economics than trimming, and closes the biggest feature-list deficit. |
| 5 | Automate the ziwei.pub / external comparison; consider a MingLi-Bench run. | 1–2 days | medium-high | Turns the one soft claim in §Verification into a hard one. |
| 6 | 格局 (pattern) detection over the natal chart. | 2–4 days | medium | Purely additive, no time-layer risk, and it is what every competitor advertises. |
| 7 | Chart rendering (SVG/HTML) as an optional tool or a `react-iztro` pointer. | 2–4 days | medium | The visual projects have 5–10× our star potential. Could be as cheap as documenting react-iztro; `@xzkcz/iztro-chart-mcp-server` shows the Playwright-over-MCP version if we want images. |
| 8 | Extend the year range below 1900 / above 2100. | weeks | low-medium | Bounded by `lunar-lite`'s tables, so it means a calendar-engine swap (cf. `sxwnl`). High cost, narrow audience. |
| 9 | 北派 飛化/自化 modelling. | weeks | low-medium | Requires leaving iztro's model. Real practitioner demand, but a different product. |
| 10 | Verify the Vietnamese Tử Vi / UTC+7 lunar case against `lunarDateFrame`. | 1 day | low | RedSC1's warning, and Luangiai.vn's pre-/post-1975 Vietnam timezone note (§4), both suggest `lunarDateFrame:'local'` may not be sufficient for UTC+7 lunar rules. Worth one test even if the answer is "out of scope, documented". |
| 11 | Add a 立春-boundary comparison against 缘份居's `zhen=3` + IANA-timezone API as a third-party oracle. | 1 day | low-medium | It is the only external service that accepts the same inputs we do (§4); a disagreement would be informative in either direction. |

---

## 10. Licensing risk in the ecosystem

Verified via the GitHub licence API on 2026-08-19.

**Confirmed copyleft — do not vendor, do not copy code from:**

- [`ziweiknows/ziwei-chart`](https://github.com/ziweiknows/ziwei-chart) — **GPL-3.0**.
  spec §2's flag is correct. (Its sibling `ziweiknows/ziwei-chat` is Apache-2.0.)
- [`hhszzzz/taibu`](https://github.com/hhszzzz/taibu) — **worse than it looks**: the repo root is
  **AGPL-3.0-only** (`src/`, `supabase/`, `public/`, root `scripts/`, Docker files), with only
  `packages/core`, `packages/mcp`, `packages/mcp-server` carved out as MIT. GitHub reports the
  repo as `NOASSERTION`, which hides this. AGPL reaches network use — copying from the root tree
  into a hosted service is the trap.

**No licence at all → all rights reserved, legally unusable regardless of how open they look:**

`Brhiza/mingyu` (343★) · `FANzR-arch/Numerologist_skills` (948★) · `SiwuXue/ziwei-mcp` ·
`Timmy9527/agentziwei` · `xavieryang007/ziwei-mcp` · `snapyharry-potter/iztro-openai-mcp-railway` ·
`x-haose/py-iztro` (132★) · `wlhyl/ziwei` · `destinynet/destiny-core` · `weizeW/mingli-skills` ·
`Renhuai123/ziwei-2.0` (a fork) · `thaylinh/tuvi-api` · `Samuelson368/ziwei-doushu-api-final` ·
`cubshuang/ZiWeiDouShu` · `tcevor/ziweidoushu`.

`x-haose/py-iztro` deserves a specific note: it is an unlicensed derivative of MIT-licensed
iztro, which does not satisfy iztro's attribution condition. Anyone depending on it inherits
that defect.

**Restrictive / awkward licences on published packages:**

- npm **`peixuan-mcp`** (BaZi + ZWDS MCP) — **CC-BY-NC-SA-4.0**: non-commercial *and* share-alike,
  and a content licence applied to software. Unusable in a commercial product.
- PyPI **`ziwei-cli`** 0.1.0 — **AGPL-3.0-only**, no declared repo.
- PyPI **`py-ephemeris-ziwei`** (RedSC1) — **MPL-2.0**. Weak, file-level copyleft: linking is
  fine, modifying its files means publishing those files. Fine as a dependency, not as a fork.
- npm **`lunisolar`** — **GPL-3.0**. A calendar library at 5,486 dl/month that would poison a
  permissive tree; we use `lunar-lite` (MIT) instead, correctly.
- npm **`tuvi-neo`** (1,008 dl/month) and `@iflow-mcp/tsai1030-ziwei-mcp-server` —
  **no `license` field at all** in `package.json`.

**The biggest legal hole in the ecosystem:** the two most-downloaded Python 紫微 engines,
**`iztro-py` (26,150 dl/month)** and **`py-iztro` (17,354 dl/month)**, both declare
**no licence** — no `license` field, no classifier — despite public repos. Roughly 43,000
downloads a month rest on code that is, strictly, all rights reserved. `py-iztro` is
additionally an undeclared derivative of MIT-licensed iztro, which does not satisfy iztro's
attribution condition. `spyfree/mingli-mcp` is MIT but depends on `iztro-py`, so it inherits
the defect transitively.

**Ambiguous:** `ai-freer/fortune-skill` reports `NOASSERTION` with a LICENSE file present —
read it before use.

**Clean MIT and safe to depend on:** `SylarLong/iztro` and the whole SylarLong family,
`lunar-lite`, `spyfree/mingli-mcp`, `spyfree/iztro-py`, `Czerror/ziwei-iztro-mcp`,
`RedSC1/ziwei_core`, `cka4913/zwds`, `airicyu/Fortel` + `fortel-ziweidoushu`,
`x-haose/x-iztro`, `zhenheco/life-chart-engine`, `tradecatlabs/fatecat`,
`DestinyLinker/MingLi-Bench`, `Renhuai123/ziwei-doushu`, `dzcmemory-web/bazi-ziwei-skill`,
`learnwithu/mingli-master`, `EdwinXiang/dart_iztro`, `smogievogie/ziwei_iztro-mcpserver`.

**Our own exposure is clean**: MIT over MIT (`iztro`, `lunar-lite`), no GPL anywhere in the
dependency tree, and nothing vendored from the unlicensed set.

---

## 11. Method and limits

- GitHub metadata: `gh api repos/{owner}/{repo}` and `.../license`, 2026-08-19.
- Source claims: repositories downloaded as tarballs and read directly, not inferred from
  READMEs. Where a README claim and the source disagreed (`Renhuai123/ziwei-doushu` calling
  itself an engine; `cka4913/zwds` claiming 立春 year ganzhi), the source wins and the
  discrepancy is stated.
- npm figures: `api.npmjs.org/downloads/point/last-month`, 2026-08-19.
- Registry, npm and PyPI figures were gathered by three parallel research passes on the same
  date; every number quoted is one a registry displayed, none are estimated.
- **Not verified / unknown:**
  - taibu's 紫微-path timezone handling; SiwuXue's actual solar correction;
    the `snapyharry-potter` server; `LouisLin0723/fatestar-ziwei`'s internals.
  - **mcp.so** returns HTTP 403 (Cloudflare) and **mcpmarket.com** returns a Vercel challenge —
    no first-hand data from either; listing pages are known to exist but counts are unreadable.
  - The **year boundary for essentially every commercial product** (文墨天机, 星理, 测测,
    元亨利贞, 灵匣網, aiioo, 天机爻, 缘份居, 极速数据, showapi). This is a genuine finding, not a
    research failure: none of them document it.
  - 文墨天机's primary site `ziwei001.com` returned "Account Suspended" on 2026-08-19, so its
    settings claims rest on App Store listings plus its FAQ as reproduced on third-party sites.
  - Pricing for 缘份居, iztro's hosted API, and every Vietnamese service.
  - `顺通天下` — searched by exact name, **zero results**; could not locate any live product.
    `聚合数据`, `天行数据/tianapi` and 阿里云市场 have **no 紫微斗数 endpoint** (八字 only).
- Glama's single-digit download figures were read through page summarisation; treat as
  approximate. Smithery "uses" is a tool-call metric, not installs. mcp-get's `uniqueInstalls`
  reads 0 for all 15,937 of its packages and was disregarded as unpopulated.
- Activity claims go stale. Re-verify §1–§3 and §7 before quoting any of this after roughly 2026-10.
