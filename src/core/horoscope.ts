import { astro } from 'iztro';
import { calculateBaziChart } from '@openfate/bazi-engine';
import iztroPkg from 'iztro/package.json';
import lunarLitePkg from 'lunar-lite/package.json';
import baziEnginePkg from '@openfate/bazi-engine/package.json';
import trueSolarTimePkg from '@openfate/true-solar-time/package.json';

import {
  ValidatedZiweiHoroscopeInput,
  ZiweiHoroscopeResult,
  ZiweiHoroscopeDiagnostics,
  HoroscopeScopeOutput,
  HoroscopeAgeOutput,
  HoroscopeYearlyOutput,
} from '../types';
import { ZIWEI_YEAR_MAX, yearRangeMessage } from '../schemas/input';
import { buildNatalAstrolabe, resetIztroConfig, fmtDate, fmtDateTime, NatalBuild } from './chart';
import { wallToInstant, instantToWall, toUTCWall, tzOffsetMinutes, getStandardOffsetMinutes } from './time';
import { toTimeIndex, trueSolarTimeIndex } from './time-index';
import { lunar2solar, solar2lunar, ganZhiOfLunarYear, lunarYearForGanZhi } from './lunar';

/**
 * Minimal shape read from iztro's HoroscopeItem (node_modules/iztro/lib/data/types/
 * astro.d.ts) — declared locally instead of importing iztro's own type because the
 * `age` variant adds `nominalAge` and the `yearly` variant adds `yearlyDecStar`, and
 * importing FunctionalHoroscope's own type would pull in the FunctionalStar[][] shape
 * we deliberately trim away (spec §7: "names only, no internal type/scope fields").
 */
interface RawHoroscopeItem {
  index: number;
  name: string;
  heavenlyStem: string;
  earthlyBranch: string;
  palaceNames: string[];
  mutagen: string[];
  stars?: Array<Array<{ name: string }>>;
}

function starsByPalace(stars?: Array<Array<{ name: string }>>): string[][] | undefined {
  return stars ? stars.map(list => list.map(s => s.name)) : undefined;
}

function mapScope(item: RawHoroscopeItem): HoroscopeScopeOutput {
  return {
    name: item.name,
    index: item.index,
    stem: item.heavenlyStem,
    branch: item.earthlyBranch,
    palaceNames: item.palaceNames,
    mutagen: item.mutagen,
    stars: starsByPalace(item.stars),
  };
}

/** Adds one calendar day to a plain Y/M/D (UTC-arithmetic, no timezone involved —
 * this only ever operates on already-resolved local calendar dates). */
