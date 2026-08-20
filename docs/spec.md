# 紫微斗数排盘 MCP —— 实现规格书

> 交付给 Claude Code 的实现说明。事实性结论均来自实测（安装 iztro 2.6.0、独立实现古籍安星诀对拍、逐项探测配置行为），非文档推断。
> 撰写日期：2026-08-17。依赖版本会漂移，实现前先跑第 8 节回归套件确认基线仍成立。
> 姊妹项目：`bazi-mcp`（八字）。**时间层直接复用，不重写。**

---

## 1. 目标

构建紫微斗数排盘 MCP server，要求：**对任意出生地、任意年代给出正确的星盘**，并把流派选择显式暴露成参数。

### 非目标

- 命理解读（交给上层 LLM）
- 安星算法（**用 iztro，不手搓**，见第 3 节）
- 前端可视化（需要时用 `react-iztro`）
- 八字四柱（调 `bazi-mcp`，不要用 iztro 的 `chineseDate`）

---

## 2. 生态调研结论

**紫微生态只有一个真引擎：`SylarLong/iztro`。** 所有紫微 MCP、网站、Flutter/Dart/Python 移植，底下全是它。

| 项目 | 定位 | 引擎 | 说明 |
|---|---|---|---|
| **SylarLong/iztro** | JS/TS 库，MIT | 自研安星 + `lunar-lite` / `lunar-typescript` | 唯一真引擎 |
| SylarLong/react-iztro | React 星盘组件 | iztro | 可视化用 |
| EdwinXiang/dart_iztro | Flutter 移植 | iztro 的 Dart 重写 | 与上游可能漂移 |
| smogievogie/ziwei_iztro-mcpserver | MCP，MIT | iztro | 唯一处理真太阳时的 MCP；绑死高德 API、仅覆盖中国境内、无 IANA 时区、无历史夏令时 |
| spyfree/mingli-mcp | MCP，Python，紫微+八字 | 不明 | 未实测 |
| SiwuXue/ziwei-mcp / Timmy9527/agentziwei | MCP | 不明 | 偏解读产品 |
| ziweiknows/ziwei-chart | Web 应用，**GPL-3.0** | iztro | GPL 传染，商用注意 |
| Renhuai123/ziwei-doushu | Next.js + 倪海厦体系知识库 | iztro + lunar-javascript | 知识库有价值 |

**没有任何一个 MCP 是「iztro + 完整时间处理」。** 这就是本项目的位置。

> **2026-08-19 更正：上面这句已不成立。** `Brhiza/mingyu`（343★）确有完整时间层
> （`historical-timezone.ts` / `china-dst.ts` / `true-solar-time.ts` 含时差方程）。
> 本项目真正独有的是 **Z1 绕过**：mingyu 把 `yearDivide` 直接透传给 iztro，
> 并把 `'exact'` 标注为「以立春分年」（`runtime-helpers.ts:139`）——
> 而 iztro 的 `'exact'` 只按**日期**分界，不按立春时刻。即它带着 Z1 且标错了名。
> 完整调研见 `docs/competitive-landscape.md`。

---

## 3. 技术路线决策

**采用：`iztro` 作为排盘引擎，外面包一层时间处理 + 流派解耦 + 输出裁剪。**

### 为什么不手搓安星

已用独立实现的古籍安星诀与 iztro 对拍（详见第 8.1 节脚本），**11600+ 项、800 张随机盘、零处不符**：

命宫、身宫、五行局、紫微、紫微系 5 星、天府系 8 星、左辅右弼、文昌文曲、禄存擎羊陀罗、天魁天钺、地空地劫、火星铃星、天马、红鸾天喜、四化（10 干 × 4）、十二宫名序、大限起始年龄 —— 全对。

自己写安星是数千行加无穷校对，而 iztro 已经是对的。**这一层别碰。**

### 依赖

```
iztro                     ^2.6.0   MIT
@modelcontextprotocol/sdk ^1.10
zod                       ^3.24
geo-tz / city-timezones            （与 bazi-mcp 相同）
```

**pin 精确版本 + 快照测试。** iztro 的安星表随版本可能微调。

### 从 bazi-mcp 直接复用（一行不改）

