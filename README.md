# Ziwei MCP (`@lhk714/ziwei-mcp`)

[![npm version](https://img.shields.io/npm/v/@lhk714/ziwei-mcp.svg)](https://www.npmjs.com/package/@lhk714/ziwei-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/listen-hai/ziwei-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/listen-hai/ziwei-mcp/actions/workflows/ci.yml)
[![Bun](https://img.shields.io/badge/runtime-Bun%20%7C%20Node-black.svg)]()

> Deterministic Zi Wei Dou Shu (紫微斗数排盘) Model Context Protocol (MCP) server: the `iztro` star-placement engine wrapped in a real astronomical time layer, with every school convention exposed as an explicit parameter.

[中文文档 (Chinese)](README_zh.md) | [English](README.md)

---

## 🌟 Overview

Every Zi Wei library in the ecosystem is ultimately [`iztro`](https://github.com/SylarLong/iztro) — it is the one real engine, and its star placement is correct. What has been missing is a server that feeds it the *right time*.

`@lhk714/ziwei-mcp` is that layer. It gives an LLM a correct chart for **any birthplace on Earth, in any year from 1900 through 2100 (Beijing time)**, and names the school convention behind every switch instead of silently picking one.

```
Birth Wall Clock + IANA Timezone  (1990-06-15 20:00 America/Los_Angeles)
                          │
            ┌─────────────┴─────────────┐
            ▼                           ▼
   【Axis A: true UTC instant】   【Axis B: local solar time】
     decides the year ganzhi        longitude [+ Meeus EoT] − DST
    (正月初一 by default, or         decides lunar date + timeIndex
     the exact 立春 instant)          (solarTime: true/mean/off)
            │                           │
            ▼                           ▼
        year ganzhi  ───────────►  iztro star placement
     宫干 · 四化 · 年系星 · 大限      命宫 · 身宫 · 紫微系 · 昌曲空劫火铃
```

### Why the two axes are separate

Zi Wei couples time to the chart in two different ways, and conflating them is the single most common source of wrong charts:

- The **hour, day and month** come from local solar time at the birthplace (Axis B, correction mode set by `solarTime`) — they decide the 命宫/身宫, the 紫微 and 天府 series, and 昌曲/空劫/火铃.
- The **year ganzhi** comes from the resolved birth instant in real physical time (Axis A) — it decides the 宫干 (五虎遁), all 四化, every year-based star, and the 大限 sequence. By default the boundary is 正月初一 (the mainstream 紫微斗数 convention — see `yearDivide` below); the true 立春 instant is available as an opt-in for the 八字/子平术-aligned boundary.

A birth two hours before 立春 in Los Angeles is *after* 立春 in Beijing. When `yearDivide:'lichun'` is in effect, only one of those is the year ganzhi, and getting it wrong invalidates the whole chart, not part of it.

### Known engine bugs this server works around

Both were reproduced against `iztro@2.6.0` and are covered by regression tests:

| | Problem | Handling |
|---|---|---|
| **Z1** | iztro's own `yearDivide:'exact'` divides the year by *calendar date*, not the 立春 *instant* — anyone born on 立春 day before the actual moment (2025's was 22:10) gets the next year's ganzhi, and iztro's own year and month pillars contradict each other. This isn't an iztro-only problem: essentially every downstream tool inherits it, and the one competitor that exposes a 立春 option at all just passes iztro's date-only `'exact'` through under a different label. | This server's own `yearDivide:'lichun'` determines the ganzhi independently on Axis A (the true UTC instant) and feeds iztro a lunar year that reproduces it — as far as this project has found, the only *correct* 立春 implementation in the ecosystem, not merely the only one without the defect. It is opt-in (default is `yearDivide:'lunar_new_year'`, 正月初一 — see Conventions below). Reported as `diagnostics.yearDivideNote`. |
| **Z2** | Under `dayDivide:'forward'` the calculation shifts to the next day but the reported `lunarDate` does not. | iztro's `lunarDate`/`chineseDate`/`solarDate` are never passed through; the lunar date is computed in this layer. |

Two upstream calendar defects are also worked around: a leap month that does not exist is rejected rather than silently charted as the ordinary month, and 闰月三十 births (17 such days between 1900 and 2100, e.g. 2017-08-21) build correctly instead of throwing.

---

## 🚀 Quickstart

```bash
bunx @lhk714/ziwei-mcp@latest
```

```bash
npx -y @lhk714/ziwei-mcp@latest
```

---

## ⚙️ MCP Client Configuration

```json
{
  "mcpServers": {
    "ziwei": {
      "command": "npx",
      "args": ["-y", "@lhk714/ziwei-mcp@latest"]
    }
  }
}
```

> `@latest` re-resolves from the registry on every client launch — that's deliberate, so you always get fixes — but it costs a network round-trip at startup and fails hard offline. For an offline or latency-sensitive setup, pin an exact version instead, e.g. `@lhk714/ziwei-mcp@0.2.0`.

---

## 🛠️ Tools

### 1. `calculate_ziwei`

Requires `gender`, one of `solarDate`/`lunarDate`, one of `clockTime`/`shichen`, and a location (`place`, or `longitude` + `timezone`).

**Location** — `place` (English city name), or `longitude` + `timezone` (IANA name). A timezone is never inferred from longitude.

**Date & time** — `solarDate` or `lunarDate` (+ `lunarDateFrame`: `local` | `beijing`); `clockTime` or `shichen`; `dstFold` (`0`/`1`) to disambiguate a DST fall-back hour.

**School conventions** — all optional, all reported back in `diagnostics.convention`:

| Parameter | Values | Meaning |
|---|---|---|
| `yearDivide` | `lunar_new_year` (default, 正月初一) · `lichun` | Year-ganzhi boundary — 正月初一 is the mainstream 紫微斗数 convention; `lichun` (the true 立春 instant) is 八字/子平术's own boundary and is offered as a correct, opt-in alternative — see Z1 above |
| `ageDivide` | `normal` (default) · `birthday` | 小限 boundary |
| `dayDivide` | `forward` (default) · `current` | Whether 晚子时 (23:00–24:00) rolls to the next day — `forward` matches iztro's own factory default (and 测测/ziwei.pub) |
| `algorithm` | `default` (通行版) · `zhongzhou` (中州派) | Star-placement algorithm |
| `astroType` | `heaven` · `earth` · `human` | 天/地/人盘 — effective under either `algorithm`, not Zhongzhou-only |
| `fixLeap` | boolean (default `true`) | Split leap months at the 15th (闰月十五日为界) — matches iztro's own factory default |
| `solarTime` | `true` (default) · `mean` · `off` | Solar time correction mode: `true` applies both the longitude correction and the equation of time (full True Solar Time); `mean` applies only the longitude correction, no equation of time (地方平太阳时); `off` applies neither, using the wall clock as given. When the applied correction moves a birth across a 时辰 boundary, `diagnostics.trueSolarNote` names both the corrected and uncorrected shichen, the correction size, and the classical caution 「不准但用三时断，时有差误不可凭」 |
| `trueSolar` | boolean, **deprecated** | Superseded by `solarTime` (`true` → `"true"`, `false` → `"off"`) — kept as an alias; supplying both is rejected if they disagree |
| `mutagens` | `{ "甲": ["廉贞","破军","武曲","太阳"], … }` | Override 四化 per heavenly stem |
| `brightness` | `{ "紫微": ["庙","旺",…], … }` | Override star brightness |

> Every convention default here was audited against the ecosystem (iztro's own factory defaults, 测测, ziwei.pub) as of 0.2.0. `dayDivide` and `fixLeap` previously diverged from iztro's own factory defaults by accident, not by deliberate school choice — that has been corrected. `yearDivide`/`horoscopeDivide` defaulting to `lunar_new_year` is the project owner's doctrinal ruling: 立春 belongs to 八字/子平术, not to this system's own star-placement apparatus. `yearDivide:'lichun'` remains fully supported — the Z1 machinery behind it is unchanged and still, as far as this project has found, the only *correct* 立春 implementation in the ecosystem.
>
> `algorithm: 'zhongzhou'`'s behavior has been exhaustively mapped against iztro, but only compared to secondhand online sources for Zhongzhou-school (王亭之) doctrine, not the original texts. One known contradiction: it does **not** change 四化 (庚/壬 stay on the textbook table, not the documented Zhongzhou one) — use `config.mutagens` if you need Zhongzhou 四化. `astroType:'earth'/'human'` combined with `algorithm:'default'` is rejected outright (not just unverified): it would return a chart whose 命主 contradicts its own 命宫.

**Not supported: unknown birth time.** 命宫, 身宫, 文昌/文曲, 火星/铃星 and 地空/地劫 all depend on the hour. Without it there is no chart, so the request is rejected rather than answered with a partial one. `shichen` is supported; when true-solar correction pushes a spoken shichen across a boundary, the response carries `shichenAmbiguity` with the candidate `timeIndex` values instead of a confidently wrong single chart.

**Output** — trimmed to keep an LLM's context usable: the 12 palaces with their stems, branches, major/minor/adjective stars, brightness, 四化 and 大限 range, plus 命宫/身宫, 命主/身主, 五行局, the lunar date, and a `diagnostics` block recording the exact instant, both axes, the longitude and equation-of-time corrections, the conventions applied, and any warnings.

### 2. `calculate_ziwei_horoscope`

运限 — the moving chart: 大限 (decade), 小限 (minor year), 流年/流月/流日/流时 (year/month/day/hour), each with its own 四化 and 运曜. Takes the same birth contract as `calculate_ziwei`, plus a `target` (solar date + clock time, resolved through the same time layer — solar time correction mode, IANA, DST). Omit `target` for "now".

It is a separate tool on purpose: folding six scopes × twelve palaces of 运曜 into the natal response would blow up an LLM's context for callers who only wanted the chart.

iztro's 运限 *arithmetic* is sound — an independent implementation of the classical rules agrees with it. The CI-gated suite checks 200 seeded charts × 4 targets on every run; a one-time full manual sweep (`bun run tests/horoscope-parity-reference.mjs 800 10`) went further, agreeing across **303,582 assertions, zero mismatches**. Its *interface* needed wrapping, and this tool does it:

- The year-ganzhi bypass that keeps the natal chart correct silently poisons every age-derived scope, because 虚岁 is `target lunar year − fed lunar year + 1`. Compensated per scope — 流月/流日/流时 always come from the true target, since 流日 is JDN-based and not 60-year periodic.
- `horoscopeDivide` is locked: under iztro's `'exact'`, 流年 divides at 立春 while 虚岁/大限/小限 divide at 正月初一, so one response contradicts itself six days a year.
- iztro's config is global and `horoscope()` reads it lazily, so one caller's school override would otherwise rewrite later callers' charts.
- `ageDivide: 'birthday'` is **rejected** here: it flips on the 1st of the month *after* the birth month and ignores the birth day, so honouring it would silently mean something other than what it says.
- Targets before the birth are rejected (iztro returned `index: -1` and untranslated i18n keys, silently), and a late-Zi target is normalized (`dayDivide` does not affect `horoscope()` at all).

Under `yearDivide:'lichun'`, age reckoning uses the 立春-designated birth year against a 正月初一 target axis. That asymmetry is a deliberate, documented convention choice, not an accident — the diagnostics report it, and the tests pin it. (Under the default `yearDivide:'lunar_new_year'`, the birth side is simply the true lunar year — there is no asymmetry to reckon with.)

### 3. `lookup_location`

Resolves an English city name to longitude, latitude and IANA timezone across 7,329 cities in 227 countries. Ambiguous names (e.g. "Los Angeles", which exists in both the US and Chile) are refused with the candidate list rather than guessed.

---

## 🧭 Four Pillars

This server does not calculate Bazi. Use [`@lhk714/bazi-mcp`](https://github.com/listen-hai/bazi-mcp) — it shares this time layer, so the two agree by construction.

---

## 🧪 Verification

`bun test` — every test below passing, including:

- An **independent implementation of the classical star-placement rules** (安星诀) from the source texts, checked against iztro across hundreds of seeded random charts and ~18,000 assertions. This is what pins the engine: an upstream change to any star's placement fails the suite.
- 立春-boundary scans asserting the year ganzhi flips **exactly once, at the true instant** — the regression guard for Z1.
- Differential batteries over 20 regular and 20 pathological timezones (date-line crossings, 45-minute offsets, historical upheavals), DST gaps and folds, leap months, and both lunar date frames.
- The full input-validation matrix, and real stdio end-to-end tests against the built binary.

External comparison against [ziwei.pub](https://ziwei.pub) (iztro's own demo) is manual and **not** part of the automated suite.

---

## 📜 License

MIT. Star placement by [`iztro`](https://github.com/SylarLong/iztro) (MIT).
