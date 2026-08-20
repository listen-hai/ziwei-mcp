import { z } from 'zod';
import starZhCN from 'iztro/lib/i18n/locales/zh-CN/star';

/**
 * Single source of truth for the solar/lunar year range, shared by the schema layer
 * (SolarDateSchema/LunarDateSchema below) AND the engine layer (chart.ts's Axis A
 * Beijing-year guard) — spec §6: "年份范围与引擎对齐，两层校验用同一个范围、同一套文案".
 * Without this, a schema-valid input year (e.g. solarDate 2100-12-31 in a western
 * timezone) can still land outside @openfate/bazi-engine's own 1800-2100 range once
 * projected onto the Beijing wall clock for year-ganzhi determination (Axis A), and
 * the caller would see the engine's raw "year must be an integer between 1800 and
 * 2100" — a range and wording that don't match what they were told at the schema
 * layer. Both layers now read from and quote this same constant/message.
 */
export const ZIWEI_YEAR_MIN = 1900;
export const ZIWEI_YEAR_MAX = 2100;

export function yearRangeMessage(field: string): string {
  return `${field} must be between ${ZIWEI_YEAR_MIN} and ${ZIWEI_YEAR_MAX} (the range this service's calendar tables cover).`;
}

/**
 * Single source of truth for every zod `.default(...)` below. calculateZiweiChart
 * (src/core/chart.ts) re-exports these to build a resolved-options object for callers
 * that construct ValidatedZiweiInput directly without going through ZiweiInputSchema.parse
 * (whose `.default()` calls would otherwise be the only place these values live) — see
 * project spec §7 / defect writeup for why reading input.* directly is unsafe.
 */
export const ZIWEI_DEFAULTS = {
  lunarDateFrame: 'local',
  yearDivide: 'lichun',
  horoscopeDivide: 'lichun',
  ageDivide: 'normal',
  dayDivide: 'current',
  algorithm: 'default',
  astroType: 'heaven',
  fixLeap: false,
  trueSolar: true,
} as const;

export const ShichenEnum = z.enum([
  '子', '丑', '寅', '卯', '辰', '巳',
  '午', '未', '申', '酉', '戌', '亥',
]);

export const SolarDateSchema = z.object({
  year: z.number().int()
    .min(ZIWEI_YEAR_MIN, yearRangeMessage('Solar year'))
    .max(ZIWEI_YEAR_MAX, yearRangeMessage('Solar year'))
    .describe(`Solar (Gregorian) year (${ZIWEI_YEAR_MIN}-${ZIWEI_YEAR_MAX}, the range this service's calendar tables cover)`),
  month: z.number().int().min(1).max(12).describe('Solar (Gregorian) month (1-12)'),
  day: z.number().int().min(1).max(31).describe('Solar (Gregorian) day (1-31)'),
}).strict();

export const LunarDateSchema = z.object({
  year: z.number().int()
    .min(ZIWEI_YEAR_MIN, yearRangeMessage('Lunar year'))
    .max(ZIWEI_YEAR_MAX, yearRangeMessage('Lunar year'))
    .describe(`Lunar year (${ZIWEI_YEAR_MIN}-${ZIWEI_YEAR_MAX}, the range this service's calendar tables cover)`),
  month: z.number().int().min(1).max(12).describe('Lunar month (1-12)'),
  day: z.number().int().min(1).max(30).describe('Lunar day (1-30)'),
  isLeapMonth: z.boolean().optional().describe('Whether this is a leap month (e.g. pass true for a leap 4th month)'),
}).strict();

export const ClockTimeSchema = z.object({
  hour: z.number().int().min(0).max(23).describe('Clock hour (0-23)'),
  minute: z.number().int().min(0).max(59).describe('Clock minute (0-59)'),
}).strict();

// Heavenly stems and brightness grades are small, stable, closed sets (unchanged for
// centuries) — worth enumerating directly.
const HeavenlyStemEnum = z.enum(['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']);
const BrightnessValueEnum = z.enum(['庙', '旺', '得', '利', '平', '不', '陷', '']);