- `wallToInstant` / `tzOffsetMinutes`（IANA 历史时区，含全部 DST）
- 标准偏移推定（出生瞬时 ±183 天取 min）
- 经度归一化（日界线，`lon*4` 相对标准中央经线归一到 ±720）
- Meeus 时差方程
- DST 空洞 / 歧义检测 + `dstFold`
- `place` 解析 + `locationSource`
- ±240 分钟物理合理性检查
- 诊断块框架

**这是本项目最贵的部分，而它已经写完了。**

---

## 4. 核心原理：双时间轴在紫微里的形态

紫微比八字**简单**。轴 B 承担绝大部分，轴 A 只在立春换年时需要。

| 维度 | 八字 | 紫微 |
|---|---|---|
| 时辰 | 当地真太阳时（轴 B） | **同样**（轴 B），决定命宫/身宫/昌曲/火铃/空劫 |
| 日 | 当地真太阳时定日界（轴 B） | **同样**（轴 B），农历日决定紫微星安放 |
| 月 | 节气定月（轴 A） | **农历月**（轴 B），无节气 |
| 年 | 立春定年（轴 A） | 可配：立春（轴 A）/ 正月初一（轴 B） |
| 起运 | 节气距离折算（轴 A） | **五行局定**（水二局起 2 岁…），与节气无关 |

紫微的耦合关系：

```
农历月 + 日 + 时辰  ──►  宫位定位、紫微系与天府系星、昌曲空劫
年干支             ──►  宫干（五虎遁）、四化、年系星（禄存羊陀魁钺马鸾喜火铃）、大限干支
```

**这两组可以分开喂** —— 这是绕开 iztro bug 的关键（第 5 节）。

---

## 5. iztro 的两个已知 bug 与绕过方案

### Z1｜`yearDivide:'exact'` 只按日期，不按立春时刻 —— 必须绕过

实测：

```
2024-02-04（立春 16:27）  ti0 甲辰  ti3 甲辰  ti6 甲辰  ti9 甲辰  ti11 甲辰
2025-02-03（立春 22:10）  ti0 乙巳  ti1 乙巳  ti6 乙巳  ti10 乙巳  ti11 乙巳
2021-02-03（立春 22:59）  ti0 辛丑  ti6 辛丑  ti11 辛丑
```

立春当日**所有时辰**都算新年。2025 年立春在晚上 22:10，凌晨出生者被提前 22 小时算成乙巳年。

更硬的证据：`2024-02-04 ti=6` 输出四柱 `甲辰 丁丑` —— 年柱说已过立春，月柱却是甲辰年**年末**的丑月（2025 年 1 月）。年月柱不同源，内部自相矛盾，这不是流派选择。

影响：年干支错 → 宫干、四化、全部年系星、大限干支全错。约每年半天的出生人口，**整盘作废**。且对中国境内出生者同样生效。

**绕过（已验证）**：自己在轴 A 上判定年干支，然后用 `type:'lunar'` + `yearDivide:'normal'` 喂进去 —— 此时 iztro 的年干支直接等于所传农历年的干支，不走立春逻辑。

```ts
import { astro } from 'iztro';

export function chart({ instant, tz, longitude, gender, opts }) {
  // ── 轴 B：当地真太阳时（复用 bazi-mcp 的实现）
  const localSolar = toLocalTrueSolar(instant, tz, longitude);
  const { lunarYear, lunarMonth, lunarDay, isLeapMonth } = toLunar(localSolar);
  const timeIndex = toTimeIndex(localSolar, opts.dayDivide);   // 0..12，12 = 晚子时

  // ── 轴 A：真实 UTC 瞬时判定立春，得到正确年干支
  const yearGanZhi = opts.yearDivide === 'lichun'
    ? yearPillarByLichun(instant)          // 复用 bazi-mcp 的轴 A
    : lunarYearGanZhi(lunarYear);          // 正月初一换年

  // ── 用「能产生该年干支的农历年」喂 iztro，锁死 yearDivide:'normal'
  const feedYear = lunarYearForGanZhi(yearGanZhi, lunarYear);   // 通常 = lunarYear 或 ±1

  return astro.withOptions({
    type: 'lunar',
    dateStr: `${feedYear}-${lunarMonth}-${lunarDay}`,
    timeIndex,
    gender,
    isLeapMonth,
    fixLeap: opts.fixLeap ?? false,
    language: opts.language ?? 'zh-CN',
    astroType: opts.astroType ?? 'heaven',
    config: {
      yearDivide: 'normal',                 // 恒为 normal，立春由我们自己判
      horoscopeDivide: 'normal',            // 同上，运限换年也自己判
      ageDivide: opts.ageDivide ?? 'normal',
      dayDivide: opts.dayDivide ?? 'current',
      algorithm: opts.algorithm ?? 'default',
      mutagens: opts.mutagens,
      brightness: opts.brightness,
    },
  });
}
```