function addCalendarDay(w: { year: number; month: number; day: number }): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(w.year, w.month - 1, w.day + 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * Defect 3 fix (project brief item 3): `FunctionalAstrolabe.horoscope()`
 * (node_modules/iztro/lib/astro/FunctionalAstrolabe.js) reads `astro.getConfig()`
 * LAZILY at call time — horoscopeDivide/ageDivide directly, and mutagens/brightness
 * indirectly for 运限 四化/brightness — rather than using whatever config was active
 * when the chart was BUILT. `buildNatalAstrolabe`'s own `finally` block (chart.ts, F1)
 * already resets mutagens/brightness to pristine right after the natal chart is
 * built — correct for the natal path (which never touches iztro again), but wrong
 * for us: any `.horoscope()` call made after that reset would silently see the
 * DEFAULT 四化/brightness table instead of this request's own override. Re-apply this
 * request's exact config immediately before every `.horoscope()` call made inside
 * `fn`, and reset back to pristine once `fn` returns or throws — "so no two configs
 * can coexist" (brief item 3). All of this request's `.horoscope()` calls share one
 * config (decadal/age/yearly source selection never changes horoscopeDivide/
 * ageDivide/etc — only which DATE is fed), so one apply/restore bracket around all of
 * them is equivalent to (and cheaper than) wrapping each call individually, and
 * nothing else can run between them: this function and everything it calls is
 * synchronous, so no other request's astro.withOptions()/config() call can interleave.
 */
function withHoroscopeConfig<T>(config: NatalBuild['commonOptions']['config'], fn: () => T): T {
  astro.config(config);
  try {
    return fn();
  } finally {
    resetIztroConfig();
  }
}

/**
 * calculate_ziwei_horoscope's core: resolves the target instant through the same
 * time layer as the natal path, then wraps iztro's `chart.horoscope()` to fix the
 * five interface defects documented in the project brief (§ "运限"):
 *   1. feedYear poisons 虚岁/大限/小限 — compensate by the ±60 component only.
 *   2. horoscopeDivide:'exact' self-contradicts — lock 'normal', determine 流年
 *      ourselves on Axis A, source it from a decoupled horoscope() call.
 *   3. config is global and read lazily — see withHoroscopeConfig above.
 *   4. ageDivide:'birthday' is upstream-broken — rejected at the schema layer
 *      (src/schemas/horoscope.ts), never reaches here.
 *   5. degenerate targets (pre-birth, timeIndex 12) — rejected/normalized below.
 */
export function calculateZiweiHoroscope(input: ValidatedZiweiHoroscopeInput): ZiweiHoroscopeResult {
  const natal = buildNatalAstrolabe(input);
  const warnings: string[] = [...natal.warnings];

  // ── Target instant resolution (same time layer as the natal path, same birth
  // place). "now" is the only unambiguous default (brief: "Target input"); an
  // explicit target requires solarDate+clockTime together, enforced at the schema
  // layer (HoroscopeTargetSchema) — never round-tripped through a wall clock on the
  // "now" path, so no DST fold/gap can occur there.
  const targetInput = input.target;
  let targetInstant: number;
  if (targetInput) {
    try {
      targetInstant = wallToInstant(
        {
          year: targetInput.solarDate.year,
          month: targetInput.solarDate.month,
          day: targetInput.solarDate.day,
          hour: targetInput.clockTime.hour,
          minute: targetInput.clockTime.minute,
          second: 0,
        },
        natal.loc.timezone,
        targetInput.dstFold
      ).instant;
    } catch (err) {
      // F5: time.ts is copied verbatim from bazi-mcp (spec §3, must stay byte-
      // identical) and its only caller there is a birth date, so its error text says
      // "the birth record" unconditionally. Re-word for the target path here — wrap,
      // don't reimplement the validation. The DST-fold-ambiguous message doesn't
      // mention "birth" at all, so it round-trips unchanged.
      throw new Error((err as Error).message.replace('the birth record', 'the target date/time'));
    }
  } else {
    targetInstant = Date.now();
  }

  // ── Axis B: target local true solar time -> raw timeIndex (0-12), exactly like the
  // natal path (trueSolar toggle honored the same way).
  const targetOffsetMinutes = tzOffsetMinutes(targetInstant, natal.loc.timezone);
  const targetStandardOffsetMinutes = getStandardOffsetMinutes(targetInstant, natal.loc.timezone);
  const targetIsDst = targetOffsetMinutes > targetStandardOffsetMinutes;
  const targetDstOffsetHours = targetIsDst ? (targetOffsetMinutes - targetStandardOffsetMinutes) / 60 : 0;
  const targetLocalWall = instantToWall(targetInstant, natal.loc.timezone);
  const targetStandardWall = toUTCWall(targetInstant + targetStandardOffsetMinutes * 60000);

  // Same defect and same fix as chart.ts's buildNatalAstrolabe (fix 1, see its comment):
  // compute the correction unconditionally so it's available to report/warn on, even
  // though trueSolar only applies it to timeIndex/trueSolarWall below. Unlike the natal
  // path, ZiweiHoroscopeDiagnostics has no longitudeCorrectionMinutes/equationOfTimeMinutes
  // fields to begin with (never did, in either trueSolar mode) — targetSolarIdx.timeIndex/
  // trueSolarWall are the only fields ever read off it elsewhere in this function — so
  // there is no pre-existing "reports 0 instead of the truth" lie to fix for those two
  // fields specifically. What IS structurally identical to fix 1's real defect: a large
  // discarded correction can silently move targetTimeIndex across a 时辰 boundary with no
  // signal at all. Port the warning for that, without inventing new diagnostics fields
  // this type never had.
  const targetFullSolarIdx = trueSolarTimeIndex({
    year: targetLocalWall.year,
    month: targetLocalWall.month,
    day: targetLocalWall.day,
    hour: targetLocalWall.hour,
    minute: targetLocalWall.minute,
    standardOffsetHours: targetStandardOffsetMinutes / 60,
    dstOffsetHours: targetDstOffsetHours,
    longitude: natal.loc.longitude,
  });
  const targetSolarIdx = natal.opts.trueSolar
    ? targetFullSolarIdx
    : {
        timeIndex: toTimeIndex(targetStandardWall.hour, targetStandardWall.minute),
        trueSolarWall: targetStandardWall,
        longitudeCorrectionMinutes: targetFullSolarIdx.longitudeCorrectionMinutes,
        equationOfTimeMinutes: targetFullSolarIdx.equationOfTimeMinutes,
      };
  if (!natal.opts.trueSolar && Math.abs(targetFullSolarIdx.longitudeCorrectionMinutes) > 30) {
    warnings.push(
      `trueSolar is false: a longitude correction of ${targetFullSolarIdx.longitudeCorrectionMinutes.toFixed(1)} minutes was computed but NOT applied to the target instant; targetTimeIndex (时辰) and the target lunar date may differ from a true-solar-time chart.`
    );
  }

  // ── Defect 5a: timeIndex 12 (晚子) advances iztro's internal day ganzhi but not
  // daily.index/lunarDate — dayDivide has no effect on horoscope() at all (brief
  // item 5). The only representation iztro computes CONSISTENTLY is "next calendar
  // day, timeIndex 0" (early-Zi and late-Zi are both 子, so this is also the
  // conventional fold), so normalize to that instead of ever passing 12 through.
  // Axis-A (lichun) determination below deliberately still uses the TRUE (un-
  // normalized) instant — only the calendar date fed to iztro's horoscope() call
  // itself, and everything derived from IT (lunar date, pre-birth check, yearly
  // anchor base year), uses the normalized one.
  // (§8.4 external-comparison follow-up: the natal path's diagnostics.dayDivideNote
  // discloses a DIFFERENT desync — iztro's star-placement code, location.js, shifting
  // the lunar day forward one under dayDivide:'forward' + timeIndex 12. That code path
  // is never reached from horoscope(), which is exactly the "dayDivide has no effect"
  // finding below — so horoscope() needs no dayDivideNote counterpart of its own;
  // lateZiNormalized + the warning already are this path's full disclosure.)
  const lateZiNormalized = targetSolarIdx.timeIndex === 12;
  const targetTimeIndex = lateZiNormalized ? 0 : targetSolarIdx.timeIndex;
  const effTargetSolarDate = lateZiNormalized
    ? addCalendarDay(targetSolarIdx.trueSolarWall)
    : { year: targetSolarIdx.trueSolarWall.year, month: targetSolarIdx.trueSolarWall.month, day: targetSolarIdx.trueSolarWall.day };
  if (lateZiNormalized) {
    warnings.push(
      '目标时刻落在晚子时 (23:00-24:00 本地真太阳时)；已归一化为次日 timeIndex 0 (早子时)。iztro 的 horoscope() 对晚子时目标会在内部推进日干支，但不会同步推进 daily.index/lunarDate（dayDivide 参数对 horoscope() 完全无效——见项目文档 spec §5/§12 item 5），归一化后两者才能保持一致。'
    );
  }

  const targetLunarConv = solar2lunar(fmtDate(effTargetSolarDate));

  // ── Defect 5b: pre-birth targets return index:-1 and untranslated i18n keys,
  // inconsistently, instead of erroring (brief item 5). Reject before ever calling
  // iztro. Same-lunar-year-but-before-birth-date targets are NOT rejected here — the
  // horoscope-parity gate (tests/horoscope-parity.test.ts) verified those against the
  // classical oracle (虚岁 1 covers the whole birth lunar year), so only a strictly
  // earlier lunar year is the garbage boundary.
  if (targetLunarConv.lunarYear < natal.lunarConv.lunarYear) {
    throw new Error(
      `Target date's lunar year (${targetLunarConv.lunarYear}) is before the birth lunar year (${natal.lunarConv.lunarYear}). iztro's horoscope() returns garbage for pre-birth targets (palace index -1, untranslated internal star/branch names) instead of an error — this service rejects them instead. Please provide a target on or after the birth date.`
    );
  }

  // ── Axis A for the target: same method as the natal yearGanZhi (spec §5 Z1), but
  // on the TRUE target instant, governed by horoscopeDivide (not yearDivide) — this
  // is the tool's own independently-determined 流年 boundary (brief item 2), used
  // instead of iztro's self-contradictory horoscopeDivide:'exact'.
  const beijingWallForTargetA = toUTCWall(targetInstant + 8 * 3600000);
  if (beijingWallForTargetA.year > ZIWEI_YEAR_MAX) {
    throw new Error(
      `${yearRangeMessage('The Beijing-time (UTC+8) year of the resolved target instant')} The target instant's own wall-clock year was within that range, but this service always determines 流年 from the Beijing-time (UTC+8) projection of the exact target instant — for a target within roughly a day of a UTC year boundary, in a timezone west of China, that projection can fall in the following year. Beijing year computed: ${beijingWallForTargetA.year}.`
    );
  }
  const Atarget = calculateBaziChart({
    year: beijingWallForTargetA.year,
    month: beijingWallForTargetA.month,
    day: beijingWallForTargetA.day,
    hour: beijingWallForTargetA.hour,
    minute: beijingWallForTargetA.minute,
    gender: input.gender,
    longitude: 120,
    timezone: 8,
    enableTrueSolarTime: false,
    dayBoundaryMode: 'ZI_HOUR_23',
  });
  const yearlyGanZhiLichun = Atarget.pillars.year.stem + Atarget.pillars.year.branch;
  const yearlyGanZhiLunarNewYear = ganZhiOfLunarYear(targetLunarConv.lunarYear);
  const yearlyGanZhi = natal.opts.horoscopeDivide === 'lunar_new_year' ? yearlyGanZhiLunarNewYear : yearlyGanZhiLichun;

  // ── Defect 1: feedYear compensation, ±60 component only (brief item 1). The
  // intentional ±1 lichun-window component of (feedYear - birth lunar year) must
  // NOT be cancelled — that shift is what makes the natal yearGanZhi correct in the
  // first place, and letting 虚岁/大限/小限 move with it is what the lichun school
  // means (a birth already counted into the next ganzhi-year at lichun is also
  // already counted into the next age-year). Only the ±60-multiple component is
  // pure crash-avoidance noise (P2b: iztro has no other way to avoid "only 29 days
  // in lunar year X month Y" for a shifted 腊月三十) with zero calendrical meaning,
  // and it's exactly that component which corrupts 虚岁 if left uncompensated
  // (verified in the brief: feed 1930/2050 vs 1990, ±60 away, produce wildly
  // different 虚岁/大限/小限 for the identical real target). |baseOffset| <= 1 is
  // always far smaller than 30, so rounding to the nearest 60 always isolates
  // exactly the 60-multiple component, never the intentional ±1.
  // `|| 0` normalizes the `-0` that `Math.round(-1/60)*60` produces for a -1
  // baseOffset birth (Object.is(-0,0) is false; serialization hides it but it's
  // a wart) — never changes a real nonzero offset, since -0 is the only falsy
  // output this expression can produce.
  const sixtyOffset = (Math.round((natal.feedYear - natal.lunarConv.lunarYear) / 60) * 60) || 0;

  // ── decadal/age and yearly can each need their OWN source date, decoupled from
  // the true-target date used for monthly/daily/hourly:
  //   - decadal/age (虚岁-driven) depend only on the target LUNAR YEAR (verified in
  //     the parity round's Q1 decoupling probe: 120/120 chart pairs on the same
  //     lunar year, different days, byte-identical {decadal,age,yearly}). When
  //     sixtyOffset != 0, shifting the TRUE target's own month/day by that many
  //     years risks landing on a day that doesn't exist in the shifted year (the
  //     same short-month crash feedYear itself exists to dodge) AND risks a
  //     different day ganzhi / leap-month structure that would corrupt monthly/
  //     daily/hourly if they were sourced from the same shifted call. Source
  //     decadal/age from a SEPARATE, safe anchor day (lunar month 6, day 1 — always
  //     valid, no leap-month edge case) in (target lunar year + sixtyOffset) instead.
  //   - yearly must reflect the horoscopeDivide-correct 流年 ganzhi determined above,
  //     which can differ from iztro's own internal (正月初一-only) division for a
  //     target inside the 立春<->正月初一 window. The parity round's Q1 probe found
  //     the `yearly` block depends only on lunar year (same 120/120 result), so
  //     source it from lunarYearForGanZhi's nearest year matching that ganzhi,
  //     again anchored at month 6 day 1 to sidestep any day-count issue entirely.
  // monthly/daily/hourly always come from the TRUE target date — sixtyOffset is
  // ganzhi-preserving (60 lunar years share a ganzhi) but NOT day-ganzhi-preserving
  // (60 lunar years is not a multiple of 60 solar days) and not leap-month-structure-
  // preserving, so shifting them would silently corrupt 流日's JDN-based stem/branch
  // and 流时's 五鼠遁 off of it, and could move 流月's effective month via the
  // leap-month >15-day rule. Nothing here reimplements that arithmetic — it only
  // chooses which already-correct iztro answer to read from which call.
  const primaryDateStr = fmtDate(effTargetSolarDate);

  // ── Defect 1c: iztro's 虚岁 is `目标农历年(正月初一) − 喂入农历年(feedYear) + 1` — the
  // target side is ALWAYS read on the 正月初一 axis (never lichun-adjusted; a target
  // that itself falls in a 立春↔正月初一 window still counts by 正月初一 there too —
  // pinned by the "defect 2" window test, which requires 虚岁/大限/小限 to be BYTE-
  // IDENTICAL between horoscopeDivide:'lichun' and :'lunar_new_year' for the same
  // target, i.e. age must never move with horoscopeDivide). The birth side is the
  // ganzhi/lichun-adjusted feedYear (defect 1 above, deliberately NOT the true birth
  // year). Mixing a 正月初一-axis target against a lichun-axis birth is correct for
  // every target that has itself already reached the birth's shifted epoch — that's
  // the whole point of the lichun school (verified by the three "defect 1b" tests:
  // a +1-window birth's 虚岁 for a far target is feedYear-based, one LOWER than naive
  // 正月初一 arithmetic would give, and that must never be "fixed" away).
  //
  // But the subtraction is only valid once the target has reached that epoch. For a
  // +1-window birth (feedYear = true birth lunar year + 1), a target whose own true
  // lunar year is STILL the birth's true year — i.e. anywhere from the birth instant
  // through the eve of that year's own 正月初一 — hasn't gotten there yet: zero 正月
  // 初一s have elapsed since birth, so 虚岁 must read 1, but the raw subtraction reads
  // targetTrueYear − (birthTrueYear+1) + 1 = 0 (and iztro's OWN internal handling of a
  // non-positive result is the index:-1/untranslated-key garbage defect 5b exists to
  // block — a target this close to birth reaches that regime with no ±60 involved at
  // all, defect 5b's guard alone can't see it because it correctly admits same-lunar-
  // year targets per spec, see the "accepts a same-lunar-year target before the birth
  // date" test).
  //
  // Floor the birth side at min(feedYear, targetTrueYear) instead of always using the
  // raw feedYear — equivalently: anchor the decadal/age call at natal.feedYear itself
  // (nominalAge = feedYear − feedYear + 1 = 1, exactly) whenever the target hasn't yet
  // reached the birth's own (±60-stripped) epoch. This reduces to the untouched ±60-
  // only formula the instant the target DOES reach it (targetTrueYear >= feedYear -
  // sixtyOffset), so it changes nothing for any already-verified far-target case —
  // it only ever fires in the exact narrow slice described above (provably: the
  // pre-birth guard already ensures targetTrueYear >= birthTrueYear, and feedYear is
  // at most birthTrueYear+1, so this branch can only trigger when baseOffset is
  // exactly +1 and targetTrueYear == birthTrueYear).
  const birthEpochLunarYear = natal.feedYear - sixtyOffset;

  // ── Mirror of the floor above, for the OTHER window direction. A birth AFTER 正月
  // 初一 but BEFORE 立春 (baseOffset -1: feedYear = birthTrueYear - 1, i.e.
  // birthEpochLunarYear < natal.lunarConv.lunarYear) never trips the floor above —
  // targetLunarConv.lunarYear is always >= natal.lunarConv.lunarYear (pre-birth guard)
  // which is already > birthEpochLunarYear here, so the raw subtraction is >= 2 from
  // the instant of birth onward, never <1. But 2 is wrong for a target that hasn't
  // itself turned an age-year by EITHER boundary the lichun school recognizes yet:
  // it's still within the birth's own TRUE 正月初一-to-正月初一 span (zero 正月初一
  // crossings since birth) AND it hasn't reached the 立春 instant that closes out the
  // birth's own (feedYear-designated) ganzhi year. A newborn queried on their own
  // birthday is 虚岁 1, not 2 — same law the floor enforces for the +1-window birth,
  // just arithmetically valid-looking here instead of <1, so nothing catches it
  // without this explicit check.
  //
  // Two clauses, both required:
  //  - targetLunarConv.lunarYear === natal.lunarConv.lunarYear scopes this to the
  //    birth's own true lunar year only. Without it, ganzhi recurrence (every 60
  //    years) would make yearlyGanZhiLichun === natal.yearGanZhi true again ~60 years
  //    later and wrongly re-fire this branch on an adult.
  //  - yearlyGanZhiLichun === natal.yearGanZhi (yearlyGanZhiLichun already computed
  //    above, unconditionally from the true target instant, never horoscopeDivide-
  //    gated — see the `Atarget` block) is the 立春 check: true exactly until the
  //    target's own instant crosses the 立春 that closes the birth's ganzhi year.
  //    natal.yearGanZhi IS that ganzhi whenever this branch can even be reached
  //    (only yearDivide:'lichun' births ever produce a nonzero baseOffset at all —
  //    yearDivide:'lunar_new_year' always yields feedYear === birthTrueYear, so
  //    birthEpochLunarYear === natal.lunarConv.lunarYear and this condition is
  //    unreachable for those births).
  //
  // The instant EITHER clause goes false, the raw feedYear-anchored formula is
  // already correct and needs no further help: it reads exactly 2 the moment 立春 is
  // crossed (still same true lunar year), and exactly 3 at the target's own next 正月
  // 初一 — a clean +1 step each time, never a skip, and unchanged for every far target
  // (defect-1b's pinned "one HIGHER than naive" semantics, e.g. 虚岁 32 for a 2053
  // target, survive untouched since this branch cannot reach that far).
  const inBirthOwnPreLichunSpan =
    birthEpochLunarYear < natal.lunarConv.lunarYear &&
    targetLunarConv.lunarYear === natal.lunarConv.lunarYear &&
    yearlyGanZhiLichun === natal.yearGanZhi;

  // F3: which mechanism(s) actually engaged the anchor, for diagnostics honesty.
  // Recorded once here instead of re-derived from sixtyOffset/decadalAgeSource at the
  // wire layer, since decadalAgeAnchorLunarYear === natal.feedYear is ambiguous on its
  // own (the clamp branch and a sixtyOffset that happens to reduce to feedYear look
  // identical downstream — only this condition tells them apart).
  const firstYearClampApplied = targetLunarConv.lunarYear < birthEpochLunarYear || inBirthOwnPreLichunSpan;

  const decadalAgeAnchorLunarYear = firstYearClampApplied
    ? natal.feedYear
    : sixtyOffset !== 0
      ? targetLunarConv.lunarYear + sixtyOffset
      : undefined;
  const decadalAgeAnchorReason: 'sixtyYearOffset' | 'firstYearClamp' | 'sixtyYearOffsetAndFirstYearClamp' | undefined =
    decadalAgeAnchorLunarYear === undefined
      ? undefined
      : firstYearClampApplied && sixtyOffset !== 0
        ? 'sixtyYearOffsetAndFirstYearClamp'
        : firstYearClampApplied
          ? 'firstYearClamp'
          : 'sixtyYearOffset';
  const feedLunarYearForYearly = lunarYearForGanZhi(yearlyGanZhi, targetLunarConv.lunarYear, 6, 1, false);
  const yearlyAnchorLunarYear = feedLunarYearForYearly !== targetLunarConv.lunarYear ? feedLunarYearForYearly : undefined;

  const anchorDateStr = (lunarYear: number): string => {
    let solar;
    try {
      solar = lunar2solar(`${lunarYear}-6-1`, false);
    } catch (err) {
      throw new Error(
        `Internal error: could not convert anchor date lunar ${lunarYear}-6-1 back to a solar date: ${(err as Error).message}. This is a data problem, not a caller error — please report it.`
      );
    }
    return fmtDate({ year: solar.solarYear, month: solar.solarMonth, day: solar.solarDay });
  };

  let hPrimary!: ReturnType<typeof natal.chart.horoscope>;
  let hDecAge!: ReturnType<typeof natal.chart.horoscope>;
  let hYearly!: ReturnType<typeof natal.chart.horoscope>;

  withHoroscopeConfig(natal.commonOptions.config, () => {
    // NOTE: always pass a bare 'YYYY-MM-DD' string, never a Date object or a
    // date+time string. iztro's own horoscope() internally computes
    // `timeIndex || convertTimeIndex` (FunctionalAstrolabe.js) — since `0` is
    // falsy in JS, an explicit timeIndex of 0 would silently fall back to
    // `convertTimeIndex`, computed from the DATE ARGUMENT's own hour. A bare date
    // string parses to midnight, and convertTimeIndex(hour 0) is ALSO 0, so this
    // only "works" because both branches coincidentally agree at midnight — passing
    // a Date/datetime string with a real hour would silently override our computed
    // timeIndex for every ti=0 target.
    hPrimary = natal.chart.horoscope(primaryDateStr, targetTimeIndex);
    hDecAge = decadalAgeAnchorLunarYear === undefined ? hPrimary : natal.chart.horoscope(anchorDateStr(decadalAgeAnchorLunarYear), 0);
    // NOTE: the yearly anchor date can itself fall in a lunar year BEFORE the birth
    // year (early-window case: the target's true lunar year already precedes birth's
    // lichun-shifted year when 正月初一 falls before 立春 that year) — iztro's own
    // age/decadal computation on THIS call would be pre-birth garbage (defect 5b), but
    // that is harmless here because only `.yearly` is ever read from hYearly, and Q1
    // of the parity round confirmed `yearly` depends solely on the fed lunar year
    // (never on age/nominalAge), so it stays correct even when age itself would not be.
    hYearly = yearlyAnchorLunarYear === undefined ? hPrimary : natal.chart.horoscope(anchorDateStr(yearlyAnchorLunarYear), 0);
  });

  // ── Item 2 caveat: inside the 立春<->正月初一 window, monthly/daily/hourly's
  // internal 斗君/月柱 anchor to the 正月初一-based year (iztro has no lichun option
  // for this internally), which can differ from the horoscopeDivide-correct `yearly`
  // shown above. State which year anchors 流月, always (not just when it matters) —
  // outside the window the two years are identical and this is a no-op statement.
  const monthlyAnchorGanZhi = ganZhiOfLunarYear(targetLunarConv.lunarYear);
  const inLichunWindow = natal.opts.horoscopeDivide === 'lichun' && monthlyAnchorGanZhi !== yearlyGanZhi;
  if (inLichunWindow) {
    warnings.push(
      `目标处于立春↔正月初一窗口内：本服务判定的流年为 ${yearlyGanZhi}（按 horoscopeDivide:'lichun'，即立春分界），但 iztro 的 horoscope() 内部对流月/流日/流时的斗君与月柱干支恒按正月初一分界（horoscopeDivide 在传入 iztro 时被锁定为 'normal'，用于绕开另一处 iztro bug——见项目 spec §5 "Z1" / §12 item 2），故流月锚定的是正月初一分界下的 ${monthlyAnchorGanZhi} 年，而非上方 yearly 所示的 ${yearlyGanZhi} 年。本响应中的 monthly/daily/hourly 反映的是 ${monthlyAnchorGanZhi} 年，而非 ${yearlyGanZhi} 年。`
    );
  }

  const decadal = mapScope(hDecAge.decadal as RawHoroscopeItem);
  const age: HoroscopeAgeOutput = { ...mapScope(hDecAge.age as RawHoroscopeItem), nominalAge: hDecAge.age.nominalAge };
  const yearlyRaw = hYearly.yearly;
  const yearly: HoroscopeYearlyOutput = {
    ...mapScope(yearlyRaw as RawHoroscopeItem),
    yearlyDecStars: {
      suiqian12: yearlyRaw.yearlyDecStar.suiqian12,
      jiangqian12: yearlyRaw.yearlyDecStar.jiangqian12,
    },
  };
  const monthly = mapScope(hPrimary.monthly as RawHoroscopeItem);
  const daily = mapScope(hPrimary.daily as RawHoroscopeItem);
  const hourly = mapScope(hPrimary.hourly as RawHoroscopeItem);

  const diagnostics: ZiweiHoroscopeDiagnostics = {
    targetWallClock: `${fmtDateTime(targetLocalWall)} (${natal.loc.timezone})`,
    targetUtcInstant: new Date(targetInstant).toISOString(),
    axisA_instant_forYearlyGanZhi: `${fmtDateTime(beijingWallForTargetA)} (UTC+8)`,
    axisB_localTrueSolarTime: fmtDateTime(targetSolarIdx.trueSolarWall),
    targetLunar: {
      year: targetLunarConv.lunarYear,
      month: targetLunarConv.lunarMonth,
      day: targetLunarConv.lunarDay,
      isLeapMonth: targetLunarConv.isLeap,
    },
    targetTimeIndex,
    lateZiNormalized,
    yearlyGanZhi,
    horoscopeDivideApplied: natal.opts.horoscopeDivide,
    yearlyGanZhiNote: `流年干支由本服务在目标瞬时上独立判定（与本命 yearGanZhi 同法：Axis A, @openfate/bazi-engine on the Beijing wall clock of the target instant），而非使用 iztro 自身的 horoscopeDivide:'exact'（该模式与虚岁/大限/小限的正月初一分界不一致，构成同一次调用内部自相矛盾——见项目 spec §5 "Z1" 与 §12 item 2）。iztro 的 horoscopeDivide 恒被锁定为 'normal'。`,
    feedYearCompensation: {
      birthFeedYear: natal.feedYear,
      birthLunarYear: natal.lunarConv.lunarYear,
      sixtyYearOffsetApplied: sixtyOffset,
      decadalAgeSource: decadalAgeAnchorLunarYear === undefined ? 'true-target' : 'anchor',
      decadalAgeAnchorLunarYear,
      decadalAgeAnchorReason,
      note:
        `iztro 的虚岁计算方式为「目标农历年 − 喂入本命农历年 + 1」，本命喂入农历年为 ${natal.feedYear}（真实本命农历年为 ${natal.lunarConv.lunarYear}）。两者之差中，±60 的整数倍部分（此处 = ${sixtyOffset}）纯粹是为绕开 iztro 在腊月三十等短月上的崩溃（见 probe-findings P2a/P2b）而引入、无历法含义，若不补偿会直接摧毁虚岁/大限/小限；±1 的立春窗口分量则不补偿——那是使本命流年干支正确的必要偏移，让虚岁随之偏移正是立春流派本身的含义。` +
        (decadalAgeAnchorReason === undefined
          ? ' 本次目标虚岁/大限/小限直接取自目标真实日期的 horoscope() 调用，未启用锚定日期（既无需 ±60 补偿，也未触发首年钳制）。'
          : decadalAgeAnchorReason === 'sixtyYearOffset'
            ? ' 本次锚定仅由上述 ±60 补偿触发（首年钳制未触发）。'
            : decadalAgeAnchorReason === 'firstYearClamp'
              ? ` 本次锚定与 ±60 补偿无关（此处 sixtyYearOffsetApplied = ${sixtyOffset}），而是由「首年钳制」单独触发：目标瞬时尚未跨越出生喂入农历年 ${natal.feedYear} 自身的虚岁纪年起点（目标仍处于出生所在的真实农历年内，且尚未越过闭合该出生喂入年所需的立春/正月初一边界），若照公式原样相减，虚岁会读出 <=0 或错误地读成 2 ——因此强制锚定为出生喂入农历年本身，使虚岁读作 1（新生儿在自己生日当天虚岁为 1，而非 0 或 2，正是此钳制存在的意义）。`
              : ` 本次锚定同时由 ±60 补偿与首年钳制共同触发：先以喂入农历年 ${natal.feedYear} 本身移除 ±60 噪音，随即因目标瞬时仍未跨越该喂入年自身的虚岁纪年起点而继续钳制为虚岁 1（两者共同作用，缺一都不能解释此处的锚定）。`),
    },
    yearlySource: yearlyAnchorLunarYear === undefined ? 'true-target' : 'anchor',
    yearlyAnchorLunarYear,
    monthlyAnchor: {
      ganZhi: monthlyAnchorGanZhi,
      convention: 'lunar_new_year',
      note: '流月/流日/流时的斗君与月柱干支恒锚定于正月初一分界下的农历年（iztro 内部对此无立春选项），可能与上方按 horoscopeDivide 判定的 yearly 流年不同——仅在立春↔正月初一窗口内两者会不同，此时另见 warnings。',
    },
    convention: {
      horoscopeDivide: natal.opts.horoscopeDivide,
      ageDivide: 'normal',
      dayDivide: natal.opts.dayDivide,
      algorithm: natal.opts.algorithm,
      astroType: natal.opts.astroType,
      fixLeap: natal.opts.fixLeap,
      trueSolar: natal.opts.trueSolar,
    },
    locationSource: natal.loc.locationSource,
    warnings,
    engineInfo: {
      iztro: iztroPkg.version,
      lunarLite: lunarLitePkg.version,
      baziEngine: baziEnginePkg.version,
      trueSolarTimeEngine: trueSolarTimePkg.version,
      schemaVersion: '1.0.0',
    },
  };

  return { decadal, age, yearly, monthly, daily, hourly, diagnostics };
}
