# 实测基线（实现前的探针结论）

日期：2026-08-18　环境：bun 1.3.6 / macOS arm64
探针脚本：`docs/parity-reference.mjs`（§8.1 安星对拍，可直接移植进 `tests/`）

## P1 — iztro 2.6.0 仍是 npm latest，安星基线成立 ✅

`npm view iztro version` → `2.6.0`（与 spec 撰写时一致，无漂移）。

跑 spec §8.1 的古籍安星诀对拍：**800 张随机盘（1930–2019）、50,104 项断言、0 处不符。**

覆盖：命宫/身宫、五行局、十二宫干（五虎遁）、紫微系 6 星、天府系 8 星、左辅右弼、
文昌文曲、禄存擎羊陀罗、天魁天钺、地空地劫、火星铃星、天马、红鸾天喜、四化、
十二宫名序、命宫大限起始年龄。

> 注：spec §8.1 的 `MUT` 表**缺 庚 干**（庚干四化历来有争议，spec 有意留空）。
> 实测 iztro 2.6.0 用的是：**庚 → 太阳禄、武曲权、太阴科、天同忌**。
> 对拍脚本对庚干不断言；若要断言，用这一组并标注为「iztro 版本快照」而非古籍共识。

> 注：spec §8.1 注释写 `十二宫名 = PALACES[(命宫 - 本宫) mod 12]`，方向易写反。
> 正确即字面意思：以**地支序**算 `(idx(命宫支) - idx(本宫支)) mod 12`（宫名逆时针排布）。

## P2 — Z1 绕过方案（feedYear）成立，但有一个 spec 未覆盖的崩溃点 ⚠️

喂不同农历年号确实且只改变「年干支派生」的东西，**这正是我们要的**：
年干 → 宫干（五虎遁）→ 命宫纳音 → 五行局 → **紫微起宫 → 全部主星位置**；
年干支阴阳 → 大限顺逆 → `decadal.range` / `ages`；年支 → 火铃马鸾喜、博士12/将前12/岁前12。

**但被污染、必须丢弃不透传的字段**（与 spec §5 的 Z2 规则合并成同一条铁律）：

```
solarDate  lunarDate  chineseDate  rawDates  sign
```

`zodiac`（生肖）来自年支，喂入后是正确的，但仍建议自算以免耦合。

### P2a — 崩溃点：喂入年的该月天数不足时 iztro 直接抛错

```
astro.withOptions({type:'lunar', dateStr:'1929-3-30', ...})
  → Error: only 29 days in lunar year 1929 month 3
```

**可达性**：`yearDivide:'lichun'` 下，只有「立春已过、正月初一未到」的窗口需要
`feedYear = lunarYear + 1`，此时农历月恒为 **腊月**、日可达 **三十**。
若次年腊月只有 29 天 → 抛错，整盘失败。这是真实线上路径，不是理论边界。

### P2b — 修复（已实测验证）：feedYear 只需干支相同，干支 60 年一轮

**实测：喂 Y 与喂 Y+60，剥离上面 5 个日历字段后，400/400 张盘完全相同。**

所以 `lunarYearForGanZhi()` 的正确语义是：
> 在「干支 ≡ 目标」的年份集合里，挑一个该农历月天数 ≥ 生日日数的年份。
> 先试最近的（`lunarYear ± 1`），不够则 `± 60` 继续找。找不到才报错。

不要写成「固定 lunarYear ± 1」——那会在腊月三十的盘上崩掉。

### P2c — 闰月不会与 feedYear 窗口相撞

扫描 1800–2100：**闰正月 / 闰腊月 零次出现**。
feedYear 位移窗口只落在正月与腊月，因此位移永不需要跨闰月，`isLeapMonth` 可原样透传。
（仍建议留一条防御性 assert：若位移窗口内 `isLeapMonth === true` → 报错而非静默出盘。）

## P3 — Z2 复现 ✅

```
dayDivide=current  ti=12  紫微@午   lunarDate "二〇〇〇年二月初一"
dayDivide=forward  ti=12  紫微@亥   lunarDate "二〇〇〇年二月初一"  ← 计算移位了，显示没同步
```

## P4 — timeIndex 0 vs 12 的精确差异（供 §8.3 写断言用）

`dayDivide:'current'` 下，ti=0 与 ti=12 的**星盘完全相同**，差异只有两个展示字段：

```
time:      "早子时" vs "晚子时"
timeRange: "00:00~01:00" vs "23:00~00:00"
```

写不变量测试时按此断言（剥离 time/timeRange 后深等），不要笼统写「完全相同」。

## P5 — 依赖可用性 ✅

`iztro@2.6.0` `lunar-lite@0.2.8`（iztro 自己的农历依赖，直接声明，保证与引擎同表）
`@openfate/bazi-engine@1.1.2` `@openfate/true-solar-time@4.0.2`（bazi-mcp 同款，公开可装）

`lunar-lite` API（注意签名，容易踩）：
```js
lunar2solar('2000-7-17', false) -> {solarYear,solarMonth,solarDay}
solar2lunar('2000-08-16')       -> {lunarYear,lunarMonth,lunarDay,isLeap}
getTotalDaysOfLunarMonth('2000-08-16')  // 收的是【公历日期串】，不是 (y,m)
```