`horoscopeDivide` 同理，也要锁 `'normal'` 并自己判流年边界，否则流年会继承同一个 bug。

### Z2｜`dayDivide:'forward'` 显示与计算不同步

```
dayDivide=current  ti=12   lunarDate "二月初一"   紫微在酉宫
dayDivide=forward  ti=12   lunarDate "二月初一"   紫微在午宫   ← 计算用了初二，显示还是初一
```

计算是对的（紫微星按次日移位），但 `lunarDate` 字段没同步。

### 由此得出两条硬性规则

- **不要透传 iztro 的 `chineseDate`。** 四柱调 `bazi-mcp`。
- **不要透传 iztro 的 `lunarDate`。** 农历日期在包装层自己算完后输出。

---

## 6. 输入契约

```ts
type ZiweiInput = {
  // ── 出生地（与 bazi-mcp 完全一致）──
  place?: string;
  longitude?: number;
  timezone?: string;                       // IANA 名，绝不从经度推断

  // ── 日期 ──
  solarDate?: { year: number; month: number; day: number };
  lunarDate?: { year: number; month: number; day: number; isLeapMonth?: boolean };
  lunarDateFrame?: 'local' | 'beijing';    // 默认 'local'

  // ── 时刻 ──
  clockTime?: { hour: number; minute: number };
  shichen?: '子'|'丑'|'寅'|'卯'|'辰'|'巳'|'午'|'未'|'申'|'酉'|'戌'|'亥';
  // 注意：不提供 timeUnknown，见下

  dstFold?: 0 | 1;
  gender: 'male' | 'female';

  // ── 紫微流派开关 ──
  yearDivide?: 'lichun' | 'lunar_new_year';   // 默认 'lichun'
  horoscopeDivide?: 'lichun' | 'lunar_new_year';
  ageDivide?: 'normal' | 'birthday';          // 小限分界
  dayDivide?: 'current' | 'forward';          // 晚子时
  algorithm?: 'default' | 'zhongzhou';
  astroType?: 'heaven' | 'earth' | 'human';   // 中州派天/地/人盘
  fixLeap?: boolean;                          // 闰月十五日为界修正
  trueSolar?: boolean;                        // 默认 true
};
```

### 硬性要求（沿用 bazi-mcp 的教训）

- **时区必须传 IANA 名**，不从经度推断。
- **不收纬度**（八字/紫微都用不到）。
- **`additionalProperties: false`**（zod `.strict()`）。参数名拼错必须报错，不能静默忽略。
- **年份范围与引擎对齐**，两层校验用同一个范围、同一套文案。
- **非法公历日期单独报错**，不要混进 DST 空洞的文案。
- `place` 与显式经纬/时区冲突 → 报错或 warning，`locationSource` 反映实际生效来源（`resolved` / `caller_supplied` / `mixed`）。
- `|经度修正| > 240 分钟` → 物理合理性 warning。

### 与八字的关键差异：**不支持 `timeUnknown`**

紫微的命宫、身宫、文昌文曲、火星铃星、地空地劫全部依赖时辰。时辰不详等于没有盘。**必须直接拒绝并说明原因**，不要给残盘。

`shichen` 路径仍需支持（口传时辰很常见），并沿用 bazi-mcp 的歧义标注：真太阳时修正可能把口述时辰推出边界，此时输出 `shichenAmbiguity` 并列出候选 `timeIndex`，**不给假装确定的单一盘**。

