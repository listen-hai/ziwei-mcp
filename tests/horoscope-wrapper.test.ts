import { describe, it, expect } from 'bun:test';
import { calculateZiweiHoroscope } from '../src/core/horoscope';
import { calculateZiweiChart } from '../src/core/chart';
import { parseZiweiHoroscopeInput } from '../src/schemas/horoscope';
import { parseZiweiInput } from '../src/schemas/input';
import { daysInLunarMonth, makeRandom } from './ziwei-rules';
// The 运限 oracle: the same frozen, independently-derived classical implementation
// tests/horoscope-parity.test.ts gates on (303,582 assertions / 0 mismatches vs
// iztro 2.6.0 — see tests/horoscope-parity-reference.mjs's own header). Imported,
// never transplanted or re-derived: its whole value is that it shares no code path
// with src/ or with iztro's horoscope().
import { expectHoroscope } from './horoscope-parity-reference.mjs';

/**
 * tests/horoscope.test.ts (written by the implementer) covers the same five defects;
 * this file is the independent audit of the WRAPPER, built around the three ways a
 * 运限 suite goes green while testing nothing:
 *
 *   1. The ±60 feed-year compensation is unreachable by accident. It engages only for
 *      births in a handful of 立春↔正月初一 windows (enumerated in SIXTY_SHIFT_BIRTHS
 *      below, whose header states exactly how complete that enumeration is) and never
 *      for an ordinary one, so a suite of "normal" births passes with the compensation
 *      deleted. Every listed birth is swept against the oracle here.
 *   2. Config-leak tests are structurally blind unless they CROSS charts: iztro's
 *      config is a module global that horoscope() reads lazily at call time, so a
 *      single-chart test cannot observe a leak. Every config test here interleaves
 *      a second, differently-configured request between two requests for the same
 *      chart, and asserts in both directions.
 *   3. Per-scope sourcing must be pinned in both directions. 流月/流日/流时 come from
 *      the TRUE target; 大限/小限/流年 come from a shifted anchor. A test that only
 *      checks year-scoped values passes even if 流日 were sourced from the shifted
 *      year — silently wrong, since 流日 is JDN-based and not 60-year periodic.
 *
 * Fixed frame for most tests: `Etc/GMT-8` + longitude 120 + trueSolar:false. That is
 * a permanent UTC+8 zone with no DST in any year (unlike Asia/Shanghai, which had DST
 * 1986-1991 and in the 1940s), so "clock hour == true solar hour == Beijing hour"
 * holds for every year in 1900-2100 and the oracle can be fed the caller's own
 * date/hour directly. The true-solar / timezone / DST layer gets its own section
 * below, where it is the subject rather than a confound.
 */

// This whole file audits the yearDivide/horoscopeDivide:'lichun' machinery (the ±60/±1
// feed-year compensation and the 立春↔正月初一 window) — 0.2.0's default is
// 'lunar_new_year' (see README's Conventions table / docs/spec.md §6), so FRAME pins
// both explicitly to keep every test in this file exercising what it was written to
// exercise. Individual calls that need to compare against the OTHER convention already
// override with an explicit `horoscopeDivide: 'lunar_new_year'` per-call.
const FRAME = { timezone: 'Etc/GMT-8', longitude: 120, trueSolar: false, yearDivide: 'lichun', horoscopeDivide: 'lichun' } as const;
const H = (o: Record<string, unknown>) => calculateZiweiHoroscope(parseZiweiHoroscopeInput(o));
const N = (o: Record<string, unknown>) => calculateZiweiChart(parseZiweiInput(o));
/** Same request minus the horoscope-only `target` — the natal schema is `.strict()`. */
const noTarget = ({ target: _t, ...rest }: Record<string, unknown>) => rest;

// ── Oracle plumbing ─────────────────────────────────────────────────────────────
const STEMS = '甲乙丙丁戊己庚辛壬癸'.split('');
const BRANCHES = '子丑寅卯辰巳午未申酉戌亥'.split('');
/** Sexagenary pair of a NUMBERED lunar year, anchored 1984 = 甲子. Two lines, written
 * here rather than imported from src/core/lunar so the oracle input stays independent
 * of the code under test. */
const gz = (y: number) => STEMS[((y - 1984) % 10 + 10) % 10] + BRANCHES[((y - 1984) % 12 + 12) % 12];
/** Etc/GMT-8 + trueSolar:false: the clock hour IS the timeIndex input. */
const tiOf = (hour: number) => ((hour + 1) >> 1) % 12;

/**
 * The lunar year the oracle must be fed for a given birth — derived WITHOUT reading
 * `feedYear` or `sixtyYearOffsetApplied`, so this cannot rubber-stamp a wrong
 * compensation. iztro's 虚岁 is `目标农历年 − 喂入农历年 + 1`; the only meaningful part
 * of the feed shift is the ±1 立春-window component (the ±60 part is pure crash
 * avoidance), and that component is exactly "which numbered lunar year carries the
 * birth's own year ganzhi". So: the year within ±1 of the true birth lunar year whose
 * ganzhi equals the natal chart's independently-determined yearGanZhi.
 */
function oracleNatalYear(natal: ReturnType<typeof calculateZiweiChart>): number {
  const y = natal.lunar.year;
  const found = [y, y + 1, y - 1].find(c => gz(c) === natal.diagnostics.yearGanZhi);
  if (found === undefined) throw new Error(`no year within ±1 of ${y} has ganzhi ${natal.diagnostics.yearGanZhi}`);
  return found;
}

/** Our `string[][]` (by palace) -> the oracle's `Record<starName, palaceIndex>`. */
const starsAsMap = (stars?: string[][]): Record<string, number> => {
  const out: Record<string, number> = {};
  (stars ?? []).forEach((names, i) => names.forEach(n => { out[n] = i; }));
  return out;
};

const SCOPES = ['decadal', 'age', 'yearly', 'monthly', 'daily', 'hourly'] as const;
const SCOPE_NAMES = new Set(['大限', '童限', '小限', '流年', '流月', '流日', '流时']);

/** Stable serialization: key order must not count as a mismatch. */
const ser = (v: unknown): string =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? JSON.stringify(Object.keys(v as object).sort().map(k => [k, (v as Record<string, unknown>)[k]]))
    : JSON.stringify(v);

/** Collects mismatches instead of throwing on the first, so a sweep reports breadth. */
function differ() {
  const fails: string[] = [];
  let checks = 0;
  return {
    eq(got: unknown, want: unknown, msg: string) {
      checks++;
      if (ser(got) !== ser(want)) fails.push(`${msg}: got ${ser(got)}, want ${ser(want)}`);
    },
    ok(cond: boolean, msg: string) {
      checks++;
      if (!cond) fails.push(msg);
    },
    done(minChecks: number) {
      if (fails.length) throw new Error(`${fails.length}/${checks} mismatches:\n  ${fails.slice(0, 20).join('\n  ')}`);
      expect(checks).toBeGreaterThanOrEqual(minChecks);
    },
  };
}

/**
 * Every scope of one response vs the oracle, plus the garbage invariants that catch a
 * regression into iztro's untranslated-i18n-key / index:-1 regime anywhere at all
 * (`stem:'jia'`, `branch:'zi'`, `index:-1`) rather than only at fixtures we thought
 * to pin.
 */
