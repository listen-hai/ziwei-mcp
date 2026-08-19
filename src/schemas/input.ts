import { z } from 'zod';

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
  year: z.number().int().min(1900).max(2100).describe('Solar (Gregorian) year (1900-2100, the range lunar-lite\'s calendar tables actually cover)'),
  month: z.number().int().min(1).max(12).describe('Solar (Gregorian) month (1-12)'),
  day: z.number().int().min(1).max(31).describe('Solar (Gregorian) day (1-31)'),
}).strict();

export const LunarDateSchema = z.object({
  year: z.number().int().min(1900).max(2100).describe('Lunar year (1900-2100, the range lunar-lite\'s calendar tables actually cover)'),
  month: z.number().int().min(1).max(12).describe('Lunar month (1-12)'),
  day: z.number().int().min(1).max(30).describe('Lunar day (1-30)'),
  isLeapMonth: z.boolean().optional().describe('Whether this is a leap month (e.g. pass true for a leap 4th month)'),
}).strict();

export const ClockTimeSchema = z.object({
  hour: z.number().int().min(0).max(23).describe('Clock hour (0-23)'),
  minute: z.number().int().min(0).max(59).describe('Clock minute (0-59)'),
}).strict();

export const ZiweiInputSchema = z.object({
  // Birth location (identical contract to bazi-mcp)
  place: z.string().optional().describe('Birth city name in English, e.g. "Beijing", "New York", "Tacoma, WA"'),
  longitude: z.number().min(-180).max(180).optional().describe('Birth location longitude (positive = East, negative = West), e.g. 116.4074 or -122.4443'),
  timezone: z.string().optional().describe('IANA timezone name, e.g. "Asia/Shanghai", "America/Los_Angeles"'),

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
  horoscopeDivide: z.enum(['lichun', 'lunar_new_year']).optional().default(ZIWEI_DEFAULTS.horoscopeDivide).describe('Same boundary convention as yearDivide, but for horoscope (运限) year rollover. Currently has no effect on any output field: this version does not expose a horoscope()/运限 tool (see project spec §12), so nothing consumes it yet. Accepted now for forward compatibility.'),
  ageDivide: z.enum(['normal', 'birthday']).optional().default(ZIWEI_DEFAULTS.ageDivide).describe('Small-limit (小限) boundary: normal (natural year) or birthday'),
  dayDivide: z.enum(['current', 'forward']).optional().default(ZIWEI_DEFAULTS.dayDivide).describe('Late-Zi-hour (晚子时, 23:00-24:00) convention: current (default, counts as the same day) or forward (counts as the next day)'),
  algorithm: z.enum(['default', 'zhongzhou']).optional().default(ZIWEI_DEFAULTS.algorithm).describe('Star-placement algorithm: default (通行版) or zhongzhou (中州派, unverified against an independent source — see project spec §12)'),
  astroType: z.enum(['heaven', 'earth', 'human']).optional().default(ZIWEI_DEFAULTS.astroType).describe('Zhongzhou-school chart type (天盘/地盘/人盘); only meaningful with algorithm: "zhongzhou"'),
  fixLeap: z.boolean().optional().default(ZIWEI_DEFAULTS.fixLeap).describe('Whether to fix leap-month boundaries at the 15th day (闰月十五日为界修正)'),
  trueSolar: z.boolean().optional().default(ZIWEI_DEFAULTS.trueSolar).describe('Whether to apply True Solar Time correction (default true)'),
}).strict().refine(
  data => data.solarDate || data.lunarDate,
  { message: 'Must provide either solarDate or lunarDate.' }
).refine(
  data => !(data.solarDate && data.lunarDate),
  { message: 'Cannot provide both solarDate and lunarDate; please provide only one.' }
).refine(
  data => data.clockTime || data.shichen,
  { message: 'Must provide one of clockTime or shichen. Note: this tool does not support an "unknown birth time" mode — the soul palace, body palace, and several star placements (Wenchang/Wenqu, Huoxing/Lingxing, Dikong/Dijie) all depend on the birth hour, so there is no meaningful partial Zi Wei Dou Shu chart. If the exact time is unknown, provide your best estimate as `shichen` and check the returned `shichenAmbiguity` diagnostics.' }
).refine(
  data => !(data.clockTime && data.shichen),
  { message: 'Cannot provide both clockTime and shichen; please provide only one.' }
).refine(
  data => data.place || (data.longitude !== undefined && data.timezone),
  { message: 'Must provide place, or both longitude and timezone.' }
);

export const LookupLocationSchema = z.object({
  query: z.string().min(1, 'Search query cannot be empty').describe('City name in English, e.g. "Tokyo", "London", "San Francisco"'),
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