### `timeIndex` 映射（iztro 专属）

```
0 = 早子时 (00:00–01:00)
1 = 丑时 … 11 = 亥时 (21:00–23:00)
12 = 晚子时 (23:00–24:00)
```

由当地真太阳时推出。`dayDivide` 决定 12 是否被当作次日。**注意 0 和 12 都是子时，不要合并。**

---

## 7. 输出结构

### 裁剪原则

iztro 原始输出很大（12 宫 × 主星/辅星/杂耀/神煞/流耀 × 亮度 × 四化），直接透传会挤爆 context。裁剪成：

```json
{
  "soulPalace": { "branch": "午", "stem": "戊", "name": "命宫" },
  "bodyPalace": { "branch": "戌" },
  "soul": "破军", "body": "文昌",
  "fiveElementsClass": "木三局",
  "lunar": { "year": 2000, "month": 7, "day": 17, "isLeapMonth": false, "shichen": "寅", "timeIndex": 2 },
  "palaces": [
    { "index": 0, "name": "命宫", "branch": "午", "stem": "戊",
      "isBodyPalace": false,
      "majorStars": [{"name":"破军","brightness":"庙","mutagen":""}],
      "minorStars": [...], "adjectiveStars": ["三台","天寿"],
      "decadal": { "ageRange": [3,12], "stem": "戊", "branch": "午" } }
  ],
  "diagnostics": { ... }
}
```

`adjectiveStars` 只留星名，丢掉 `type`/`scope` 等内部字段。

### 诊断块（复用 bazi-mcp，加紫微专属项）

```json
"diagnostics": {
  "wallClock": "1990-06-15 20:00 (America/Los_Angeles)",
  "utcOffset": "-07:00 (DST in effect)",
  "utcInstant": "1990-06-16T03:00:00Z",
  "axisA_instant_forYearPillar": "1990-06-16 11:00 (Asia/Shanghai)",
  "axisB_localTrueSolarTime": "1990-06-15 18:49",
  "longitudeCorrectionMinutes": -69.78,
  "equationOfTimeMinutes": -0.52,
  "yearGanZhi": "庚午",
  "yearDivideApplied": "lichun",
  "yearDivideNote": "年干支由本服务在真实立春瞬时判定，未使用 iztro 的 yearDivide:'exact'（该模式仅按日期分界）",
  "lunar": { "frame": "local", "solarDate": "1990-06-15", "beijingSameDay": "1990-06-16" },
  "timeIndex": 11,
  "convention": { "yearDivide":"lichun", "ageDivide":"normal", "dayDivide":"current",
                  "algorithm":"default", "astroType":"heaven", "fixLeap":false, "trueSolar":true },
  "locationSource": "caller_supplied",
  "warnings": [],
  "engineInfo": { "iztro": "2.6.0" }
}
```

`yearDivideNote` 很重要 —— 下游 LLM 若知道 iztro 有 Z1，会怀疑输出；显式说明我们绕过了它。

---

## 8. 测试要求

### 8.1 安星回归对拍（核心资产，已验证通过）

这段脚本是独立实现的古籍安星诀，用来锁死 iztro 的版本升级。**原样收进 `tests/`。**