function compareAllScopes(
  d: ReturnType<typeof differ>,
  got: ReturnType<typeof calculateZiweiHoroscope>,
  want: ReturnType<typeof expectHoroscope>,
  tag: string
): void {
  for (const s of SCOPES) {
    const g = got[s];
    const w = want[s];
    d.eq(g.index, w.index, `${tag} ${s}.index`);
    d.eq(g.stem, w.stem, `${tag} ${s}.stem`);
    d.eq(g.branch, w.branch, `${tag} ${s}.branch`);
    d.eq(g.palaceNames, w.palaceNames, `${tag} ${s}.palaceNames`);
    d.eq(g.mutagen, w.mutagen, `${tag} ${s}.mutagen`);
    d.ok(STEMS.includes(g.stem), `${tag} ${s}.stem not a 天干: ${g.stem}`);
    d.ok(BRANCHES.includes(g.branch), `${tag} ${s}.branch not a 地支: ${g.branch}`);
    d.ok(g.index >= 0 && g.index <= 11, `${tag} ${s}.index out of range: ${g.index}`);
    d.ok(SCOPE_NAMES.has(g.name), `${tag} ${s}.name not a known label: ${g.name}`);
    if (s === 'age') {
      d.eq(got.age.nominalAge, w.nominalAge, `${tag} age.nominalAge`);
      d.ok(got.age.nominalAge >= 1, `${tag} age.nominalAge below 1: ${got.age.nominalAge}`);
      continue;
    }
    d.eq(starsAsMap(g.stars), w.stars, `${tag} ${s}.stars`);
  }
  d.eq(got.yearly.yearlyDecStars.suiqian12, want.yearly.suiqian12, `${tag} suiqian12`);
  d.eq(got.yearly.yearlyDecStars.jiangqian12, want.yearly.jiangqian12, `${tag} jiangqian12`);
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Births in 1900-2100 for which the ±60 feed-year fallback fires — `[year, month, day,
 * birthHour?]`, hour defaulting to 10. Enumerated by scanning every 腊月/正月 day that
 * can land in the 立春↔正月初一 window and keeping those whose shifted feed year has too
 * few days — the crash `lunarYearForGanZhi` dodges by jumping a full 60-year cycle.
 * Both directions are present: -60 (the fallback searched backwards) and +60 (forwards).
 * Nothing outside this window exercises the compensation at all, which is exactly why a
 * suite built from "normal" births cannot see it.
 *
 * SCOPE OF THE CLAIM — read before adding to it: this is complete at DAY granularity
 * for a birth hour of 10, which is how it was enumerated. Membership is not purely a
 * property of the date: a birth ON 立春 day itself is inside the window only from the
 * 立春 instant onward, so the same date can shift at an evening hour and not at a
 * morning one. The last two entries are exactly that case (1962-02-04 shifts from h16,
 * 2057-02-03 from h17; neither shifts at h10), found by an hour-granularity re-scan.
 * A full day×hour enumeration over 1900-2100 has NOT been run, so more hour-dependent
 * members may exist — do not restore a "COMPLETE" claim without running one.
 */
const SIXTY_SHIFT_BIRTHS: Array<[number, number, number] | [number, number, number, number]> = [
  [1901, 2, 18], [1904, 2, 15], [1907, 2, 12], [1910, 2, 9], [1915, 2, 13], [1926, 2, 12],
  [1940, 2, 7], [1950, 2, 16], [1953, 2, 13], [1959, 2, 7], [1969, 2, 16], [1977, 2, 17],
  [1986, 2, 8], [1996, 2, 18], [1999, 2, 15], [2002, 2, 11], [2005, 2, 8], [2015, 2, 18],
  [2021, 2, 11], [2024, 2, 9], [2048, 2, 13], [2064, 2, 16], [2067, 2, 13], [2073, 2, 6],
  [2076, 2, 4], [2083, 2, 16], [2086, 2, 13], [2095, 2, 4], [2100, 2, 8],
  [1962, 2, 4, 18], [2057, 2, 3, 18],
];

// ════════════════════════════════════════════════════════════════════════════════
// Defect 1 — the ±60 feed-year compensation
// ════════════════════════════════════════════════════════════════════════════════
describe('运限 audit: defect 1 — ±60 feed-year compensation (the births that can reach it)', () => {
  it('every 1900-2100 birth that triggers the ±60 fallback matches the oracle on all six scopes', () => {
    // This is the load-bearing ±60 test. Deleting the compensation (forcing
    // sixtyOffset = 0) shifts 虚岁 by exactly ±60 for every birth in the list and
    // drags 大限/小限 with it — verified by mutation, see the report.
    const d = differ();
    for (const [by, bm, bd, bh = 10] of SIXTY_SHIFT_BIRTHS) {
      for (const gender of ['male', 'female'] as const) {
        const birth = { ...FRAME, solarDate: { year: by, month: bm, day: bd }, clockTime: { hour: bh, minute: 0 }, gender };
        const natal = N(birth);
        const L = oracleNatalYear(natal);
        d.ok(natal.lunar.isLeapMonth === false, `${by}-${bm}-${bd} h${bh} unexpectedly a leap month`);
        // The whole point of the compensation: L is the TRUE (±1-shifted) lunar year,
        // never the ±60-shifted feed year iztro was actually handed. This also pins the
        // list itself: an entry that stopped shifting (or an hour typo'd out of the
        // window) fails here rather than silently degrading into an ordinary birth.
        d.ok(natal.diagnostics.feedYear !== L, `${by}-${bm}-${bd} h${bh} expected a ±60 feed shift, got feedYear ${natal.diagnostics.feedYear} == L`);

        for (const [ty, tm, td, th] of [[L + 1, 6, 15, 13], [L + 30, 11, 3, 5], [L + 61, 3, 21, 0], [L + 7, 8, 30, 20]] as const) {
          if (ty > 2100) continue;
          const targetStr = `${ty}-${pad(tm)}-${pad(td)}`;
          const got = H({ ...birth, horoscopeDivide: 'lunar_new_year', target: { solarDate: { year: ty, month: tm, day: td }, clockTime: { hour: th, minute: 0 } } });
          const want = expectHoroscope({ lunarYear: L, lunarMonth: natal.lunar.month, lunarDay: natal.lunar.day, timeIndex: natal.lunar.timeIndex, gender }, targetStr, tiOf(th));
          compareAllScopes(d, got, want, `[${by}-${bm}-${bd} ${gender} → ${targetStr} ${th}:00]`);
        }
      }
    }
    d.done(2000);
  });

  it('sources 流月/流日/流时 from the TRUE target even when 大限/小限/流年 come from the ±60 anchor', () => {
    // The silent-corruption case the split exists to prevent: 60 lunar years share a
    // year ganzhi but NOT a day ganzhi (60 lunar years is not a multiple of 60 solar
    // days), so a 流日 sourced from the shifted anchor would be wrong in a way no
    // year-scoped assertion can see. Pinned against the oracle's own JDN-based day
    // ganzhi for the TRUE target date.
    const birth = { ...FRAME, solarDate: { year: 2024, month: 2, day: 9 }, clockTime: { hour: 10, minute: 0 }, gender: 'male' as const };
    const natal = N(birth);
    const L = oracleNatalYear(natal);
    expect(L).toBe(2024);
    expect(natal.diagnostics.feedYear).toBe(1964);

    const d = differ();
    for (let day = 14; day <= 18; day++) {
      const targetStr = `2054-06-${pad(day)}`;
      const got = H({ ...birth, horoscopeDivide: 'lunar_new_year', target: { solarDate: { year: 2054, month: 6, day }, clockTime: { hour: 13, minute: 0 } } });
      const want = expectHoroscope({ lunarYear: L, lunarMonth: natal.lunar.month, lunarDay: natal.lunar.day, timeIndex: natal.lunar.timeIndex, gender: 'male' }, targetStr, tiOf(13));
      compareAllScopes(d, got, want, `[±60 birth → ${targetStr}]`);
      // …and the wrapper says out loud that the two came from different calls.
      d.eq(got.diagnostics.feedYearCompensation.decadalAgeSource, 'anchor', `${targetStr} decadalAgeSource`);
      d.eq(got.diagnostics.feedYearCompensation.decadalAgeAnchorLunarYear, 2054 - 60, `${targetStr} anchor year`);
    }
    d.done(100);

    // Directional check, stated as an invariant rather than a fixture: across those
    // five consecutive days the year-scoped blocks are byte-identical while 流日
    // advances one palace and one day-ganzhi per day.
    const day = (n: number) => H({ ...birth, horoscopeDivide: 'lunar_new_year', target: { solarDate: { year: 2054, month: 6, day: n }, clockTime: { hour: 13, minute: 0 } } });
    const a = day(14);
    const b = day(15);
    expect(b.decadal).toEqual(a.decadal);
    expect(b.age).toEqual(a.age);
    expect(b.yearly).toEqual(a.yearly);
    expect(b.daily.index).toBe((a.daily.index + 1) % 12);
    expect(b.daily.stem + b.daily.branch).not.toBe(a.daily.stem + a.daily.branch);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Defect 1b — the ±1 立春 component is deliberately NOT compensated
// ════════════════════════════════════════════════════════════════════════════════
describe('运限 audit: the ±1 立春-window feed shift is NOT compensated (and must never be "fixed" into uniformity)', () => {
  // A future reader seeing "compensate the feed-year shift" will be tempted to
  // compensate ALL of it. These two pin the asymmetry: the ±60 component is pure
  // crash-avoidance noise and IS cancelled; the ±1 component is what makes the natal
  // year ganzhi correct under yearDivide:'lichun', and letting 虚岁 move with it is
  // precisely what the 立春 school means.
  it('a birth AFTER 立春 but BEFORE 正月初一 is already counted into the next age-year (虚岁 one LOWER than the naive lunar-year arithmetic)', () => {
    // 2024: 立春 = Feb 4 ~16:27, 正月初一 = Feb 10. Birth Feb 5 => true lunar year 2023
    // (腊月廿六), but year ganzhi 甲辰 => feedYear 2024, offset +1, no ±60 involved.
    const birth = { ...FRAME, solarDate: { year: 2024, month: 2, day: 5 }, clockTime: { hour: 10, minute: 0 }, gender: 'male' as const };
    const natal = N(birth);
    expect(natal.lunar.year).toBe(2023);
    expect(natal.diagnostics.yearGanZhi).toBe('甲辰');
    expect(natal.diagnostics.feedYear).toBe(2024);

    const res = H({ ...birth, target: { solarDate: { year: 2054, month: 6, day: 15 }, clockTime: { hour: 13, minute: 0 } } });
    expect(res.diagnostics.feedYearCompensation.sixtyYearOffsetApplied === 0).toBe(true);
    expect(res.diagnostics.targetLunar.year).toBe(2054);
    // 虚岁 = 2054 - 2024 + 1 = 31, NOT 2054 - 2023 + 1 = 32.
    expect(res.age.nominalAge).toBe(31);
    expect(res.age.nominalAge).not.toBe(32);
    expect(res.age.nominalAge).toBe(res.diagnostics.targetLunar.year - natal.diagnostics.feedYear + 1);
  });

  it('a birth AFTER 正月初一 but BEFORE 立春 is still counted in the previous age-year (虚岁 one HIGHER)', () => {
    // 2023: 正月初一 = Jan 22, 立春 = Feb 4. Birth Jan 25 => true lunar year 2023
    // (正月初四), but year ganzhi is still 壬寅 => feedYear 2022, offset -1.
    const birth = { ...FRAME, solarDate: { year: 2023, month: 1, day: 25 }, clockTime: { hour: 10, minute: 0 }, gender: 'male' as const };
    const natal = N(birth);
    expect(natal.lunar.year).toBe(2023);
    expect(natal.diagnostics.yearGanZhi).toBe('壬寅');
    expect(natal.diagnostics.feedYear).toBe(2022);

    const res = H({ ...birth, target: { solarDate: { year: 2053, month: 6, day: 15 }, clockTime: { hour: 13, minute: 0 } } });
    expect(res.diagnostics.feedYearCompensation.sixtyYearOffsetApplied === 0).toBe(true);
    expect(res.age.nominalAge).toBe(2053 - 2022 + 1);
    expect(res.age.nominalAge).not.toBe(2053 - 2023 + 1);
  });

  it('the two components are independent: a ±60 birth in the window still keeps its ±1', () => {
    // 2024-02-09 carries BOTH (+1 window shift, then -60 crash dodge). Compensating
    // only the -60 must leave the +1 standing, i.e. 虚岁 is based on 2024, not 2023.
    const res = H({
      ...FRAME, solarDate: { year: 2024, month: 2, day: 9 }, clockTime: { hour: 10, minute: 0 }, gender: 'male',
      target: { solarDate: { year: 2054, month: 6, day: 15 }, clockTime: { hour: 13, minute: 0 } },
    });
    expect(res.diagnostics.feedYearCompensation.birthFeedYear).toBe(1964);
    expect(res.diagnostics.feedYearCompensation.birthLunarYear).toBe(2023);
    expect(res.diagnostics.feedYearCompensation.sixtyYearOffsetApplied).toBe(-60);
    expect(res.age.nominalAge).toBe(31); // 2054 - 2024 + 1, not 32 (2023-based) and not 91 (1964-based)
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Defect 1c — the -1-window birth's OWN first age-year (mirror of the floor above)
// ════════════════════════════════════════════════════════════════════════════════
describe('运限 audit: defect 1c — a -1-window birth is 虚岁 1 on its own birthday, not 2', () => {
  // 2023: 正月初一 = Jan 22, 立春 = Feb 4. Birth Jan 25 is the SAME birth as the
  // "one HIGHER" test above (feedYear 2022, true lunar year 2023, offset -1). That
  // test only pins a FAR target (2053 -> 32); nothing in it constrains a target still
  // inside the birth's own first true lunar year. The floor added for the +1-window
  // birth doesn't fire here — targetLunarConv.lunarYear is never below feedYear for
  // this birth (2023 >= 2022 from the instant of birth onward), it's the mirror
  // ceiling in src/core/horoscope.ts (`inBirthOwnPreLichunSpan`) that must fire
  // instead. Walking hour-by-hour across the whole first year, exactly like the +1
  // window's own "walks the whole window" test below pins its transition.
  const birth = { ...FRAME, solarDate: { year: 2023, month: 1, day: 25 }, clockTime: { hour: 10, minute: 0 }, gender: 'male' as const };
  const at = (y: number, m: number, d: number, h: number, horoscopeDivide?: 'lichun' | 'lunar_new_year') =>
    H({ ...birth, ...(horoscopeDivide ? { horoscopeDivide } : {}), target: { solarDate: { year: y, month: m, day: d }, clockTime: { hour: h, minute: 0 } } });

  it('confirms the fixture: feedYear 2022, true lunar year 2023, offset -1, no ±60 involved', () => {
    const natal = N(birth);
    expect(natal.lunar.year).toBe(2023);
    expect(natal.diagnostics.yearGanZhi).toBe('壬寅');
    expect(natal.diagnostics.feedYear).toBe(2022);
  });

  it('is 虚岁 1, in 童限 (not 大限), on its own birthday', () => {
    const res = at(2023, 1, 25, 10);
    expect(res.age.nominalAge).toBe(1);
    expect(res.decadal.name).toBe('童限');
    expect(res.age.index).toBeGreaterThanOrEqual(0);
  });

  it('is still 虚岁 1 for a same-lunar-year target BEFORE the birth date (mirrors defect 5\'s "whole birth lunar year" rule)', () => {
    // 正月初一 2023 was Jan 22 -- Jan 23 is same true lunar year as the Jan 25 birth,
    // but earlier in the calendar, and still pre-立春.
    expect(at(2023, 1, 23, 12).age.nominalAge).toBe(1);
  });

  it('stays 虚岁 1 through the day BEFORE 立春, and turns to 2 at the true 立春 INSTANT -- not the calendar day', () => {
    // yearlyGanZhi (Axis A, computed independently of any hard-coded lichun table)
    // flips 壬寅 -> 癸卯 between 10:00 and 11:00 on 2023-02-04 for this exact chart.
    expect(at(2023, 2, 3, 12).diagnostics.yearlyGanZhi).toBe('壬寅');
    expect(at(2023, 2, 3, 12).age.nominalAge).toBe(1);
    expect(at(2023, 2, 4, 10).diagnostics.yearlyGanZhi).toBe('壬寅');
    expect(at(2023, 2, 4, 10).age.nominalAge).toBe(1);
    expect(at(2023, 2, 4, 11).diagnostics.yearlyGanZhi).toBe('癸卯');
    expect(at(2023, 2, 4, 11).age.nominalAge).toBe(2);
  });

  it('stays 虚岁 2 for the rest of the true lunar year 2023, including the eve of 正月初一 2024', () => {
    expect(at(2023, 6, 1, 12).age.nominalAge).toBe(2);
    const eve = at(2024, 2, 9, 12);
    expect(eve.diagnostics.targetLunar.year).toBe(2023); // 正月初一 2024 is Feb 10
    expect(eve.age.nominalAge).toBe(2);
  });

  it('turns to 虚岁 3 exactly at 正月初一 2024 -- a clean +1 step, never a skip', () => {
    const res = at(2024, 2, 10, 12);
    expect(res.diagnostics.targetLunar.year).toBe(2024);
    expect(res.age.nominalAge).toBe(3);
  });

  it('a far target still reads 虚岁 32 (defect 1b\'s pinned "one HIGHER than naive" semantics survive untouched)', () => {
    expect(at(2053, 6, 15, 13).age.nominalAge).toBe(2053 - 2022 + 1);
  });

  it('age/decadal for an in-window target of THIS birth stay byte-identical across horoscopeDivide (no test-331-style violation introduced)', () => {
    const lichun = at(2023, 2, 4, 10, 'lichun');
    const newYear = at(2023, 2, 4, 10, 'lunar_new_year');
    expect(lichun.age).toEqual(newYear.age);
    expect(lichun.decadal).toEqual(newYear.decadal);
    expect(lichun.age.nominalAge).toBe(1);
  });

  // No SIXTY_SHIFT_BIRTHS entry (the known 1900-2100 births needing the ±60 crash-
  // avoidance compensation) is a -1-window birth -- every one is +1 (verified by
  // computing feedYear - true lunar year for each and stripping the ±60 component,
  // including the two hour-dependent entries). There is no combined ±60 x -1-window
  // case known in range to cover here.
});

// ════════════════════════════════════════════════════════════════════════════════
// Defect 2 — horoscopeDivide locked to 'normal' + the 立春↔正月初一 window
// ════════════════════════════════════════════════════════════════════════════════
describe('运限 audit: defect 2 — the 立春↔正月初一 window, and which year anchors 流月', () => {
  const birth = { ...FRAME, solarDate: { year: 1990, month: 6, day: 15 }, clockTime: { hour: 10, minute: 0 }, gender: 'male' as const };
  const at = (m: number, day: number, hour: number, horoscopeDivide?: 'lichun' | 'lunar_new_year') =>
    H({ ...birth, ...(horoscopeDivide ? { horoscopeDivide } : {}), target: { solarDate: { year: 2024, month: m, day }, clockTime: { hour, minute: 0 } } });

  it('walks the whole 2024 window: before 立春, across the 立春 instant, inside the window, and on 正月初一', () => {
    // 2024 立春 falls on Feb 4 between 10:00 and 17:00 (Beijing 16:27); 正月初一 is Feb 10.
    // The 流年 boundary is the true 立春 INSTANT, not the 立春 calendar day — so the two
    // Feb-4 samples must straddle it.
    expect(at(2, 3, 12).diagnostics.yearlyGanZhi).toBe('癸卯');
    expect(at(2, 4, 10).diagnostics.yearlyGanZhi).toBe('癸卯');
    expect(at(2, 4, 17).diagnostics.yearlyGanZhi).toBe('甲辰');
    expect(at(2, 5, 12).diagnostics.yearlyGanZhi).toBe('甲辰');
    expect(at(2, 9, 12).diagnostics.yearlyGanZhi).toBe('甲辰');
    expect(at(2, 10, 12).diagnostics.yearlyGanZhi).toBe('甲辰');

    // 流月 is anchored by the 正月初一 year throughout — it only agrees with 流年 once
    // 正月初一 has itself passed.
    for (const [m, day, hour] of [[2, 3, 12], [2, 4, 10], [2, 4, 17], [2, 5, 12], [2, 9, 12]] as const) {
      expect(at(m, day, hour).diagnostics.monthlyAnchor.ganZhi).toBe('癸卯');
      expect(at(m, day, hour).diagnostics.monthlyAnchor.convention).toBe('lunar_new_year');
    }
    expect(at(2, 10, 12).diagnostics.monthlyAnchor.ganZhi).toBe('甲辰');
  });

  it('warns inside the window, naming both years and stating that monthly/daily/hourly follow the 正月初一 one — and stays silent outside it', () => {
    const inside = at(2, 5, 12);
    expect(inside.diagnostics.yearlySource).toBe('anchor');
    expect(inside.diagnostics.yearlyAnchorLunarYear).toBe(2024);
    const warn = inside.diagnostics.warnings.filter(w => w.includes('立春') && w.includes('正月初一'));
    expect(warn).toHaveLength(1);
    expect(warn[0]).toContain('甲辰');
    expect(warn[0]).toContain('癸卯');

    for (const outside of [at(2, 3, 12), at(2, 10, 12), at(6, 15, 12)]) {
      expect(outside.diagnostics.yearlySource).toBe('true-target');
      expect(outside.diagnostics.warnings.some(w => w.includes('立春') && w.includes('正月初一'))).toBe(false);
    }
  });

  it('inside the window 流年 moves but 流月/流日/流时 and 虚岁/大限/小限 do not — pinned against the oracle for BOTH years', () => {
    // The decoupling, asserted from both ends rather than from diagnostics strings:
    // the lichun answer's `yearly` must equal the oracle's 甲辰-year yearly, while its
    // monthly/daily/hourly and its age/decadal must equal the oracle's 癸卯-year ones
    // for this exact target date.
    const natal = N(birth);
    const L = oracleNatalYear(natal);
    const oracleNatal = { lunarYear: L, lunarMonth: natal.lunar.month, lunarDay: natal.lunar.day, timeIndex: natal.lunar.timeIndex, gender: 'male' as const };
    const lichun = at(2, 5, 12, 'lichun');
    const newYear = at(2, 5, 12, 'lunar_new_year');

    // 正月初一 view: everything matches the oracle on the true target date.
    const d = differ();
    compareAllScopes(d, newYear, expectHoroscope(oracleNatal, '2024-02-05', tiOf(12)), '[window lunar_new_year]');
    d.done(40);

    // 立春 view: only `yearly` differs, and it equals the oracle's yearly for a date in
    // the NEXT lunar year (2024) — sourced from an anchor, not relabelled.
    const wantNextYear = expectHoroscope(oracleNatal, '2024-06-15', tiOf(12));
    expect(lichun.yearly.index).toBe(wantNextYear.yearly.index);
    expect(lichun.yearly.stem).toBe(wantNextYear.yearly.stem);
    expect(lichun.yearly.branch).toBe(wantNextYear.yearly.branch);
    expect(lichun.yearly.mutagen).toEqual(wantNextYear.yearly.mutagen);
    expect(lichun.yearly.palaceNames).toEqual(wantNextYear.yearly.palaceNames);
    expect(starsAsMap(lichun.yearly.stars)).toEqual(wantNextYear.yearly.stars as Record<string, number>);
    expect(lichun.yearly.yearlyDecStars.suiqian12).toEqual(wantNextYear.yearly.suiqian12!);
    expect(lichun.yearly.yearlyDecStars.jiangqian12).toEqual(wantNextYear.yearly.jiangqian12!);

    // …and NOTHING else moved with it: 流月/流日/流时 (true target) and 虚岁/大限/小限
    // (正月初一 division) are byte-identical to the lunar_new_year view.
    expect(lichun.monthly).toEqual(newYear.monthly);
    expect(lichun.daily).toEqual(newYear.daily);
    expect(lichun.hourly).toEqual(newYear.hourly);
    expect(lichun.decadal).toEqual(newYear.decadal);
    expect(lichun.age).toEqual(newYear.age);
    expect(lichun.age.nominalAge).toBe(34);
    expect(lichun.yearly).not.toEqual(newYear.yearly);
  });

  it('never reports iztro\'s own horoscopeDivide — the caller\'s convention is echoed, the engine is always driven at \'normal\'', () => {
    // If the lock were removed and the caller's 'lichun' were handed to iztro as
    // 'exact', iztro would divide 流年 at 立春 internally, `yearlySource` would fall
    // back to 'true-target' (no anchor needed), and the window warning would vanish.
    const inside = at(2, 5, 12, 'lichun');
    expect(inside.diagnostics.horoscopeDivideApplied).toBe('lichun');
    expect(inside.diagnostics.convention.horoscopeDivide).toBe('lichun');
    expect(inside.diagnostics.yearlySource).toBe('anchor');
    expect(inside.diagnostics.monthlyAnchor.convention).toBe('lunar_new_year');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Defect 3 — iztro's config is global and horoscope() reads it lazily
// ════════════════════════════════════════════════════════════════════════════════
describe('运限 audit: defect 3 — config isolation ACROSS requests (a single-chart test cannot see this)', () => {
  const A = { ...FRAME, solarDate: { year: 1990, month: 6, day: 15 }, clockTime: { hour: 10, minute: 0 }, gender: 'male' as const, target: { solarDate: { year: 2025, month: 6, day: 15 }, clockTime: { hour: 13, minute: 0 } } };
  const B = { ...FRAME, solarDate: { year: 1975, month: 11, day: 3 }, clockTime: { hour: 4, minute: 0 }, gender: 'female' as const, target: { solarDate: { year: 2011, month: 3, day: 9 }, clockTime: { hour: 21, minute: 0 } } };
  const STEM_LIST = STEMS;
  const allStems = (four: string[]) => Object.fromEntries(STEM_LIST.map(s => [s, four]));
  const SENTINEL_1 = ['文昌', '文曲', '天魁', '天钺'];
  const SENTINEL_2 = ['左辅', '右弼', '天马', '禄存'];
  const everyScopeMutagen = (r: ReturnType<typeof calculateZiweiHoroscope>) => SCOPES.map(s => r[s].mutagen);

  it('applies THIS request\'s 四化 override to every scope of horoscope() — the natal build wipes the table before horoscope() ever runs', () => {
    // Overriding all ten stems makes the assertion independent of which stem this
    // fixture's scopes happen to land on: with the override in force, every scope's
    // 四化 must be the sentinel; without it, none can be.
    const plain = H(A);
    const overridden = H({ ...A, mutagens: allStems(SENTINEL_1) });
    for (const m of everyScopeMutagen(overridden)) expect(m).toEqual(SENTINEL_1);
    for (const m of everyScopeMutagen(plain)) expect(m).not.toEqual(SENTINEL_1);
  });

  it('a differently-configured request in between does not change an earlier chart\'s answer (override -> other -> same override)', () => {
    const first = H({ ...A, mutagens: allStems(SENTINEL_1) });
    H({ ...B, mutagens: allStems(SENTINEL_2) });               // different chart, different config
    H(B);                                                       // …and a plain one
    N(noTarget({ ...B, mutagens: allStems(SENTINEL_2) }));      // …and the natal tool, also overridden
    const again = H({ ...A, mutagens: allStems(SENTINEL_1) });
    expect(again).toEqual(first);
    for (const m of everyScopeMutagen(again)) expect(m).toEqual(SENTINEL_1);
  });

  it('a plain request is unaffected by any override that ran before it, from either tool (default -> override -> default)', () => {
    const baseline = H(A);
    H({ ...A, mutagens: allStems(SENTINEL_1) });
    expect(H(A)).toEqual(baseline);

    H({ ...B, mutagens: allStems(SENTINEL_2), brightness: { 紫微: Array(12).fill('庙') } });
    expect(H(A)).toEqual(baseline);

    N(noTarget({ ...A, mutagens: allStems(SENTINEL_2) }));
    expect(H(A)).toEqual(baseline);
  });

  it('the scalar config keys leak the same way: algorithm/astroType must not survive a request', () => {
    // horoscope() reads `algorithm` out of the same lazily-read global. resetIztroConfig
    // is the only thing putting it back; without that, one 中州派 request would silently
    // re-answer every later default request in the process.
    const baseline = H(A);
    const zhongzhou = H({ ...A, algorithm: 'zhongzhou', astroType: 'earth' });
    expect(zhongzhou).not.toEqual(baseline);
    expect(H(A)).toEqual(baseline);
    expect(H({ ...A, algorithm: 'zhongzhou', astroType: 'earth' })).toEqual(zhongzhou);
    expect(H(A)).toEqual(baseline);
  });

  it('overrides are per-request even for the SAME chart asked twice with different tables', () => {
    const one = H({ ...A, mutagens: allStems(SENTINEL_1) });
    const two = H({ ...A, mutagens: allStems(SENTINEL_2) });
    for (const m of everyScopeMutagen(one)) expect(m).toEqual(SENTINEL_1);
    for (const m of everyScopeMutagen(two)) expect(m).toEqual(SENTINEL_2);
    // Everything that is not 四化 is identical between the two.
    for (const s of SCOPES) {
      expect(one[s].index).toBe(two[s].index);
      expect(one[s].stem).toBe(two[s].stem);
      expect(one[s].branch).toBe(two[s].branch);
    }
  });

  /** Every 四化-marked natal star as `名字+化`, sorted — the natal-side observable that
   * the horoscope tool's own outputs cannot show. */
  const natalMarks = (c: ReturnType<typeof calculateZiweiChart>) =>
    c.palaces.flatMap(p => [...p.majorStars, ...p.minorStars])
      .filter(s => s.mutagen)
      .map(s => `${s.name}${s.mutagen}`)
      .sort();

  /**
   * CROSS-TOOL, H(override) -> N(plain). This is the direction the rest of this
   * describe cannot see, and the one that actually rests on `withHoroscopeConfig`'s
   * `finally { resetIztroConfig() }` (src/core/horoscope.ts) — nothing else.
   *
   * Why every other config test above stays green with that `finally` deleted: they
   * observe the leak through a LATER horoscope request, and every horoscope request
   * first runs `buildNatalAstrolabe`, whose own `finally` (src/core/chart.ts) wipes the
   * table before `.horoscope()` is ever reached. So the horoscope path self-heals and
   * masks the missing reset entirely.
   *
   * The natal path does not, because natal 四化 markers are stamped onto the stars at
   * BUILD time — inside `astro.withOptions()`, i.e. BEFORE that same `finally` runs.
   * A plain natal request supplies no `mutagens`, and iztro's `config()` is merge-only
   * for that key (an omitted/undefined value silently no-ops instead of clearing), so
   * the previous horoscope caller's override is still resident in iztro's module-level
   * table and gets stamped into this caller's stars. Exactly the shape a long-lived
   * stdio MCP server sees: one caller uses a school override on
   * `calculate_ziwei_horoscope`, the next caller asks `calculate_ziwei` for a totally
   * different birth and silently gets the first caller's 四化.
   *
   * Deliberately a DIFFERENT birth in the second request, so no shared-chart caching or
   * coincidence can explain a pass, and deliberately asserted twice: the baseline must
   * itself be uncontaminated (first assert) AND unchanged afterwards (second). The
   * first assert is what stops "before == after == both corrupted" from passing if some
   * earlier test in this file happened to leave the same sentinel resident.
   */
  it('CROSS-TOOL: an overridden horoscope request does not stamp its 四化 into a later plain NATAL chart for a different birth', () => {
    const plainB = noTarget(B);
    const baseline = N(plainB);
    // The sentinel stars must not be 四化-marked by default for this birth, or the
    // "unchanged" assert below could not tell a leak from the default answer.
    for (const s of SENTINEL_1) expect(natalMarks(baseline).some(m => m.startsWith(s))).toBe(false);

    H({ ...A, mutagens: allStems(SENTINEL_1) });

    const after = N(plainB);
    expect(natalMarks(after)).toEqual(natalMarks(baseline));
    expect(after).toEqual(baseline);
  });

  it('CROSS-TOOL: the same holds for the scalar keys — an overridden horoscope request does not re-answer a later plain natal chart', () => {
    // Same direction, non-mutagens half: `algorithm`/`astroType` are supplied fresh on
    // every `astro.withOptions()` call so they cannot leak the merge-only way, but this
    // pins the whole natal answer (not just 四化) across the boundary, which is the
    // guarantee callers actually rely on.
    const plainB = noTarget(B);
    const baseline = N(plainB);
    H({ ...A, algorithm: 'zhongzhou', astroType: 'earth', mutagens: allStems(SENTINEL_2), brightness: { 紫微: Array(12).fill('陷') } });
    expect(N(plainB)).toEqual(baseline);
  });

  it('a request that THROWS still leaves the config pristine for the next one', () => {
    // Deliberately triggered by the Axis-A range guard rather than by the pre-birth
    // guard, so this test keeps testing config restoration even if some other refusal
    // is later moved or removed.
    const baseline = H(A);
    expect(() => H({
      timezone: 'America/Los_Angeles', longitude: -118.2, mutagens: allStems(SENTINEL_1),
      solarDate: { year: 1990, month: 6, day: 15 }, clockTime: { hour: 10, minute: 0 }, gender: 'male',
      target: { solarDate: { year: 2100, month: 12, day: 31 }, clockTime: { hour: 20, minute: 0 } },
    })).toThrow();
    expect(H(A)).toEqual(baseline);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Defect 4 — ageDivide:'birthday'
// ════════════════════════════════════════════════════════════════════════════════
describe('运限 audit: defect 4 — ageDivide:\'birthday\' rejected here, inert on the natal tool', () => {
  const birth = { ...FRAME, solarDate: { year: 1990, month: 6, day: 15 }, clockTime: { hour: 10, minute: 0 }, gender: 'male' as const };

  it('rejects it with an explanation of what iztro actually does, not a bare enum error', () => {
    let msg = '';
    try { parseZiweiHoroscopeInput({ ...birth, ageDivide: 'birthday' }); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain('以生日为界');
    expect(msg).toContain('ageDivide');
    // Actionable: it must say what to use instead.
    expect(msg).toContain('normal');
  });

  it('rejects it whether or not a target is present, and before any calculation happens', () => {
    for (const extra of [{}, { target: { solarDate: { year: 2025, month: 6, day: 15 }, clockTime: { hour: 13, minute: 0 } } }]) {
      expect(() => parseZiweiHoroscopeInput({ ...birth, ...extra, ageDivide: 'birthday' })).toThrow(/以生日为界/);
    }
  });

  it('still accepts the explicit default, and accepts \'birthday\' on the natal tool where 小限 is not surfaced', () => {
    expect(() => parseZiweiHoroscopeInput({ ...birth, ageDivide: 'normal' })).not.toThrow();
    expect(() => parseZiweiInput({ ...birth, ageDivide: 'birthday' })).not.toThrow();
    const { diagnostics: dBirthday, ...bodyBirthday } = N({ ...birth, ageDivide: 'birthday' });
    const { diagnostics: dNormal, ...bodyNormal } = N(birth);
    expect(bodyBirthday).toEqual(bodyNormal);                     // 小限 touches no natal field
    expect(dBirthday.convention.ageDivide).toBe('birthday');      // …it is only echoed back
    expect(dNormal.convention.ageDivide).toBe('normal');
  });

  it('always reports ageDivide:\'normal\' in the response conventions', () => {
    const res = H({ ...birth, target: { solarDate: { year: 2025, month: 6, day: 15 }, clockTime: { hour: 13, minute: 0 } } });
    expect(res.diagnostics.convention.ageDivide).toBe('normal');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Defect 5 — degenerate targets
// ════════════════════════════════════════════════════════════════════════════════
describe('运限 audit: defect 5 — degenerate targets', () => {
  const birth = { ...FRAME, solarDate: { year: 1990, month: 6, day: 15 }, clockTime: { hour: 10, minute: 0 }, gender: 'male' as const };
  const withTarget = (y: number, m: number, day: number, hour: number, over: Record<string, unknown> = {}) =>
    H({ ...birth, ...over, target: { solarDate: { year: y, month: m, day }, clockTime: { hour, minute: 0 } } });

  it('rejects a target in an earlier lunar year rather than returning index -1 / untranslated i18n keys', () => {
    expect(() => withTarget(1980, 1, 1, 12)).toThrow(/before the birth lunar year/);
    // The boundary itself: 正月初一 1990 was Jan 27. Jan 26 is still lunar 1989.
    expect(() => withTarget(1990, 1, 26, 12)).toThrow(/before the birth lunar year/);
    expect(withTarget(1990, 1, 27, 12).age.nominalAge).toBe(1);
  });

  it('accepts a same-lunar-year target before the birth date (虚岁 1 covers the whole birth lunar year)', () => {
    const res = withTarget(1990, 2, 1, 12);
    expect(res.age.nominalAge).toBe(1);
    expect(res.decadal.index).toBeGreaterThanOrEqual(0);
    expect(res.age.index).toBeGreaterThanOrEqual(0);
  });

  it('normalizes a 晚子时 target to next-day timeIndex 0, and the normalized answer IS the next-day answer', () => {
    const lateZi = withTarget(2025, 6, 15, 23);
    expect(lateZi.diagnostics.lateZiNormalized).toBe(true);
    expect(lateZi.diagnostics.targetTimeIndex).toBe(0);
    expect(lateZi.diagnostics.targetLunar).toEqual(withTarget(2025, 6, 16, 0).diagnostics.targetLunar);
    expect(lateZi.diagnostics.warnings.some(w => w.includes('晚子时'))).toBe(true);

    const nextDay = withTarget(2025, 6, 16, 0);
    expect(nextDay.diagnostics.lateZiNormalized).toBe(false);
    for (const s of SCOPES) expect(lateZi[s]).toEqual(nextDay[s]);
  });

  it('the normalized 晚子时 answer matches the ORACLE for the next day at ti 0 — not for the same day', () => {
    // The load-bearing half: iztro's own ti=12 handling advances the day ganzhi
    // without advancing daily.index, so a raw 12 produces a 流日 whose palace and
    // ganzhi disagree. Pinning against the oracle (which has no 晚子时 concept at all)
    // is the only way to say WHICH of the two consistent answers we return.
    const natal = N(birth);
    const oracleNatal = { lunarYear: oracleNatalYear(natal), lunarMonth: natal.lunar.month, lunarDay: natal.lunar.day, timeIndex: natal.lunar.timeIndex, gender: 'male' as const };
    const lateZi = withTarget(2025, 6, 15, 23, { horoscopeDivide: 'lunar_new_year' });
    const d = differ();
    compareAllScopes(d, lateZi, expectHoroscope(oracleNatal, '2025-06-16', 0), '[晚子 → next day ti0]');
    d.done(40);

    const sameDay = expectHoroscope(oracleNatal, '2025-06-15', 0);
    expect(lateZi.daily.stem + lateZi.daily.branch).not.toBe(sameDay.daily.stem + sameDay.daily.branch);
  });

  it('rejects a partial target (schema level) rather than inventing an hour', () => {
    expect(() => parseZiweiHoroscopeInput({ ...birth, target: { solarDate: { year: 2025, month: 6, day: 15 } } })).toThrow();
    expect(() => parseZiweiHoroscopeInput({ ...birth, target: { clockTime: { hour: 13, minute: 0 } } })).toThrow();
    expect(() => parseZiweiHoroscopeInput({ ...birth, target: { solarDate: { year: 2025, month: 6, day: 15 }, clockTime: { hour: 13, minute: 0 }, extra: 1 } })).toThrow();
  });

  it('rejects an out-of-range target year at the schema layer with the shared range message', () => {
    expect(() => parseZiweiHoroscopeInput({ ...birth, target: { solarDate: { year: 2101, month: 1, day: 1 }, clockTime: { hour: 0, minute: 0 } } })).toThrow(/1900 and 2100/);
  });
});

/**
 * REGRESSION GUARD — was red when written, green since commit 6dcfa85.
 *
 * What this block pins: a 立春-window birth asked about a target inside its OWN true
 * lunar year must never reach iztro's degenerate regime. It must either be rejected,
 * or answered with 虚岁 >= 1 and real palace indexes/干支 — never
 *
 *     decadal.index = -1, age.index = -1, stem = 'jia', branch = 'zi', nominalAge = 0
 *
 * The original defect: the pre-birth guard compared the target's lunar year against
 * `natal.lunarConv.lunarYear` (the TRUE birth lunar year) while 虚岁 was computed
 * against the ±1-shifted feed year. For a birth after 立春 and before 正月初一 — the
 * same window the ±1 shift exists for — those differ by one, so a target between the
 * birth instant and the following 正月初一 slipped past the guard into the garbage
 * regime defect 5b exists to block. Reachable with no exotic input: it is what a
 * person born 2024-02-09 got by asking for their 运限 on their own birthday, i.e. the
 * tool's own no-target "now" default during that window. src/core/horoscope.ts now
 * floors the 虚岁 birth side (`birthEpochLunarYear` / `inBirthOwnPreLichunSpan`), and
 * this block is what stops that floor from being refactored away.
 *
 * Both branches are still covered on purpose — the assertions accept a rejection as
 * well as a correct answer, because either is a legitimate way to keep the promise —
 * and both days matter: it is NOT the ±60 path, it reproduced with sixtyOffset 0
 * (birth 2024-02-05) as well as with a ±60 shift (birth 2024-02-09).
 */
describe('运限 audit: 立春-window birth with a target in its own lunar year never yields 虚岁 0 / index -1', () => {
  for (const [label, day] of [['with a ±60 shift (2024-02-09)', 9], ['without one (2024-02-05)', 5]] as const) {
    it(`rejects or correctly answers a same-lunar-year target for a window birth ${label}`, () => {
      const birth = { ...FRAME, solarDate: { year: 2024, month: 2, day }, clockTime: { hour: 10, minute: 0 }, gender: 'male' as const };
      let res: ReturnType<typeof calculateZiweiHoroscope> | undefined;
      try {
        res = H({ ...birth, target: { solarDate: { year: 2024, month: 2, day }, clockTime: { hour: 13, minute: 0 } } });
      } catch {
        return; // rejecting it is an acceptable outcome — that is what defect 5b is for
      }
      expect(res.age.nominalAge).toBeGreaterThanOrEqual(1);
      expect(res.decadal.index).toBeGreaterThanOrEqual(0);
      expect(res.age.index).toBeGreaterThanOrEqual(0);
      expect(STEMS).toContain(res.decadal.stem);
      expect(BRANCHES).toContain(res.age.branch);
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// Differential sweep
// ════════════════════════════════════════════════════════════════════════════════
describe('运限 audit: differential sweep vs the independent oracle', () => {
  it('matches the oracle across seeded births x targets driven through the FULL public input (not raw timeIndexes), with yearDivide pinned to lichun', () => {
    // Deliberately different from the implementer's own sweep in one decisive way:
    // yearDivide is pinned to 'lichun' via FRAME (0.2.0's own default is
    // 'lunar_new_year' — see README's Conventions table / docs/spec.md §6), so births
    // landing in the 立春↔正月初一
    // window really do get a shifted feed year and the compensation is exercised in
    // the bulk of the sweep, not only at hand-picked fixtures. horoscopeDivide is
    // pinned to 'lunar_new_year' — and ONLY that — because the oracle divides 流年 at
    // 正月初一 by construction; the lichun divergence has its own section above.
    const rnd = makeRandom(20260819);
    const d = differ();
    let windowBirths = 0;

    for (let k = 0; k < 90; k++) {
      const bHour = Math.floor(rnd() * 23); // 23 excluded: late-Zi has its own tests
      const gender = rnd() < 0.5 ? 'male' : 'female';
      // Two thirds of the births are drawn uniformly from the whole lunar calendar;
      // the last third is drawn from solar Jan 20 - Feb 18, the only stretch of the
      // year that can straddle 立春 and 正月初一 and therefore the only one that
      // produces a shifted feed year at all. A uniform sample lands there ~4% of the
      // time, which is how a sweep silently degrades into a feed-shift-free one.
      let birth: Record<string, unknown>;
      if (k % 3 === 2) {
        const sy = 1905 + Math.floor(rnd() * 190);
        const dayOfWindow = Math.floor(rnd() * 30);
        const sm = dayOfWindow < 12 ? 1 : 2;
        const sd = dayOfWindow < 12 ? 20 + dayOfWindow : dayOfWindow - 11;
        birth = { ...FRAME, solarDate: { year: sy, month: sm, day: sd }, clockTime: { hour: bHour, minute: 0 }, gender };
      } else {
        const ly = 1905 + Math.floor(rnd() * 190);
        const lm = 1 + Math.floor(rnd() * 12);
        const ld = 1 + Math.floor(rnd() * daysInLunarMonth(ly, lm));
        birth = { ...FRAME, lunarDate: { year: ly, month: lm, day: ld }, clockTime: { hour: bHour, minute: 0 }, gender };
      }
      let natal: ReturnType<typeof calculateZiweiChart>;
      try { natal = N(birth); } catch { continue; }   // out-of-range solar year for an edge lunar date
      if (natal.lunar.isLeapMonth) continue;          // the oracle only models non-leap births
      const L = oracleNatalYear(natal);
      if (L !== natal.lunar.year) windowBirths++;

      for (let j = 0; j < 4; j++) {
        const ty = L + Math.floor(rnd() * 95);
        if (ty > 2100) continue;
        const tm = 1 + Math.floor(rnd() * 12);
        const td = 1 + Math.floor(rnd() * 28);
        const tHour = Math.floor(rnd() * 23);
        const targetStr = `${ty}-${pad(tm)}-${pad(td)}`;
        // 虚岁 >= 1 required: the oracle's own 童限 table is undefined below it, and a
        // target lunar year under L is the degenerate regime tested separately above.
        const got = H({ ...birth, horoscopeDivide: 'lunar_new_year', target: { solarDate: { year: ty, month: tm, day: td }, clockTime: { hour: tHour, minute: 0 } } });
        if (got.diagnostics.targetLunar.year < L) continue;
        const want = expectHoroscope({ lunarYear: L, lunarMonth: natal.lunar.month, lunarDay: natal.lunar.day, timeIndex: natal.lunar.timeIndex, gender }, targetStr, tiOf(tHour));
        compareAllScopes(d, got, want, `[${JSON.stringify(birth.solarDate ?? birth.lunarDate)} h${bHour} ${gender} → ${targetStr} h${tHour}]`);
      }
    }

    d.done(5000);
    // The sweep must actually contain window births (feedYear !== true lunar year), or
    // it silently degrades into the implementer's own feed-shift-free sweep.
    expect(windowBirths).toBeGreaterThan(5);
  });

  it('holds the same invariants for 童限-era targets specifically (虚岁 below 起运)', () => {
    // 童限 is a whole separate branch of 大限 (一命二财三疾厄四妻五福六官禄) and only
    // ever fires for 虚岁 < 五行局, i.e. the first 2-6 years of life — never sampled by
    // a uniform random target year.
    const rnd = makeRandom(7311);
    const d = differ();
    let sawTongxian = 0;
    for (let k = 0; k < 25; k++) {
      const ly = 1930 + Math.floor(rnd() * 150);
      const lm = 1 + Math.floor(rnd() * 12);
      const ld = 1 + Math.floor(rnd() * daysInLunarMonth(ly, lm));
      const gender: 'male' | 'female' = rnd() < 0.5 ? 'male' : 'female';
      const birth = { ...FRAME, lunarDate: { year: ly, month: lm, day: ld }, clockTime: { hour: 13, minute: 0 }, gender };
      let natal: ReturnType<typeof calculateZiweiChart>;
      try { natal = N(birth); } catch { continue; }
      if (natal.lunar.isLeapMonth) continue;
      const L = oracleNatalYear(natal);
      const oracleNatal = { lunarYear: L, lunarMonth: natal.lunar.month, lunarDay: natal.lunar.day, timeIndex: natal.lunar.timeIndex, gender };

      for (let age = 1; age <= 7; age++) {
        const targetStr = `${L + age - 1}-08-15`;
        const got = H({ ...birth, horoscopeDivide: 'lunar_new_year', target: { solarDate: { year: L + age - 1, month: 8, day: 15 }, clockTime: { hour: 13, minute: 0 } } });
        if (got.diagnostics.targetLunar.year !== L + age - 1) continue;
        const want = expectHoroscope(oracleNatal, targetStr, tiOf(13));
        d.eq(got.age.nominalAge, age, `[${targetStr}] nominalAge`);
        d.eq(got.decadal.name, want.decadal.tongxian ? '童限' : '大限', `[${targetStr}] decadal.name`);
        if (want.decadal.tongxian) sawTongxian++;
        compareAllScopes(d, got, want, `[童限 lunar ${ly}-${lm}-${ld} ${gender} → ${targetStr}]`);
      }
    }
    d.done(1000);
    expect(sawTongxian).toBeGreaterThan(20);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Scope boundaries
// ════════════════════════════════════════════════════════════════════════════════
describe('运限 audit: 大限 / 小限 / 童限 boundaries', () => {
  // Birth 1990-06-15 10:00 at UTC+8/120E, male: 火六局, so 大限 starts at 虚岁 6 and
  // each decade turns at 虚岁 16, 26, 36…  Every expectation below is cross-checked
  // against the oracle rather than hard-coded from the implementation's own output.
  const birth = { ...FRAME, solarDate: { year: 1990, month: 6, day: 15 }, clockTime: { hour: 10, minute: 0 }, gender: 'male' as const };
  const natal = N(birth);
  const L = oracleNatalYear(natal);
  const oracleNatal = { lunarYear: L, lunarMonth: natal.lunar.month, lunarDay: natal.lunar.day, timeIndex: natal.lunar.timeIndex, gender: 'male' as const };
  const inYear = (y: number) => H({ ...birth, horoscopeDivide: 'lunar_new_year', target: { solarDate: { year: y, month: 8, day: 15 }, clockTime: { hour: 13, minute: 0 } } });
  const oracleInYear = (y: number) => expectHoroscope(oracleNatal, `${y}-08-15`, tiOf(13));

  it('crosses the 童限 -> 大限 boundary at 起运 (虚岁 = 五行局)', () => {
    const before = inYear(1994);
    const after = inYear(1995);
    expect(before.age.nominalAge).toBe(5);
    expect(after.age.nominalAge).toBe(6);
    expect(before.decadal.name).toBe('童限');
    expect(after.decadal.name).toBe('大限');
    expect(oracleInYear(1994).decadal.tongxian).toBe(true);
    expect(oracleInYear(1995).decadal.tongxian).toBeUndefined();
    expect(before.decadal.index).toBe(oracleInYear(1994).decadal.index);
    expect(after.decadal.index).toBe(oracleInYear(1995).decadal.index);
  });

  it('holds 大限 fixed inside a decade and moves it by exactly one palace at the boundary', () => {
    for (const [lastOfDecade, firstOfNext] of [[2004, 2005], [2014, 2015], [2024, 2025]] as const) {
      const a = inYear(lastOfDecade);
      const b = inYear(firstOfNext);
      const mid = inYear(lastOfDecade - 5);
      expect(a.decadal.index).toBe(mid.decadal.index);           // stable inside the decade
      expect(b.decadal.index).toBe((a.decadal.index + 1) % 12);  // 阳男 => forward one palace
      expect(a.decadal.index).toBe(oracleInYear(lastOfDecade).decadal.index);
      expect(b.decadal.index).toBe(oracleInYear(firstOfNext).decadal.index);
      expect(b.age.nominalAge).toBe(a.age.nominalAge + 1);
      // The scope's own ganzhi and 四化 must move with it, not lag behind.
      expect(b.decadal.stem + b.decadal.branch).toBe(oracleInYear(firstOfNext).decadal.stem + oracleInYear(firstOfNext).decadal.branch);
      expect(b.decadal.mutagen).toEqual(oracleInYear(firstOfNext).decadal.mutagen);
    }
  });

  it('advances 小限 by one palace per 虚岁 (男顺), wrapping 11 -> 0, matching the oracle at every step', () => {
    let prev: number | undefined;
    for (let y = 1996; y <= 2012; y++) {
      const r = inYear(y);
      expect(r.age.index).toBe(oracleInYear(y).age.index);
      expect(r.age.nominalAge).toBe(oracleInYear(y).age.nominalAge!);
      if (prev !== undefined) expect(r.age.index).toBe((prev + 1) % 12);
      prev = r.age.index;
    }
    expect(prev).toBeDefined();
  });

  it('runs 小限 backwards for a female of the same year (女逆), so the direction is not accidentally hard-coded', () => {
    const her = { ...birth, gender: 'female' as const };
    const herNatal = N(her);
    const herOracle = { lunarYear: oracleNatalYear(herNatal), lunarMonth: herNatal.lunar.month, lunarDay: herNatal.lunar.day, timeIndex: herNatal.lunar.timeIndex, gender: 'female' as const };
    let prev: number | undefined;
    for (let y = 1996; y <= 2004; y++) {
      const r = H({ ...her, horoscopeDivide: 'lunar_new_year', target: { solarDate: { year: y, month: 8, day: 15 }, clockTime: { hour: 13, minute: 0 } } });
      expect(r.age.index).toBe(expectHoroscope(herOracle, `${y}-08-15`, tiOf(13)).age.index);
      if (prev !== undefined) expect(r.age.index).toBe((prev + 11) % 12);
      prev = r.age.index;
    }
  });

  it('turns 大限/小限/流年 exactly at 正月初一, not at the solar new year or the birthday', () => {
    // 正月初一 2005 = Feb 9. Feb 8 is still 虚岁 15; Feb 9 is 16, and that is where the
    // decade turns — the birthday (June 15) is irrelevant under ageDivide:'normal'.
    const on = (y: number, m: number, day: number) => H({ ...birth, horoscopeDivide: 'lunar_new_year', target: { solarDate: { year: y, month: m, day }, clockTime: { hour: 13, minute: 0 } } });
    expect(on(2005, 2, 8).age.nominalAge).toBe(15);
    expect(on(2005, 2, 9).age.nominalAge).toBe(16);
    expect(on(2005, 2, 8).decadal.index).toBe(on(2004, 12, 31).decadal.index);
    expect(on(2005, 2, 9).decadal.index).toBe((on(2005, 2, 8).decadal.index + 1) % 12);
    expect(on(2005, 6, 14).decadal.index).toBe(on(2005, 6, 16).decadal.index);
    expect(on(2005, 2, 9).yearly.stem + on(2005, 2, 9).yearly.branch).toBe('乙酉');
    expect(on(2005, 2, 8).yearly.stem + on(2005, 2, 8).yearly.branch).toBe('甲申');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Per-scope sourcing, both directions
// ════════════════════════════════════════════════════════════════════════════════
describe('运限 audit: per-scope sourcing (year-scoped vs true-target), both directions', () => {
  const birth = { ...FRAME, solarDate: { year: 1990, month: 6, day: 15 }, clockTime: { hour: 10, minute: 0 }, gender: 'male' as const };
  const at = (m: number, day: number, hour: number) => H({ ...birth, target: { solarDate: { year: 2025, month: m, day }, clockTime: { hour, minute: 0 } } });

  it('year-scoped blocks are byte-identical across every date in the same lunar year', () => {
    const samples = [at(3, 1, 13), at(6, 15, 13), at(9, 30, 1), at(12, 31, 21)];
    for (const s of samples.slice(1)) {
      expect(s.decadal).toEqual(samples[0].decadal);
      expect(s.age).toEqual(samples[0].age);
      expect(s.yearly).toEqual(samples[0].yearly);
    }
    // …and the monthly/daily/hourly blocks are NOT (or the sweep proves nothing).
    expect(samples[1].monthly).not.toEqual(samples[0].monthly);
    expect(samples[1].daily).not.toEqual(samples[0].daily);
  });

  it('流日 advances one palace and one day-ganzhi per calendar day, wrapping the palace ring', () => {
    const seen: string[] = [];
    let prev = at(6, 10, 13);
    for (let day = 11; day <= 24; day++) {
      const cur = at(6, day, 13);
      expect(cur.daily.index).toBe((prev.daily.index + 1) % 12);
      expect(cur.daily.stem + cur.daily.branch).not.toBe(prev.daily.stem + prev.daily.branch);
      seen.push(cur.daily.stem + cur.daily.branch);
      prev = cur;
    }
    expect(new Set(seen).size).toBe(seen.length);   // 14 distinct day ganzhi
  });

  it('流时 advances with the target hour while 流日 stays put', () => {
    const hours = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21];
    const base = at(6, 15, 1);
    const seen = new Set<string>();
    for (const h of hours) {
      const cur = at(6, 15, h);
      expect(cur.daily).toEqual(base.daily);
      expect(cur.hourly.index).toBe((cur.daily.index + tiOf(h)) % 12);
      seen.add(cur.hourly.stem + cur.hourly.branch);
    }
    expect(seen.size).toBe(hours.length);
  });

  it('流月 follows the target lunar month, not the solar one', () => {
    // 2025 正月初一 = Jan 29, so Jan 20 and Feb 5 are in DIFFERENT lunar years and
    // months while sitting 16 days apart across a solar year boundary.
    const janTwentieth = H({ ...birth, target: { solarDate: { year: 2025, month: 1, day: 20 }, clockTime: { hour: 13, minute: 0 } } });
    const febFifth = H({ ...birth, target: { solarDate: { year: 2025, month: 2, day: 5 }, clockTime: { hour: 13, minute: 0 } } });
    expect(janTwentieth.diagnostics.targetLunar.year).toBe(2024);
    expect(febFifth.diagnostics.targetLunar.year).toBe(2025);
    expect(janTwentieth.monthly.stem + janTwentieth.monthly.branch).not.toBe(febFifth.monthly.stem + febFifth.monthly.branch);
    // Two dates inside one lunar month share a 流月 exactly.
    expect(at(6, 2, 13).monthly).toEqual(at(6, 10, 13).monthly);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Target time layer
// ════════════════════════════════════════════════════════════════════════════════
describe('运限 audit: the target goes through the same time layer as the birth', () => {
  it('the same instant expressed in two timezones yields the same 运限 (birth AND target)', () => {
    // 1990-06-15 10:00 PDT == 17:00 UTC; 2025-07-15 12:00 PDT == 19:00 UTC. Same
    // longitude on both sides, so the true solar time — which depends on the instant
    // and the meridian, never on the civil zone — must be identical, and with it every
    // scope. If the target were resolved against a fixed or a wrong zone, these diverge.
    const la = H({ timezone: 'America/Los_Angeles', longitude: -118.2, solarDate: { year: 1990, month: 6, day: 15 }, clockTime: { hour: 10, minute: 0 }, gender: 'male', target: { solarDate: { year: 2025, month: 7, day: 15 }, clockTime: { hour: 12, minute: 0 } } });
    const utc = H({ timezone: 'UTC', longitude: -118.2, solarDate: { year: 1990, month: 6, day: 15 }, clockTime: { hour: 17, minute: 0 }, gender: 'male', target: { solarDate: { year: 2025, month: 7, day: 15 }, clockTime: { hour: 19, minute: 0 } } });

    for (const s of SCOPES) expect(la[s]).toEqual(utc[s]);
    expect(la.diagnostics.targetUtcInstant).toBe(utc.diagnostics.targetUtcInstant);
    expect(la.diagnostics.axisB_localTrueSolarTime).toBe(utc.diagnostics.axisB_localTrueSolarTime);
    expect(la.diagnostics.targetTimeIndex).toBe(utc.diagnostics.targetTimeIndex);
    // The wall-clock strings, on the other hand, must NOT be equal — otherwise the two
    // inputs were not actually different.
    expect(la.diagnostics.targetWallClock).not.toBe(utc.diagnostics.targetWallClock);
  });

  it('applies True Solar Time to the TARGET, not just the birth (a far-west meridian moves the 流时)', () => {
    // Urumqi's meridian (~87.6E) under Asia/Shanghai: the target clock says 12:30 but
    // the sun says ~10:19, which is 巳 (ti 5), not 午 (ti 6).
    const base = { timezone: 'Asia/Shanghai', longitude: 87.6, solarDate: { year: 1990, month: 6, day: 15 }, clockTime: { hour: 10, minute: 0 }, gender: 'male' as const, target: { solarDate: { year: 2025, month: 6, day: 15 }, clockTime: { hour: 12, minute: 30 } } };
    const corrected = H({ ...base, trueSolar: true });
    const raw = H({ ...base, trueSolar: false });

    expect(corrected.diagnostics.targetTimeIndex).toBe(5);
    expect(corrected.hourly.branch).toBe('巳');
    expect(corrected.diagnostics.axisB_localTrueSolarTime).toStartWith('2025-06-15 10:');
    expect(raw.diagnostics.targetTimeIndex).toBe(6);
    expect(raw.hourly.branch).toBe('午');
    expect(raw.diagnostics.axisB_localTrueSolarTime).toBe('2025-06-15 12:30');
    // Same instant either way — only the interpretation of it changed.
    expect(corrected.diagnostics.targetUtcInstant).toBe(raw.diagnostics.targetUtcInstant);
    expect(corrected.diagnostics.convention.trueSolar).toBe(true);
    expect(raw.diagnostics.convention.trueSolar).toBe(false);
  });

  it('honours dstFold on an ambiguous target instant in a DST fall-back overlap', () => {
    // 2025-11-02 01:30 happens twice in America/Los_Angeles. The two occurrences are
    // an hour apart, which straddles a 时辰 boundary here: 子 vs 丑.
    const base = { timezone: 'America/Los_Angeles', longitude: -118.2, solarDate: { year: 1990, month: 6, day: 15 }, clockTime: { hour: 10, minute: 0 }, gender: 'male' as const };
    const target = { solarDate: { year: 2025, month: 11, day: 2 }, clockTime: { hour: 1, minute: 30 } };
    const first = H({ ...base, target: { ...target, dstFold: 0 } });
    const second = H({ ...base, target: { ...target, dstFold: 1 } });

    expect(first.diagnostics.targetUtcInstant).toBe('2025-11-02T08:30:00.000Z');
    expect(second.diagnostics.targetUtcInstant).toBe('2025-11-02T09:30:00.000Z');
    expect(first.diagnostics.targetTimeIndex).toBe(0);
    expect(second.diagnostics.targetTimeIndex).toBe(1);
    expect(first.hourly.branch).toBe('子');
    expect(second.hourly.branch).toBe('丑');
    // Year-scoped blocks cannot care which fold it was.
    expect(first.decadal).toEqual(second.decadal);
    expect(first.age).toEqual(second.age);
    expect(first.yearly).toEqual(second.yearly);
  });

  it('resolves a target inside a DST period against the offset in force THEN, not the birth\'s offset', () => {
    const base = { timezone: 'America/Los_Angeles', longitude: -118.2, solarDate: { year: 1990, month: 1, day: 15 }, clockTime: { hour: 10, minute: 0 }, gender: 'male' as const };
    const summer = H({ ...base, target: { solarDate: { year: 2025, month: 7, day: 15 }, clockTime: { hour: 12, minute: 0 } } });
    const winter = H({ ...base, target: { solarDate: { year: 2025, month: 1, day: 15 }, clockTime: { hour: 12, minute: 0 } } });
    expect(summer.diagnostics.targetUtcInstant).toBe('2025-07-15T19:00:00.000Z');  // PDT, UTC-7
    expect(winter.diagnostics.targetUtcInstant).toBe('2025-01-15T20:00:00.000Z');  // PST, UTC-8
  });

  it('rejects a target whose Beijing-time projection leaves the supported range, with the shared range wording', () => {
    // 2100-12-31 20:00 in Los Angeles is 2101-01-01 in Beijing — schema-valid, but
    // Axis A (which always runs on the UTC+8 projection) falls off the table.
    expect(() => H({
      timezone: 'America/Los_Angeles', longitude: -118.2,
      solarDate: { year: 1990, month: 6, day: 15 }, clockTime: { hour: 10, minute: 0 }, gender: 'male',
      target: { solarDate: { year: 2100, month: 12, day: 31 }, clockTime: { hour: 20, minute: 0 } },
    })).toThrow(/1900 and 2100/);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// The "now" default
// ════════════════════════════════════════════════════════════════════════════════
describe('运限 audit: the omitted-target ("now") path', () => {
  const birth = { ...FRAME, solarDate: { year: 1990, month: 6, day: 15 }, clockTime: { hour: 10, minute: 0 }, gender: 'male' as const };

  it('defaults to the current instant, bounded by readings taken around the call', () => {
    // No wall-clock assertion: just that the instant it chose lies between two
    // Date.now() readings straddling the call.
    const before = Date.now();
    const res = H(birth);
    const after = Date.now();
    const chosen = Date.parse(res.diagnostics.targetUtcInstant);
    expect(chosen).toBeGreaterThanOrEqual(before - 1000);
    expect(chosen).toBeLessThanOrEqual(after + 1000);
    expect(res.diagnostics.targetWallClock).toContain('Etc/GMT-8');
  });

  it('satisfies the same 虚岁 invariant as an explicit target, with no hard-coded date', () => {
    const res = H(birth);
    const c = res.diagnostics.feedYearCompensation;
    expect(res.age.nominalAge).toBe(res.diagnostics.targetLunar.year - (c.birthFeedYear - c.sixtyYearOffsetApplied) + 1);
    expect(res.age.nominalAge).toBeGreaterThanOrEqual(1);
    expect(res.decadal.index).toBeGreaterThanOrEqual(0);
    expect(SCOPE_NAMES.has(res.decadal.name)).toBe(true);
  });

  it('reproduces its own answer when that instant is handed back as an explicit target', () => {
    // Etc/GMT-8 has no DST in any year, so the wall clock reconstructs unambiguously.
    // Only the year-scoped blocks are compared: the target schema has no `second`
    // field, so the round trip truncates up to 59s, which can legitimately cross a
    // 时辰 or a day boundary and move 流时/流日.
    const now = H(birth);
    const wall = new Date(Date.parse(now.diagnostics.targetUtcInstant) + 8 * 3600_000);
    const replay = H({
      ...birth,
      target: {
        solarDate: { year: wall.getUTCFullYear(), month: wall.getUTCMonth() + 1, day: wall.getUTCDate() },
        clockTime: { hour: wall.getUTCHours(), minute: wall.getUTCMinutes() },
      },
    });
    expect(replay.decadal).toEqual(now.decadal);
    expect(replay.age).toEqual(now.age);
    expect(replay.yearly).toEqual(now.yearly);
    expect(replay.diagnostics.targetLunar).toEqual(now.diagnostics.targetLunar);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Output shape
// ════════════════════════════════════════════════════════════════════════════════
describe('运限 audit: output trimming (spec §7 discipline) — nothing from iztro leaks', () => {
  const res = H({ ...FRAME, solarDate: { year: 1990, month: 6, day: 15 }, clockTime: { hour: 10, minute: 0 }, gender: 'male', target: { solarDate: { year: 2025, month: 6, day: 15 }, clockTime: { hour: 13, minute: 0 } } });

  it('returns exactly the six scopes plus diagnostics — no natal chart, no extra top-level keys', () => {
    expect(Object.keys(res).sort()).toEqual(['age', 'daily', 'decadal', 'diagnostics', 'hourly', 'monthly', 'yearly']);
  });

  it('pins each scope to an exact key set, so a future field cannot appear unreviewed', () => {
    // Asserted on the SERIALIZED response, which is what an MCP caller actually
    // receives: `mapScope` sets `stars` unconditionally, so in-process the 小限 object
    // carries a `stars: undefined` key that JSON drops.
    const wire = JSON.parse(JSON.stringify(res));
    const common = ['branch', 'index', 'mutagen', 'name', 'palaceNames', 'stars', 'stem'];
    expect(Object.keys(wire.decadal).sort()).toEqual(common);
    expect(Object.keys(wire.monthly).sort()).toEqual(common);
    expect(Object.keys(wire.daily).sort()).toEqual(common);
    expect(Object.keys(wire.hourly).sort()).toEqual(common);
    expect(Object.keys(wire.yearly).sort()).toEqual([...common, 'yearlyDecStars'].sort());
    // 小限 has no 运曜 in iztro and must not have one fabricated here.
    expect(Object.keys(wire.age).sort()).toEqual(['branch', 'index', 'mutagen', 'name', 'nominalAge', 'palaceNames', 'stem']);
    expect(res.age.stars).toBeUndefined();
  });

  it('renders 运曜 as bare names by palace, never iztro star objects', () => {
    for (const s of ['decadal', 'yearly', 'monthly', 'daily', 'hourly'] as const) {
      expect(res[s].stars).toHaveLength(12);
      for (const palace of res[s].stars!) {
        expect(Array.isArray(palace)).toBe(true);
        for (const n of palace) expect(typeof n).toBe('string');
      }
      expect(res[s].mutagen).toHaveLength(4);
      expect(res[s].palaceNames).toHaveLength(12);
    }
    expect(res.yearly.yearlyDecStars.suiqian12).toHaveLength(12);
    expect(res.yearly.yearlyDecStars.jiangqian12).toHaveLength(12);
  });

  it('contains none of iztro\'s internal field names anywhere in the serialized response', () => {
    // The natal suite's own rule: iztro's lunarDate/solarDate/chineseDate are poisoned
    // by the feed-year substitution and must never reach a caller — nor may its raw
    // horoscope field names, which would invite callers to depend on them.
    const forbidden = ['heavenlyStem', 'earthlyBranch', 'yearlyDecStar', 'lunarDate', 'solarDate', 'chineseDate', 'rawDates', 'scope', 'isBodyPalace', 'majorStars', 'palaces', 'soulPalace'];
    const keys = new Set<string>();
    (function walk(v: unknown): void {
      if (Array.isArray(v)) return v.forEach(walk);
      if (v && typeof v === 'object') for (const [k, val] of Object.entries(v)) { keys.add(k); walk(val); }
    })(res);
    for (const f of forbidden) expect(keys.has(f)).toBe(false);
  });

  it('serializes to JSON without loss (the MCP transport only ever sees JSON)', () => {
    expect(JSON.parse(JSON.stringify(res))).toEqual(res);
  });

  it('reports the engine versions and the resolved conventions the answer was computed under', () => {
    expect(res.diagnostics.engineInfo.iztro).toBe('2.6.0');
    expect(res.diagnostics.engineInfo.schemaVersion).toBe('1.0.0');
    expect(res.diagnostics.convention).toEqual({
      horoscopeDivide: 'lichun', ageDivide: 'normal', dayDivide: 'forward',
      algorithm: 'default', astroType: 'heaven', fixLeap: true, trueSolar: false,
    });
    expect(res.diagnostics.locationSource).toBe('caller_supplied');
  });
});
