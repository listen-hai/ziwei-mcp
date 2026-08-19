# 紫微斗数 MCP (`@lhk714/ziwei-mcp`)

[![npm version](https://img.shields.io/npm/v/@lhk714/ziwei-mcp.svg)](https://www.npmjs.com/package/@lhk714/ziwei-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/listen-hai/ziwei-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/listen-hai/ziwei-mcp/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-121%20passed%2C%200%20failed-brightgreen.svg)]()
[![Bun](https://img.shields.io/badge/runtime-Bun%20%7C%20Node-black.svg)]()

> 确定性紫微斗数排盘 MCP 服务：以 `iztro` 为安星引擎，外面包一层真实的天文时间层，并把每一个流派选择显式暴露成参数。

[中文文档](README_zh.md) | [English](README.md)

---

## 🌟 这个项目解决什么

紫微生态里真正的引擎只有一个 —— [`iztro`](https://github.com/SylarLong/iztro)，而且它的安星是对的。缺的从来不是安星，是**把正确的时间喂给它**。

`@lhk714/ziwei-mcp` 就是这一层：让 LLM 对**任意出生地、1900–2100 任意年代（以北京时年份为界）**拿到正确的星盘，并且每一个开关背后是哪个流派，都写明白，而不是默默替你选一个。

```
出生墙钟 + IANA 时区   (1990-06-15 20:00 America/Los_Angeles)
                          │
            ┌─────────────┴─────────────┐
            ▼                           ▼
     【轴 A：真实 UTC 瞬时】      【轴 B：当地真太阳时】
      在真正的立春时刻定年干支      经度 + Meeus 时差方程 − 夏令时
            │                      定农历日期与时辰序号
            ▼                           ▼
         年干支  ─────────────►    iztro 安星
    宫干 · 四化 · 年系星 · 大限    命宫 · 身宫 · 紫微系 · 昌曲空劫火铃
```

### 为什么必须拆成两根轴

紫微对时间的耦合有两种，混在一起是错盘最常见的来源：

- **时辰、日、月**取当地真太阳时（轴 B），决定命宫/身宫、紫微系与天府系、昌曲/空劫/火铃。
- **年干支**取真实物理时间里的立春瞬时（轴 A），决定宫干（五虎遁）、全部四化、所有年系星、以及大限。

洛杉矶立春前两小时出生的人，在北京已经过了立春。年干支只能是其中一个，而选错的后果不是错一部分，是**整盘作废**。

### 已绕过的引擎缺陷

以下均在 `iztro@2.6.0` 上复现，并有回归测试钉死：

| | 问题 | 处理 |
|---|---|---|
| **Z1** | `yearDivide:'exact'` 只按**日期**分界，不按立春**时刻**。立春当日在真正立春时刻之前出生的人（2025 年立春在 22:10）被算成下一年干支，而且 iztro 自己输出的年柱与月柱互相矛盾。 | 锁死 `yearDivide:'normal'`，年干支由本服务在轴 A 自行判定，再喂一个能复现该干支的农历年给 iztro。输出中以 `diagnostics.yearDivideNote` 说明。 |
| **Z2** | `dayDivide:'forward'` 下计算已移到次日，但输出的 `lunarDate` 没同步。 | iztro 的 `lunarDate`/`chineseDate`/`solarDate` 一概不透传，农历日期由本层自算。 |

另外绕过两个上游历法缺陷：**不存在的闰月**会被拒绝，而不是静默按平月出盘；**闰月三十**（1900–2100 共 17 天，如 2017-08-21）能正常排盘，而不是直接抛错。

---

## 🚀 快速开始

```bash
bunx @lhk714/ziwei-mcp
```

```bash
npx -y @lhk714/ziwei-mcp
```

---

## ⚙️ MCP 客户端配置

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

## 🛠️ 工具

### 1. `calculate_ziwei`

必填 `gender`，`solarDate`/`lunarDate` 二选一，`clockTime`/`shichen` 二选一，以及出生地（`place`，或 `longitude` + `timezone`）。

**出生地** —— `place`（英文城市名），或 `longitude` + `timezone`（IANA 时区名）。**绝不从经度推断时区。**

**日期与时刻** —— `solarDate` 或 `lunarDate`（配 `lunarDateFrame`：`local` | `beijing`）；`clockTime` 或 `shichen`；`dstFold`（`0`/`1`）用于消解夏令时回拨造成的重复小时。

**流派开关** —— 全部可选，且全部在 `diagnostics.convention` 中回报：

| 参数 | 取值 | 含义 |
|---|---|---|
| `yearDivide` | `lichun`（默认）· `lunar_new_year` | 年干支分界 |
| `ageDivide` | `normal`（默认）· `birthday` | 小限分界 |
| `dayDivide` | `current`（默认）· `forward` | 晚子时（23:00–24:00）是否算次日 |
| `algorithm` | `default`（通行版）· `zhongzhou`（中州派） | 安星算法 |
| `astroType` | `heaven` · `earth` · `human` | 天/地/人盘，仅中州派有意义 |
| `fixLeap` | boolean | 闰月以十五日为界修正 |
| `trueSolar` | boolean（默认 `true`） | 是否应用真太阳时修正 |
| `mutagens` | `{ "甲": ["廉贞","破军","武曲","太阳"], … }` | 按天干覆盖四化 |
| `brightness` | `{ "紫微": ["庙","旺",…], … }` | 覆盖星曜亮度 |

> `algorithm: 'zhongzhou'` 与 `astroType` 仅做透传，**未对照中州派典籍验证**；暴露出来是为了完整，不代表背书。

**不支持「时辰不详」。** 命宫、身宫、文昌文曲、火星铃星、地空地劫全部依赖时辰，没有时辰就没有盘 —— 因此直接拒绝，而不是给一张残盘。`shichen`（口传时辰）是支持的；当真太阳时修正把口述时辰推出边界时，响应会带上 `shichenAmbiguity` 与候选 `timeIndex`，而不是给一张假装确定的盘。

**输出**做了裁剪，以免挤爆 LLM 上下文：十二宫的宫干支、主星/辅星/杂耀、亮度、四化与大限范围，加上命宫/身宫、命主/身主、五行局、农历日期，以及 `diagnostics` 诊断块 —— 记录精确瞬时、两根轴、经度修正与时差方程、实际生效的流派、以及全部 warning。

### 2. `lookup_location`

把英文城市名解析为经纬度与 IANA 时区，覆盖 227 个国家 7,329 座城市。同名歧义（例如「Los Angeles」在美国和智利都有）会**列出候选并拒绝**，不猜。

---

## 🧭 四柱八字

本服务**不算八字**。需要四柱请用 [`@lhk714/bazi-mcp`](https://github.com/listen-hai/bazi-mcp) —— 两者共用同一套时间层，结果天然对齐。

---

## 🧪 验证

`bun test` —— **121 个测试**，其中包括：

- 一套**独立实现的古籍安星诀**，与 iztro 对拍数百张种子随机盘、约 18,000 项断言。这是钉死引擎的东西：上游任何一颗星的安放变了，测试就会红。
- 立春边界逐时辰扫描，断言年干支**必须且只能在真实立春时刻翻一次** —— Z1 的回归防线。
- 20 个常规时区 + 20 个病态时区（跨日界、45 分钟时区、历史剧变）的差分对拍，夏令时空洞与歧义，闰月，以及两种农历参照系。
- 完整的输入校验矩阵，以及针对构建产物的真实 stdio 端到端测试。

与 [ziwei.pub](https://ziwei.pub)（iztro 官方 demo）的外部对拍属于人工操作，**不在**自动化套件内。

---

## 📜 许可

MIT。安星引擎为 [`iztro`](https://github.com/SylarLong/iztro)（MIT）。