```js
import { astro } from 'iztro';
const Z='子丑寅卯辰巳午未申酉戌亥'.split(''), M=n=>((n%12)+12)%12, idx=b=>Z.indexOf(b);
const WUHUDUN={甲:2,己:2,乙:4,庚:4,丙:6,辛:6,丁:8,壬:8,戊:0,癸:0};   // 年干 → 寅月天干 index
const NAYIN60=['海中金','炉中火','大林木','路旁土','剑锋金','山头火','涧下水','城头土','白蜡金','杨柳木',
'泉中水','屋上土','霹雳火','松柏木','长流水','沙中金','山下火','平地木','壁上土','金箔金','覆灯火','天河水',
'大驿土','钗钏金','桑柘木','大溪水','沙中土','天上火','石榴木','大海水'];
const CLASS={水:2,木:3,金:4,土:5,火:6};
const gzIndex=(g,z)=>{let n=0;while(n<60&&!(n%10===g&&n%12===z))n++;return n;};

const soulPalace=(m,t)=>M(2+(m-1)-t);        // 寅起正月顺数至生月，再起子时逆数至生时
const bodyPalace=(m,t)=>M(2+(m-1)+t);
const palaceStem=(ys,br)=>(WUHUDUN[ys] + M(br-2)) % 10;   // 注意：mod 10，不是 mod 12
function fiveClass(ys,soulBr){
  const ny=NAYIN60[Math.floor(gzIndex(palaceStem(ys,soulBr),soulBr)/2)];
  return { n: CLASS[ny[ny.length-1]], ny };
}
function ziwei(j,d){                          // 局数除日数求商，补数奇逆偶顺
  let n=0; while((d+n)%j!==0) n++;
  const q=(d+n)/j;
  return M(2+q-1+(n%2===0?n:-n));
}
const LU={甲:2,乙:3,丙:5,戊:5,丁:6,己:6,庚:8,辛:9,壬:11,癸:0};
const KUI={甲:1,戊:1,庚:1,乙:0,己:0,丙:11,丁:11,壬:3,癸:3,辛:6};
const YUE={甲:7,戊:7,庚:7,乙:8,己:8,丙:9,丁:9,壬:5,癸:5,辛:2};
const HUO={寅:1,午:1,戌:1,申:2,子:2,辰:2,巳:3,酉:3,丑:3,亥:9,卯:9,未:9};
const LING={寅:3,午:3,戌:3,申:10,子:10,辰:10,巳:10,酉:10,丑:10,亥:10,卯:10,未:10};
const MA={寅:8,午:8,戌:8,申:2,子:2,辰:2,巳:11,酉:11,丑:11,亥:5,卯:5,未:5};
const MUT={甲:['廉贞','破军','武曲','太阳'],乙:['天机','天梁','紫微','太阴'],丙:['天同','天机','文昌','廉贞'],
丁:['太阴','天同','天机','巨门'],戊:['贪狼','太阴','右弼','天机'],己:['武曲','贪狼','天梁','文曲'],
辛:['巨门','太阳','文曲','文昌'],壬:['天梁','紫微','左辅','武曲'],癸:['破军','巨门','太阴','贪狼']};
const PALACES=['命宫','兄弟','夫妻','子女','财帛','疾厄','迁移','仆役','官禄','田宅','福德','父母'];

// 对每盘断言：
//   命宫=soulPalace(m,t)  身宫=bodyPalace(m,t)  五行局=fiveClass(年干,命宫支)
//   紫微=ziwei(局,日)  天机=紫微-1 太阳-3 武曲-4 天同-5 廉贞-8
//   天府=4-紫微  太阴+1 贪狼+2 巨门+3 天相+4 天梁+5 七杀+6 破军+10
//   左辅=4+m-1  右弼=10-(m-1)  文昌=10-t  文曲=4+t
//   禄存=LU[年干]  擎羊=+1  陀罗=-1  天魁=KUI  天钺=YUE
//   地劫=11+t  地空=11-t  火星=HUO[年支]+t  铃星=LING[年支]+t  天马=MA[年支]
//   红鸾=3-年支index  天喜=红鸾+6  四化=MUT[年干]
//   十二宫名 = PALACES[(命宫 - 本宫) mod 12]
//   命宫 decadal.range[0] === 局数
```

**基线：1930–2019 随机 800 盘、11600+ 项断言、0 处不符（iztro 2.6.0）。**
调用时务必带 `config:{ yearDivide:'normal' }` 并用 `type:'lunar'` 直接喂农历，否则会把时间层的问题混进来。

### 8.2 时间层测试（从 bazi-mcp 照搬）

- 金标 G1–G5（换成紫微断言：年干支 + 命宫支 + 五行局 + 紫微所在宫）
- 常规 20 时区 600 例差分、病态 20 时区 800 例差分（跨日界、45 分钟时区、历史剧变）
- DST 空洞 / 歧义 / `dstFold`
- 闰月、非法闰月、`lunarDateFrame`
- 输入校验：未知参数、年份边界、非法日期、互斥组合、`place` 冲突

### 8.3 紫微专属不变量