// F3 fix: star names WERE only shape-checked (non-empty, <=10 chars), not enumerated —
// the original reasoning was that hand-copying iztro's ~160 star names here would drift
// against the pinned iztro version. That premise was wrong: the pinned package ships its
// own canonical zh-CN star table at runtime (node_modules/iztro/lib/i18n/locales/zh-CN/
// star.js, 162 entries), so reading it at import time is drift-proof by construction —
// it can never desync from the iztro version actually loaded. Enumerating against it also
// closes F1's blast radius: iztro's astro.config() merges mutagens/brightness into
// module-level globals that persist across requests (see chart.ts's withIztroConfigReset),
// so a typo'd/garbage star name here previously wasn't just ignored for one request — kot()
// (node_modules/iztro/lib/i18n/index.js) fails to resolve it, the raw garbage string gets
// merged into the global table, and it silently degrades every LATER chart's 四化/brightness
// too, forever, until restart. Same philosophy as assertLeapMonthExists (src/core/lunar.ts):
// never silently accept something the caller didn't actually ask for.
//
// Using z.enum(...) here (rather than a .refine() membership check) is also what caps F2's
// otherwise-unbounded `brightness` key count for free: a zod record keyed by a closed enum
// can never hold more than the enum's own cardinality (162) of distinct keys, well inside
// "the low hundreds" the review called generous — no separate max-keys check needed.
// `mutagens` doesn't need this treatment for key *count* (already capped at 10 by
// HeavenlyStemEnum) but its four star-name values get the same membership check.
const STAR_NAMES = Object.values(starZhCN) as [string, ...string[]];

// Zod's default invalid_enum_value message inlines all 162 star names, once per
// failing entry (measured: ~1.2KB per bad value, so a 4-entry mutagens override
// balloons to ~4.7KB). That error goes straight to an LLM caller for self-correction —
// dumping the full list four times over risks truncation for a one-word typo. A cheap
// nearest-match (Levenshtein over 162 short strings) gives a targeted "did you mean"
// instead, which is more actionable than the list anyway (the realistic failure is a
// typo like 紫薇 for 紫微, or a zh-TW variant).
function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
}

// A 50k-key garbage payload (F2's stress test) runs every key through here, so this
// must stay cheap even when nothing is close: skip the O(n*m) Levenshtein DP entirely
// for names whose length alone already rules out beating the current best (distance
// is always >= the length difference) — real star names are 1-4 chars, so a garbage
// key like "fakeStar12345" is pruned by a single integer comparison per name.
const MAX_SUGGESTION_DISTANCE = 2;
function closestStarName(received: string): string | undefined {
  let best: string | undefined;
  let bestDist = MAX_SUGGESTION_DISTANCE + 1;
  for (const name of STAR_NAMES) {
    if (Math.abs(received.length - name.length) >= bestDist) continue;
    const d = levenshtein(received, name);
    if (d < bestDist) {
      bestDist = d;
      best = name;
    }
  }
  return bestDist > 0 && bestDist <= MAX_SUGGESTION_DISTANCE ? best : undefined;
}

const StarNameEnum = z.enum(STAR_NAMES, {
  errorMap: (issue, ctx) => {
    if (issue.code === z.ZodIssueCode.invalid_enum_value) {
      // Cap the echoed value too — a caller who typos a star name is one thing, but
      // nothing stops a bogus payload from putting a huge garbage string here instead
      // of a typo. Real star names are <=4 chars, so 20 is generous headroom while
      // still keeping the message itself out of the "enormous" territory this fix
      // exists to close.
      const raw = String(ctx.data);
      const received = raw.length > 20 ? `${raw.slice(0, 20)}…` : raw;
      const suggestion = closestStarName(received);
      return {
        message: `"${received}" is not a recognized star name (zh-CN)`
          + (suggestion ? ` — did you mean "${suggestion}"?` : '.'),
      };
    }
    return { message: ctx.defaultError };
  },
});

export const MutagensSchema = z.record(
  HeavenlyStemEnum,
  z.array(StarNameEnum).length(4, 'mutagens override for a stem must list exactly 4 real iztro star names (zh-CN), in [禄,权,科,忌] order.')
).optional();

export const BrightnessSchema = z.record(
  StarNameEnum,
  z.array(BrightnessValueEnum).length(12, 'brightness override for a star must list exactly 12 entries, one per palace.')
).optional();

// Sane upper bounds on caller-supplied free text: the longest real city+state name
// and the longest real IANA zone ID are both well under 100 chars, so these leave
// generous headroom while still stopping a multi-MB `place` from reaching the
// 7,329-city linear scan in geo/resolver.ts (measured: ~4.3s CPU / request on a 5MB
// string, single-threaded stdio server — a trivial denial-of-service otherwise).
const PLACE_MAX = 200;
const TIMEZONE_MAX = 100;

