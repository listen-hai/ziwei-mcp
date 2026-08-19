import { z } from 'zod';
import { ZiweiInputObjectSchema, withBirthInputRefinements, SolarDateSchema, ClockTimeSchema } from './input';

/**
 * Target instant for a 运限 (horoscope) query, resolved through the SAME time layer
 * as the natal path (spec: "target instant -> Axis B local true solar date +
 * timeIndex"). Both fields are required together (rather than, say, defaulting a
 * missing clockTime to noon) because a partial target is genuinely ambiguous for
 * 流时 (hourly) — the project brief is explicit that "now" is the only default
 * allowed without full precision; anything else must be spelled out completely.
 * dstFold mirrors the birth-time field for the same reason: an explicit target
 * clock time can land in a DST fall-back overlap at the birth place exactly like a
 * birth time can.
 */
export const HoroscopeTargetSchema = z.object({
  solarDate: SolarDateSchema.describe('Solar (Gregorian) target date'),
  clockTime: ClockTimeSchema.describe('Clock time of the target instant'),
  dstFold: z.union([z.literal(0), z.literal(1)]).optional().describe('DST fall-back disambiguation for the target instant: 0 = first occurrence (DST), 1 = second occurrence (standard time)'),
}).strict();

/**
 * calculate_ziwei_horoscope's input: the exact same birth-input contract as
 * calculate_ziwei (ZiweiInputObjectSchema, reused via `.extend()` rather than
 * copied — see that schema's own comment) plus an optional `target`.
 *
 * Defect 4 (project brief item 4): ageDivide:'birthday' is rejected here — and ONLY
 * here, not on the natal tool — via its own `.refine()` below. iztro documents
 * 'birthday' as "以生日为界" (boundary = the birth day) but it actually flips on the
 * 1st of the lunar month AFTER the birth month and ignores the birth day entirely
 * (verified: 五月初一/五月二十/五月廿九 all flip on the same date — docs/probe-findings.md
 * Q3). 小限 (age) only ever surfaces in THIS tool's output; the natal tool accepts
 * 'birthday' without rejecting it only because 小限 has no effect on any natal-chart
 * field, so the defect is dormant there. Silently returning a "birthday-boundary"
 * 小限 that isn't actually boundary-by-birthday would be exactly the kind of silent
 * contradiction this codebase refuses elsewhere (see StarNameEnum/assertLeapMonthExists).
 */
export const ZiweiHoroscopeInputSchema = withBirthInputRefinements(
  ZiweiInputObjectSchema.extend({
    target: HoroscopeTargetSchema.optional().describe(
      'The instant to compute 运限 (horoscope) for. Omit entirely to default to the current instant ("now") — the only case where a default is used, since it is unambiguous. If provided, both solarDate and clockTime are required (no partial target): 流时 (hourly) needs an exact hour, and a date-only target would silently pick an arbitrary time.'
    ),
  }).strict()
).refine(
  data => data.ageDivide !== 'birthday',
  {
    message: 'ageDivide:\'birthday\' is rejected for calculate_ziwei_horoscope: iztro documents it as 以生日为界 (boundary = the exact birth day) but it actually flips 小限 on the 1st of the lunar month AFTER the birth month, ignoring the birth day entirely (verified against iztro 2.6.0 — see project docs). Since 小限 only appears in this tool\'s output, exposing this option here would silently return a "birthday-boundary" 小限 that is not actually bounded by the birthday. Use ageDivide:\'normal\' (the default).',
    path: ['ageDivide'],
  }
);

export type HoroscopeTargetInput = z.input<typeof HoroscopeTargetSchema>;
export type ZiweiHoroscopeInput = z.input<typeof ZiweiHoroscopeInputSchema>;
export type ValidatedZiweiHoroscopeInput = z.output<typeof ZiweiHoroscopeInputSchema>;

/**
 * Thin wrapper mirroring parseZiweiInput (src/schemas/input.ts): gives the same
 * specific `timeUnknown` explanation before falling through to zod's own validation
 * (which now also covers `ageDivide:'birthday'` and target-shape errors).
 */
export function parseZiweiHoroscopeInput(raw: unknown): ValidatedZiweiHoroscopeInput {
  if (raw !== null && typeof raw === 'object' && 'timeUnknown' in raw) {
    throw new Error(
      'timeUnknown is not supported for Zi Wei Dou Shu charts: the soul palace, body palace, Wenchang/Wenqu, Huoxing/Lingxing, and Dikong/Dijie placements all depend on the birth hour, so there is no meaningful partial chart to compute a horoscope against. Please provide `clockTime` or `shichen` instead — if the exact time is genuinely unknown, provide your best estimate as `shichen` and check the returned `shichenAmbiguity` diagnostics.'
    );
  }
  return ZiweiHoroscopeInputSchema.parse(raw);
}