- **同一 UTC 瞬时用不同时区表达 → 年干支必须相同**（Z1 的回归防线）
- **同一当地真太阳时 → 农历日、timeIndex、全部宫位星曜必须相同**
- **立春当日逐时辰扫描 → 年干支必须且只能在立春时刻翻一次**（直接针对 Z1）
- 十二宫名逆时针连续、三方四正自洽
- 五行局 ↔ 命宫大限起始年龄一致（水二局起 2、木三局起 3…）
- `timeIndex` 0 与 12 在 `dayDivide:'current'` 下星盘相同、在 `'forward'` 下紫微星必须移位

### 8.4 外部对拍

与 ziwei.pub（iztro 官方 demo）对拍一批常规中国境内盘，确认裁剪层没丢字段、没改语义。

---

## 9. iztro 配置速查

| 配置 | 取值 | 本项目处理 |
|---|---|---|
| `yearDivide` | `normal` 正月初一 / `exact` 立春 | **恒设 normal**，立春自己判（Z1） |
| `horoscopeDivide` | 同上 | **恒设 normal**，同上 |
| `ageDivide` | `normal` 自然年 / `birthday` 生日 | 透传 |
| `dayDivide` | `current` 晚子时算当日 / `forward` 算来日 | 透传，同时用于 `timeIndex` 推导 |
| `algorithm` | `default` 通行版 / `zhongzhou` 中州派 | 透传（zhongzhou 不改四化，已知与文献不符，见 §12 与 `docs/zhongzhou-findings.md`） |
| `astroType` | `heaven`/`earth`/`human` | 透传（两种 `algorithm` 下效果相同，非中州派专用）；`default`+`earth`/`human` 因命主不自洽被拒绝，见 §12 |
| `mutagens` | 逐干覆盖四化 | 透传 |
| `brightness` | 逐星覆盖亮度 | 透传 |
| `fixLeap` | 闰月以十五日为界修正 | 透传（实测：闰四月二十 + fixLeap 会改命宫、五行局、命主；初十不变） |

**已知不可配**：火星铃星起宫、天马、红鸾等年系星的流派变体。`config` 只暴露 `mutagens` 和 `brightness`。若需其他流派，走 `astro.loadPlugins()` 插件机制，或在包装层后处理。这是唯一可能需要手写一小块的地方。

---

## 10. 实现顺序

1. 从 `bazi-mcp` 抽出时间层为共享包（或直接 copy）
2. `timeIndex` 推导 + 早晚子时（0 vs 12）+ `shichen` 歧义标注
3. Z1 解耦：轴 A 判年干支 → `lunarYearForGanZhi` → `byLunar` + `yearDivide:'normal'`
4. 8.1 安星对拍脚本落地成回归测试，先跑绿
5. 输出裁剪 + 诊断块
6. 输入 zod schema（`.strict()`）+ 全部校验分支
7. MCP 封装 + stdio smoke test
8. 8.2 / 8.3 全套测试

**预估一到两天。** 最贵的时间层是复用的。

---

## 11. 附录：与 bazi-mcp 的关系

**建议拆成两个 MCP server，共享一个时间层包。**

- 合并的理由：时间层完全共享、用户常常两个都要。
- 拆开的理由：紫微一张盘的 JSON 比八字大一个量级，合并会挤爆 context；两边的流派参数集完全不同，合并后 schema 会很乱。

无论怎么拆，**紫微 MCP 不要自己算八字**。需要四柱时让上层 LLM 调 `bazi-mcp`，两边的时间层一致，结果自然对齐。

---

## 12. 待确认的未验证面

实现时需要额外小心，因为我没有独立基准：

- **中州派**：行为已穷举（见 `docs/zhongzhou-findings.md`），但与中州派规范只做到网络二手比对，未经原著验证；已知四化与文献不符
- **杂耀**：三台八座、恩光天贵、台辅封诰等，规则简单但数量多，未逐项对拍
- **流耀与运限接口**（`horoscope()`、大限/流年/流月/流日的动态星曜）—— 一项未碰。若要做运限分析，这是最大的未验证面，建议单独立一轮对拍
- **火铃流派**：对拍用的是通行版，iztro 与之一致；其他流派未验证