/**
 * The base object shape shared by the natal tool (calculate_ziwei) and the horoscope
 * tool (calculate_ziwei_horoscope) — spec's "same birth-input contract" requirement
 * for the horoscope tool. Kept as its own exported ZodObject (rather than only living
 * inline inside ZiweiInputSchema below) specifically so the horoscope schema
 * (src/schemas/horoscope.ts) can `.extend()` it with a `target` field instead of
 * hand-copying all of these properties — a zod ZodEffects (the result of chaining
 * `.refine()`) has no `.extend()`, so the refinements below are applied via
 * `withBirthInputRefinements` (also exported) rather than baked into this object,
 * letting both schemas share the exact same object shape AND the exact same
 * cross-field validation messages with zero duplication.
 */
export const ZiweiInputObjectSchema = z.object({
  // Birth location (identical contract to bazi-mcp)
  place: z.string().max(PLACE_MAX, `place must be ${PLACE_MAX} characters or fewer.`).optional().describe('Birth city name in English, e.g. "Beijing", "New York", "Tacoma, WA"'),
  longitude: z.number().min(-180).max(180).optional().describe('Birth location longitude (positive = East, negative = West), e.g. 116.4074 or -122.4443'),
  timezone: z.string().max(TIMEZONE_MAX, `timezone must be ${TIMEZONE_MAX} characters or fewer.`).optional().describe('IANA timezone name, e.g. "Asia/Shanghai", "America/Los_Angeles"'),

  // Date (choose one)
  solarDate: SolarDateSchema.optional().describe('Solar (Gregorian) birth date'),
  lunarDate: LunarDateSchema.optional().describe('Lunar (Chinese calendar) birth date'),
  lunarDateFrame: z.enum(['local', 'beijing']).optional().default(ZIWEI_DEFAULTS.lunarDateFrame).describe('Lunar date timezone reference: local (default, matches the local solar date at the birth place) or beijing (matches the Beijing solar date)'),

  // Time (choose one) — note timeUnknown is intentionally NOT a field here, see below.
  clockTime: ClockTimeSchema.optional().describe('Clock time of birth (precise time preferred)'),
  shichen: ShichenEnum.optional().describe('Traditional Chinese double-hour (子/丑/寅/卯/辰/巳/午/未/申/酉/戌/亥)'),

  dstFold: z.union([z.literal(0), z.literal(1)]).optional().describe('DST fall-back disambiguation: 0 = first occurrence (DST), 1 = second occurrence (standard time)'),
  gender: z.enum(['male', 'female']).describe('Gender: male or female'),

  // Zi Wei Dou Shu school/convention switches
  yearDivide: z.enum(['lichun', 'lunar_new_year']).optional().default(ZIWEI_DEFAULTS.yearDivide).describe('Year-ganzhi boundary: lichun (default, 立春 — determined on the true UTC instant, matching bazi-mcp) or lunar_new_year (正月初一)'),
  horoscopeDivide: z.enum(['lichun', 'lunar_new_year']).optional().default(ZIWEI_DEFAULTS.horoscopeDivide).describe('Same boundary convention as yearDivide, but for horoscope (运限) year rollover — the calculate_ziwei_horoscope tool determines the 流年 boundary using this convention (see that tool\'s own docs).'),
  ageDivide: z.enum(['normal', 'birthday']).optional().default(ZIWEI_DEFAULTS.ageDivide).describe('Small-limit (小限) boundary: normal (natural year) or birthday. Note: calculate_ziwei_horoscope rejects "birthday" outright (it is the only tool where 小限 is actually surfaced, and iztro\'s "birthday" mode is documented as 以生日为界 but actually flips on the 1st of the lunar month AFTER the birth month, ignoring the birth day entirely — see that tool\'s own docs). This natal tool still accepts it since 小限 has no effect on any natal-chart output field.'),
  dayDivide: z.enum(['current', 'forward']).optional().default(ZIWEI_DEFAULTS.dayDivide).describe('Late-Zi-hour (晚子时, 23:00-24:00) convention: current (default, counts as the same day) or forward (counts as the next day)'),
  algorithm: z.enum(['default', 'zhongzhou']).optional().default(ZIWEI_DEFAULTS.algorithm).describe('Star-placement algorithm: default (通行版) or zhongzhou (中州派). Verified exhaustively (docs/zhongzhou-findings.md): zhongzhou does NOT change 四化 — e.g. 庚 stays 禄:太阳 权:武曲 科:太阴 忌:天同 and 壬 stays 禄:天梁 权:紫微 科:左辅 忌:武曲, not the documented 中州派 阳武府同 / 梁紫府武 (天府化科; 中州派 also holds 左辅/右弼 take no 四化 at all, which iztro\'s 壬科:左辅 contradicts). zhongzhou only changes 杂曜 (drops 截路/空亡, adds 截空/劫杀/大耗/龙德, swaps 天伤/天使 for 阴年男/阳年女) and how 命主 is derived (年支 instead of 命宫支). If you need 中州派 四化, supply your own table via `config.mutagens`.'),
  astroType: z.enum(['heaven', 'earth', 'human']).optional().default(ZIWEI_DEFAULTS.astroType).describe('Zhongzhou-school chart type (天盘/地盘/人盘). Effective under either `algorithm` value — verified identical whether `algorithm` is \'default\' or \'zhongzhou\'; NOT limited to zhongzhou despite the name. \'earth\'/\'human\' re-seat 命宫 (to 身宫 / 福德宫) and, with it, 五行局, the twelve palace names, the 14 major stars, 长生十二神, and the decadal (大限) sequence. `earthlyBranchOfBodyPalace`, 天寿, and 命主/身主 keep their 天盘 values — they are NOT re-seated. Under algorithm:\'default\' this would leave 命主 contradicting the returned 命宫, so calculate_ziwei rejects astroType:\'earth\'/\'human\' combined with algorithm:\'default\' (see the error message for the fix); calculate_ziwei_horoscope still accepts it since 命主/身主 never appear in its output.'),
  fixLeap: z.boolean().optional().default(ZIWEI_DEFAULTS.fixLeap).describe('Whether to fix leap-month boundaries at the 15th day (闰月十五日为界修正)'),
  trueSolar: z.boolean().optional().default(ZIWEI_DEFAULTS.trueSolar).describe('Whether to apply True Solar Time correction (default true)'),

  // spec §9 / §12: mutagens and brightness are both listed as 透传 (passthrough) —
  // plumbing only, no per-school presets. iztro's own config accepts these keyed by
  // Chinese star/stem names (matching the hardcoded language:'zh-CN'); star names are
  // enumerated against iztro's own shipped zh-CN star table (StarNameEnum above) rather
  // than shape-only checks — see that comment for why this is drift-proof, not drift-prone.
  mutagens: MutagensSchema.describe('School/convention override for 四化 (Four Transformations): maps a heavenly stem (甲-癸) to its own [禄,权,科,忌] star names (exactly 4, in that order), overriding iztro\'s built-in table for that stem only. Optional passthrough to iztro\'s config.mutagens; omit for the default table.'),
  brightness: BrightnessSchema.describe('School/convention override for star brightness (庙旺得利平不陷): maps a star name to its own 12-entry brightness array (one per palace, iztro\'s internal 寅卯辰...丑 order), overriding iztro\'s built-in table for that star only. Optional passthrough to iztro\'s config.brightness; omit for the default table.'),
}).strict();

