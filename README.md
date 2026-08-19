# Ziwei MCP (`@lhk714/ziwei-mcp`)

[![npm version](https://img.shields.io/npm/v/@lhk714/ziwei-mcp.svg)](https://www.npmjs.com/package/@lhk714/ziwei-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/listen-hai/ziwei-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/listen-hai/ziwei-mcp/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-131%20passed%2C%200%20failed-brightgreen.svg)]()
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
   【Axis A: true UTC instant】   【Axis B: local true solar time】
     decides the year ganzhi        longitude + Meeus EoT − DST
     at the exact 立春 moment       decides lunar date + timeIndex
            │                           │
            ▼                           ▼
        year ganzhi  ───────────►  iztro star placement
     宫干 · 四化 · 年系星 · 大限      命宫 · 身宫 · 紫微系 · 昌曲空劫火铃
```

### Why the two axes are separate

Zi Wei couples time to the chart in two different ways, and conflating them is the single most common source of wrong charts:

- The **hour, day and month** come from local true solar time at the birthplace (Axis B) — they decide the 命宫/身宫, the 紫微 and 天府 series, and 昌曲/空劫/火铃.
- The **year ganzhi** comes from the true 立春 instant in real physical time (Axis A) — it decides the 宫干 (五虎遁), all 四化, every year-based star, and the 大限 sequence.

A birth two hours before 立春 in Los Angeles is *after* 立春 in Beijing. Only one of those is the year ganzhi, and getting it wrong invalidates the whole chart, not part of it.

### Known engine bugs this server works around

Both were reproduced against `iztro@2.6.0` and are covered by regression tests:

| | Problem | Handling |
|---|---|---|
| **Z1** | `yearDivide:'exact'` divides the year by *calendar date*, not the 立春 *instant*. Anyone born on 立春 day before the actual moment (2025's was 22:10) gets the next year's ganzhi — and iztro's own year and month pillars contradict each other. | `yearDivide` is locked to `'normal'`; this server determines the ganzhi itself on Axis A and feeds iztro a lunar year that reproduces it. Reported as `diagnostics.yearDivideNote`. |
| **Z2** | Under `dayDivide:'forward'` the calculation shifts to the next day but the reported `lunarDate` does not. | iztro's `lunarDate`/`chineseDate`/`solarDate` are never passed through; the lunar date is computed in this layer. |

Two upstream calendar defects are also worked around: a leap month that does not exist is rejected rather than silently charted as the ordinary month, and 闰月三十 births (17 such days between 1900 and 2100, e.g. 2017-08-21) build correctly instead of throwing.

---

## 🚀 Quickstart

```bash
bunx @lhk714/ziwei-mcp
```

```bash
npx -y @lhk714/ziwei-mcp
```

---

## ⚙️ MCP Client Configuration

```json
{
  "mcpServers": {
    "ziwei": {
      "command": "npx",
      "args": ["-y", "@lhk714/ziwei-mcp"]
    }
  }
}
```

---

## 🛠️ Tools

### 1. `calculate_ziwei`

Requires `gender`, one of `solarDate`/`lunarDate`, one of `clockTime`/`shichen`, and a location (`place`, or `longitude` + `timezone`).

**Location** — `place` (English city name), or `longitude` + `timezone` (IANA name). A timezone is never inferred from longitude.

**Date & time** — `solarDate` or `lunarDate` (+ `lunarDateFrame`: `local` | `beijing`); `clockTime` or `shichen`; `dstFold` (`0`/`1`) to disambiguate a DST fall-back hour.

**School conventions** — all optional, all reported back in `diagnostics.convention`:

| Parameter | Values | Meaning |
|---|---|---|
| `yearDivide` | `lichun` (default) · `lunar_new_year` | Year-ganzhi boundary |
| `ageDivide` | `normal` (default) · `birthday` | 小限 boundary |
| `dayDivide` | `current` (default) · `forward` | Whether 晚子时 (23:00–24:00) rolls to the next day |
| `algorithm` | `default` (通行版) · `zhongzhou` (中州派) | Star-placement algorithm |
| `astroType` | `heaven` · `earth` · `human` | 天/地/人盘, Zhongzhou school only |
| `fixLeap` | boolean | Split leap months at the 15th |
| `trueSolar` | boolean (default `true`) | Apply true solar time correction |
| `mutagens` | `{ "甲": ["廉贞","破军","武曲","太阳"], … }` | Override 四化 per heavenly stem |
| `brightness` | `{ "紫微": ["庙","旺",…], … }` | Override star brightness |

> `algorithm: 'zhongzhou'` and `astroType` are passed through but **not verified** against Zhongzhou-school sources — they are exposed for completeness, not endorsed.

**Not supported: unknown birth time.** 命宫, 身宫, 文昌/文曲, 火星/铃星 and 地空/地劫 all depend on the hour. Without it there is no chart, so the request is rejected rather than answered with a partial one. `shichen` is supported; when true-solar correction pushes a spoken shichen across a boundary, the response carries `shichenAmbiguity` with the candidate `timeIndex` values instead of a confidently wrong single chart.

**Output** — trimmed to keep an LLM's context usable: the 12 palaces with their stems, branches, major/minor/adjective stars, brightness, 四化 and 大限 range, plus 命宫/身宫, 命主/身主, 五行局, the lunar date, and a `diagnostics` block recording the exact instant, both axes, the longitude and equation-of-time corrections, the conventions applied, and any warnings.

### 2. `lookup_location`

Resolves an English city name to longitude, latitude and IANA timezone across 7,329 cities in 227 countries. Ambiguous names (e.g. "Los Angeles", which exists in both the US and Chile) are refused with the candidate list rather than guessed.

---

## 🧭 Four Pillars

This server does not calculate Bazi. Use [`@lhk714/bazi-mcp`](https://github.com/listen-hai/bazi-mcp) — it shares this time layer, so the two agree by construction.

---

## 🧪 Verification

`bun test` — **131 tests**, including:

- An **independent implementation of the classical star-placement rules** (安星诀) from the source texts, checked against iztro across hundreds of seeded random charts and ~18,000 assertions. This is what pins the engine: an upstream change to any star's placement fails the suite.
- 立春-boundary scans asserting the year ganzhi flips **exactly once, at the true instant** — the regression guard for Z1.
- Differential batteries over 20 regular and 20 pathological timezones (date-line crossings, 45-minute offsets, historical upheavals), DST gaps and folds, leap months, and both lunar date frames.
- The full input-validation matrix, and real stdio end-to-end tests against the built binary.

External comparison against [ziwei.pub](https://ziwei.pub) (iztro's own demo) is manual and **not** part of the automated suite.

---

## 📜 License

MIT. Star placement by [`iztro`](https://github.com/SylarLong/iztro) (MIT).