/**
 * The cross-field validation shared by ZiweiInputSchema and ZiweiHoroscopeInputSchema.
 * A plain function (not baked into ZiweiInputObjectSchema) because zod's `.refine()`
 * return type (ZodEffects) has no `.extend()` — see ZiweiInputObjectSchema's comment.
 */
// Loosely-typed field access (`as BirthInputFields`) inside the predicates below is
// deliberate: constraining T's generic bound to a structural interface here (instead
// of the unconstrained z.ZodTypeAny) previously made TypeScript infer T AS that
// narrow constraint instead of the caller's actual (much wider) schema type — every
// property outside the five checked here silently vanished from the inferred output
// type. z.ZodTypeAny keeps T exactly what the caller passed in; the cast only affects
// the five fields these particular checks read.
interface BirthInputFields {
  solarDate?: unknown; lunarDate?: unknown; clockTime?: unknown; shichen?: unknown;
  place?: unknown; longitude?: unknown; timezone?: unknown;
}
export function withBirthInputRefinements<T extends z.ZodTypeAny>(schema: T) {
  return schema.refine(
    data => (data as BirthInputFields).solarDate || (data as BirthInputFields).lunarDate,
    { message: 'Must provide either solarDate or lunarDate.' }
  ).refine(
    data => !((data as BirthInputFields).solarDate && (data as BirthInputFields).lunarDate),
    { message: 'Cannot provide both solarDate and lunarDate; please provide only one.' }
  ).refine(
    data => (data as BirthInputFields).clockTime || (data as BirthInputFields).shichen,
    { message: 'Must provide one of clockTime or shichen. Note: this tool does not support an "unknown birth time" mode — the soul palace, body palace, and several star placements (Wenchang/Wenqu, Huoxing/Lingxing, Dikong/Dijie) all depend on the birth hour, so there is no meaningful partial Zi Wei Dou Shu chart. If the exact time is unknown, provide your best estimate as `shichen` and check the returned `shichenAmbiguity` diagnostics.' }
  ).refine(
    data => !((data as BirthInputFields).clockTime && (data as BirthInputFields).shichen),
    { message: 'Cannot provide both clockTime and shichen; please provide only one.' }
  ).refine(
    data => (data as BirthInputFields).place || ((data as BirthInputFields).longitude !== undefined && (data as BirthInputFields).timezone),
    { message: 'Must provide place, or both longitude and timezone.' }
  );
}

/**
 * docs/zhongzhou-findings.md 结论 D3: astroType:'earth'/'human' re-seats 命宫 (to
 * 身宫 / 福德宫) without recomputing 命主 (soul), which under algorithm:'default' is
 * derived from the life-palace branch — so the returned 命主 contradicts the very
 * 命宫 it's returned alongside. Reachable under this project's own defaults, since
 * `algorithm` defaults to 'default'. zhongzhou+earth/human is unaffected (命主 there
 * derives from the year branch, which the re-seat doesn't move) and stays accepted.
 *
 * Scoped to the natal tool only (chained here, not inside withBirthInputRefinements),
 * mirroring how ageDivide:'birthday' is rejected only on ZiweiHoroscopeInputSchema
 * (src/schemas/horoscope.ts) because 小限 only surfaces there: 命主/身主 only ever
 * appear in calculate_ziwei's own output (src/core/output.ts), never in
 * calculate_ziwei_horoscope's (src/types.ts's ZiweiHoroscopeResult has no
 * soul/body field), so the contradiction is dormant on the horoscope tool and would
 * be an over-rejection there.
 */
export const ZiweiInputSchema = withBirthInputRefinements(ZiweiInputObjectSchema).refine(
  data => !(data.algorithm === 'default' && data.astroType !== 'heaven'),
  {
    message: 'algorithm:\'default\' combined with astroType:\'earth\' or \'human\' is rejected: astroType re-seats 命宫 (life palace) to 身宫 (earth) or 福德宫 (human), but 命主 (soul) is not recomputed for the new palace — under algorithm:\'default\', 命主 is derived from the life-palace branch, so the returned 命主 would contradict the 命宫 it\'s returned alongside (verified — see docs/zhongzhou-findings.md 结论 D3). Use algorithm:\'zhongzhou\' with this astroType instead (its 命主 derives from the year branch, unaffected by the re-seat), or leave astroType at \'heaven\' (the default).',
    path: ['astroType'],
  }
);

export const LookupLocationSchema = z.object({
  query: z.string().min(1, 'Search query cannot be empty').max(PLACE_MAX, `query must be ${PLACE_MAX} characters or fewer.`).describe('City name in English, e.g. "Tokyo", "London", "San Francisco"'),
});

/**
 * Thin wrapper around ZiweiInputSchema.parse that gives a specific, actionable
 * explanation when the caller passes `timeUnknown` (a valid bazi-mcp field that
 * does not exist here — see spec §6). `.strict()` alone would only report
 * "Unrecognized key(s) in object: 'timeUnknown'", which doesn't explain why.
 */
export function parseZiweiInput(raw: unknown): z.output<typeof ZiweiInputSchema> {
  if (raw !== null && typeof raw === 'object' && 'timeUnknown' in raw) {
    throw new Error(
      'timeUnknown is not supported for Zi Wei Dou Shu charts: the soul palace, body palace, Wenchang/Wenqu, Huoxing/Lingxing, and Dikong/Dijie placements all depend on the birth hour, so there is no meaningful partial chart to return. Please provide `clockTime` or `shichen` instead — if the exact time is genuinely unknown, provide your best estimate as `shichen` and check the returned `shichenAmbiguity` diagnostics.'
    );
  }
  return ZiweiInputSchema.parse(raw);
}

export type ShichenBranch = z.infer<typeof ShichenEnum>;
export type SolarDateInput = z.input<typeof SolarDateSchema>;
export type LunarDateInput = z.input<typeof LunarDateSchema>;
export type ClockTimeInput = z.input<typeof ClockTimeSchema>;
export type ZiweiInput = z.input<typeof ZiweiInputSchema>;
export type ValidatedZiweiInput = z.output<typeof ZiweiInputSchema>;
export type LookupLocationInput = z.input<typeof LookupLocationSchema>;
