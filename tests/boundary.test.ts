import { describe, it, expect } from 'bun:test';
import { calculateZiweiChart } from '../src/core/chart';
import { ZiweiInputSchema, parseZiweiInput } from '../src/schemas/input';
import starZhCN from 'iztro/lib/i18n/locales/zh-CN/star';
import { ganZhiOfLunarYear, lunarYearForGanZhi } from '../src/core/lunar';
import { resolveLocation, lookupCity } from '../src/geo/resolver';
import type { ZiweiInput, ValidatedZiweiInput } from '../src/types';
import { idx, findStarTrimmed } from './ziwei-rules';

const chart = (input: ZiweiInput) => calculateZiweiChart(ZiweiInputSchema.parse(input) as ValidatedZiweiInput);

describe('8.2 DST gaps, folds and dstFold', () => {
  it('rejects a nonexistent spring-forward wall clock time', () => {
    expect(() =>
      chart({
        timezone: 'America/Los_Angeles', longitude: -122.4443,
        solarDate: { year: 1990, month: 4, day: 1 }, clockTime: { hour: 2, minute: 30 }, gender: 'male',
      })
    ).toThrow('DST spring-forward gap');
  });

  it('rejects an ambiguous fall-back wall clock time when dstFold is missing', () => {
    expect(() =>
      chart({
        timezone: 'America/Los_Angeles', longitude: -122.4443,
        solarDate: { year: 1990, month: 10, day: 28 }, clockTime: { hour: 1, minute: 30 }, gender: 'male',
      })
    ).toThrow('DST fall-back overlap');
  });

  // The resolved fold must reach the *chart*, not just the diagnostics block: fold 0's
  // true solar time is 00:36 (早子时, timeIndex 0) and fold 1's is 01:36 (丑, timeIndex 1),
  // which is a different 命宫 entirely.
  it('disambiguates a US fall-back fold with dstFold 0 vs 1, all the way into the chart', () => {
    const base = {
      timezone: 'America/Los_Angeles', longitude: -122.4443,
      solarDate: { year: 1990, month: 10, day: 28 }, clockTime: { hour: 1, minute: 30 }, gender: 'male',
    } as const;

    const fold0 = chart({ ...base, dstFold: 0 });
    expect(fold0.diagnostics.utcInstant).toBe('1990-10-28T08:30:00.000Z');
    expect(fold0.diagnostics.utcOffset).toContain('-07:00');
    expect(fold0.lunar.timeIndex).toBe(0);
    expect(fold0.soulPalace.branch).toBe('戌');

    const fold1 = chart({ ...base, dstFold: 1 });
    expect(fold1.diagnostics.utcInstant).toBe('1990-10-28T09:30:00.000Z');
    expect(fold1.diagnostics.utcOffset).toBe('-08:00');
    expect(fold1.lunar.timeIndex).toBe(1);
    expect(fold1.soulPalace.branch).toBe('酉');

    expect(fold0.palaces).not.toEqual(fold1.palaces);
  });

  it('disambiguates China\'s own 1988 fall-back fold (1988-09-11 01:30 Asia/Shanghai)', () => {
    const base = {
      timezone: 'Asia/Shanghai', longitude: 116.4074,
      solarDate: { year: 1988, month: 9, day: 11 }, clockTime: { hour: 1, minute: 30 }, gender: 'male',
    } as const;

    expect(() => chart(base)).toThrow('DST fall-back overlap');

    const fold0 = chart({ ...base, dstFold: 0 });
    const fold1 = chart({ ...base, dstFold: 1 });
    expect(fold0.lunar.timeIndex).toBe(0);
    expect(fold1.lunar.timeIndex).toBe(1);
    expect(fold0.soulPalace.branch).toBe('酉');
    expect(fold1.soulPalace.branch).toBe('申');
  });

  // 丑 spans 01:00-02:59 and its midpoint 02:00 falls in LA's 1990 spring-forward gap,
  // but 01:00 existed that day — so this must return a chart with a warning, not throw.
  it('falls back to a valid shichen sample point when the midpoint lands in a DST gap', () => {
    const res = chart({
      timezone: 'America/Los_Angeles', longitude: -122.4443,
      solarDate: { year: 1990, month: 4, day: 1 }, shichen: '丑', gender: 'male',
    });
    expect(res.palaces).toHaveLength(12);
    expect(res.diagnostics.warnings.some(w => w.includes('spring-forward gap'))).toBe(true);
  });

  /**
   * Finding #4: `lunarDateFrame:'beijing'` resolves its wall clock against
   * Asia/Shanghai, not the birth place's own timezone — China had its own DST through
   * 1991, including a spring-forward gap on 1986-05-04 (02:00 -> 03:00). 丑 spans
   * 01:00-02:59, so its midpoint (02:00) lands exactly in that gap. Before the fix,
   * this bypassed the shichen sample-point fallback entirely (it called wallToInstant
   * directly) and hard-errored naming Asia/Shanghai; it must now recover with a
   * warning, exactly like the local-frame case above.
   */
  it('falls back to a valid shichen sample point in the Beijing frame too, when the midpoint lands in a DST gap there', () => {
    const res = chart({
      timezone: 'America/Los_Angeles', longitude: -122.4443,
      lunarDate: { year: 1986, month: 3, day: 26 }, lunarDateFrame: 'beijing',
      shichen: '丑', gender: 'male',
    });
    expect(res.palaces).toHaveLength(12);
    expect(res.diagnostics.warnings.some(w => w.includes('spring-forward gap') && w.includes('Asia/Shanghai'))).toBe(true);
  });
});

describe('8.2 Lunar month handling', () => {
  it('accepts a genuine leap lunar month (2020 leap 4th month, 15th day)', () => {
    const res = chart({
      place: 'Beijing', lunarDate: { year: 2020, month: 4, day: 15, isLeapMonth: true },
      clockTime: { hour: 12, minute: 0 }, gender: 'male',
    });
    // Leap 4th month 15th is 2020-06-06; the NON-leap 4th month 15th is 2020-05-07.
    expect(res.diagnostics.lunar.solarDate).toBe('2020-06-06');
    expect(res.lunar).toMatchObject({ year: 2020, month: 4, day: 15, isLeapMonth: true });
    expect(res.soulPalace.branch).toBe('亥');
    expect(res.fiveElementsClass).toBe('土五局');
    expect(findStarTrimmed(res, '紫微')).toBe(idx('辰'));
  });

  /**
   * 2021 has no leap 4th month. lunar-lite's own `lunar2solar('2021-4-15', true)`
   * silently ignores the leap flag and returns the ordinary 2021-4-15 (solar
   * 2021-05-26) — a full chart for a date that never existed, with
   * `lunar.isLeapMonth: false` quietly contradicting the caller's input and no
   * warning, which would be the worst possible outcome for a birth-chart service.
   * `assertLeapMonthExists` (src/core/lunar.ts), called before any conversion in
   * chart.ts, closes this: it round-trips through solar2lunar to confirm the named
   * leap month genuinely exists before ever reaching lunar-lite's silent-ignore path,
   * and rejects with a clear explanation otherwise. bazi-mcp rejects the same input.
   */
  it('rejects an invalid leap lunar month (2021 has no leap 4th month)', () => {
    expect(() =>
      chart({
        place: 'Beijing', lunarDate: { year: 2021, month: 4, day: 15, isLeapMonth: true },
        clockTime: { hour: 12, minute: 0 }, gender: 'male',
      })
    ).toThrow();
  });

  /**
   * Solar 1952-07-21 is 闰五月三十 1952: a real calendar day, correctly reported by
   * lunar-lite as {lunarMonth:5, lunarDay:30, isLeap:true}. iztro 2.6.0's `type:'lunar'`
   * entry point validates the day count against the NON-leap 5th month (29 days) even
   * when isLeapMonth:true is passed, and would throw "only 29 days in lunar year 1952
   * month 5" if used directly. chart.ts works around this (spec §5 "Defect B" comment)
   * by feeding such dates to iztro via `type:'solar'` instead whenever no feed-year
   * shift is needed (the overwhelming majority of births, this one included) — that
   * entry point computes the lunar date internally via solar2lunar and never hits the
   * day-count guard at all.
   *
   * This is NOT the probe-findings P2a feed-year crash: feedYear here equals lunar.year
   * (1952), so `lunarYearForGanZhi`'s ±60 fallback never engages. It is a separate
   * failure mode that the differential battery in tests/global_multiregion.test.ts
   * found independently.
   *
   * A calendar scan of 1900-2100 finds 17 such days that hit this defect if fed to
   * iztro via `type:'lunar'` unmodified, including one in living memory and one still
   * ahead — all 17 must build successfully via the `type:'solar'` workaround:
   *   1906-06-21 1914-07-22 1919-09-23 1925-06-20 1936-05-20 1938-09-23 1941-08-22
   *   1944-06-20 1952-07-21 1955-05-21 2017-08-21 2036-08-21 2047-07-22 2050-05-20
   *   2055-08-22 2058-06-20 2093-08-21
   */
  it('builds a chart for the 30th day of a leap month whose non-leap twin has 29 days', () => {
    const res = chart({
      timezone: 'Asia/Shanghai', longitude: 120,
      solarDate: { year: 2017, month: 8, day: 21 }, clockTime: { hour: 12, minute: 0 }, gender: 'male',
    });
    expect(res.lunar).toMatchObject({ year: 2017, month: 6, day: 30, isLeapMonth: true });
    expect(res.palaces).toHaveLength(12);
  });

  /**
   * The sole guard on the leap-30 recovery path in src/core/lunar.ts's `lunar2solar`
   * wrapper (finding #3): a genuine 闰月三十 fed in via `lunarDate` must independently
   * recover the correct solar date (lunar-lite's own `lunar2solar` would otherwise
   * throw here too, for the same underlying reason as the `type:'lunar'` path above —
   * see lunar.ts's docblock) and produce a chart identical to feeding the same birth
   * via `solarDate` (the test directly above).
   */
  it('builds an identical chart for the same leap-30 day via the lunarDate input path as via solarDate', () => {
    const viaLunar = chart({
      timezone: 'Asia/Shanghai', longitude: 120,
      lunarDate: { year: 2017, month: 6, day: 30, isLeapMonth: true },
      clockTime: { hour: 12, minute: 0 }, gender: 'male',
    });
    expect(viaLunar.diagnostics.lunar.solarDate).toBe('2017-08-21');
    expect(viaLunar.lunar).toMatchObject({ year: 2017, month: 6, day: 30, isLeapMonth: true });

    const viaSolar = chart({
      timezone: 'Asia/Shanghai', longitude: 120,
      solarDate: { year: 2017, month: 8, day: 21 }, clockTime: { hour: 12, minute: 0 }, gender: 'male',
    });
    expect(viaLunar.palaces).toEqual(viaSolar.palaces);
    expect(viaLunar.soulPalace).toEqual(viaSolar.soulPalace);
    expect(viaLunar.fiveElementsClass).toBe(viaSolar.fiveElementsClass);
  });

  /**
   * Finding #3: a genuinely too-short leap month (day 30 requested, but the leap
   * month itself only has 29 days) is a correct refusal — but lunar-lite's own error
   * text leaks its internal negative-month encoding for this exact case: 1900's leap
   * 8th month has 29 days, and requesting day 30 of it throws lunar-lite's raw "only
   * 29 days in lunar year 1900 month -8" (verified directly against lunar-typescript).
   * The wrapper must translate this into our own wording that names the leap month
   * explicitly and never leaks "-8".
   */
  it('rejects day 30 of a leap month that only has 29 days, without leaking lunar-lite\'s internal negative-month encoding', () => {
    const call = () =>
      chart({
        place: 'Beijing', lunarDate: { year: 1900, month: 8, day: 30, isLeapMonth: true },
        clockTime: { hour: 12, minute: 0 }, gender: 'male',
      });
    expect(call).toThrow('leap month 8 of year 1900 only has 29 days');
    expect(call).not.toThrow(/-8\b/);
  });

  /**
   * Finding #3: the same "day 30 of a 29-day leap month" refusal, but for a year
   * (1903) where the leap month's regular twin happens to ALSO be 29 days — so
   * lunar-lite's raw message never even reaches its negative-month branch, and reads
   * "only 29 days in lunar year 1903 month 5" (no leap indication at all, positive
   * month, indistinguishable from an ordinary-month error). Must still be reported as
   * being about the leap month.
   */
  it('rejects day 30 of a leap month whose non-leap twin happens to share its (also too-short) length', () => {
    const call = () =>
      chart({
        place: 'Beijing', lunarDate: { year: 1903, month: 5, day: 30, isLeapMonth: true },
        clockTime: { hour: 12, minute: 0 }, gender: 'male',
      });
    expect(call).toThrow('leap month 5 of year 1903 only has 29 days');
  });

  // spec §9: fixLeap re-anchors a leap month at its 15th day. Day 20 crosses that
  // boundary and must change the chart; day 10 does not and must not.
  it('fixLeap moves the chart for a leap-month day past the 15th, and leaves earlier days alone', () => {
    const base = {
      place: 'Beijing', clockTime: { hour: 12, minute: 0 }, gender: 'male' as const,
    };
    const d20 = { ...base, lunarDate: { year: 2020, month: 4, day: 20, isLeapMonth: true } };
    const d10 = { ...base, lunarDate: { year: 2020, month: 4, day: 10, isLeapMonth: true } };

    expect(chart({ ...d20, fixLeap: false }).soulPalace.branch).toBe('亥');
    expect(chart({ ...d20, fixLeap: true }).soulPalace.branch).toBe('子');
    expect(chart({ ...d20, fixLeap: false }).fiveElementsClass).toBe('土五局');
    expect(chart({ ...d20, fixLeap: true }).fiveElementsClass).toBe('火六局');

    expect(chart({ ...d10, fixLeap: true }).palaces).toEqual(chart({ ...d10, fixLeap: false }).palaces);
    expect(chart({ ...d20, fixLeap: true }).diagnostics.convention.fixLeap).toBe(true);
  });
});

describe('8.2 lunarDateFrame', () => {
  // A birth in Los Angeles whose *Beijing* date differs from its local date: the two
  // frames must resolve to different instants, and therefore potentially different charts.
  it('frame local vs beijing resolve to different instants for the same lunar date', () => {
    const base = {
      timezone: 'America/Los_Angeles', longitude: -122.4443,
      lunarDate: { year: 1990, month: 5, day: 23 }, clockTime: { hour: 20, minute: 0 }, gender: 'male' as const,
    };
    const local = chart({ ...base, lunarDateFrame: 'local' });
    const beijing = chart({ ...base, lunarDateFrame: 'beijing' });

    expect(local.diagnostics.lunar.frame).toBe('local');
    expect(beijing.diagnostics.lunar.frame).toBe('beijing');
    expect(local.diagnostics.utcInstant).not.toBe(beijing.diagnostics.utcInstant);
    // 'local' means the lunar date matches the LOCAL solar date at the birthplace.
    expect(local.diagnostics.lunar.solarDate).toBe('1990-06-15');
    // 'beijing' anchors the same lunar date to the Beijing solar date, so the local
    // wall clock lands on the previous day in LA.
    expect(beijing.diagnostics.lunar.beijingSameDay).toBe('1990-06-15');
  });

  it('defaults to frame "local", and reports "local" for solarDate input regardless', () => {
    const base = {
      timezone: 'America/Los_Angeles', longitude: -122.4443,
      lunarDate: { year: 1990, month: 5, day: 23 }, clockTime: { hour: 20, minute: 0 }, gender: 'male' as const,
    };
    expect(chart(base).diagnostics.utcInstant).toBe(chart({ ...base, lunarDateFrame: 'local' }).diagnostics.utcInstant);

    // lunarDateFrame is meaningless for a solar-date input and must not leak through.
    const solar = chart({
      timezone: 'America/Los_Angeles', longitude: -122.4443,
      solarDate: { year: 1990, month: 6, day: 15 }, clockTime: { hour: 20, minute: 0 },
      lunarDateFrame: 'beijing', gender: 'male',
    });
    expect(solar.diagnostics.lunar.frame).toBe('local');
  });
});

describe('8.2 feed-year selection (probe-findings P2a/P2b)', () => {
  /**
   * The 腊月三十-after-立春 case that a naive `lunarYear ± 1` crashes on.
   *
   * Solar 2024-02-09 is lunar 2023-12-30 (腊月三十) and falls after 立春 2024 (Feb 4),
   * so the year ganzhi is 甲辰 while the lunar year is still 2023. The obvious feed year
   * 2024 has only 29 days in its 腊月, so iztro would throw
   * "only 29 days in lunar year 2024 month 12". The implementation must fall back
   * along the 60-year ganzhi cycle instead.
   */
  it('falls back 60 years when the nearest ganzhi-matching lunar year has too short a 腊月', () => {
    const res = chart({
      solarDate: { year: 2024, month: 2, day: 9 }, clockTime: { hour: 12, minute: 0 },
      timezone: 'Asia/Shanghai', longitude: 120, gender: 'male',
    });

    expect(res.lunar).toMatchObject({ year: 2023, month: 12, day: 30 });
    expect(res.diagnostics.yearGanZhi).toBe('甲辰');
    expect(res.diagnostics.feedYear).toBe(1964);
    expect(res.diagnostics.feedYear).not.toBe(2024); // the naive choice, which crashes
    expect(ganZhiOfLunarYear(res.diagnostics.feedYear)).toBe(res.diagnostics.yearGanZhi);
    expect(res.palaces).toHaveLength(12);
  });

  it('lunarYearForGanZhi returns the nearest match when it is long enough, and shifts by 60 when not', () => {
    // 腊月 of 2024 is 29 days -> must skip to 1964 (or 2084).
    expect(lunarYearForGanZhi('甲辰', 2023, 12, 30, false)).toBe(1964);
    // Day 29 fits in 2024's 腊月, so no cycle shift is needed.
    expect(lunarYearForGanZhi('甲辰', 2023, 12, 29, false)).toBe(2024);
    // No shift at all when the caller's own lunar year already carries the ganzhi.
    expect(lunarYearForGanZhi('癸卯', 2023, 12, 30, false)).toBe(2023);
  });

  /**
   * probe-findings P2c scanned 1800-2100 and found zero years where 正月 or 腊月 is
   * itself a leap month, so no real birth date can reach this guard — which is exactly
   * why a direct unit call is the only way to cover it. The guard refuses rather than
   * guessing on a path that was never empirically validated; a silent chart here would
   * be indistinguishable from a correct one.
   */
  it('refuses to shift the feed year when the shifted month would itself be a leap month', () => {
    expect(() => lunarYearForGanZhi('甲辰', 2023, 12, 30, true)).toThrow('feed-year shift window');
  });

  it('yearDivide:"lunar_new_year" keeps the same birth inside its own lunar year', () => {
    const res = chart({
      solarDate: { year: 2024, month: 2, day: 9 }, clockTime: { hour: 12, minute: 0 },
      timezone: 'Asia/Shanghai', longitude: 120, gender: 'male', yearDivide: 'lunar_new_year',
    });
    expect(res.diagnostics.yearGanZhi).toBe('癸卯');
    expect(res.diagnostics.feedYear).toBe(2023);
    expect(res.diagnostics.yearDivideApplied).toBe('lunar_new_year');
    expect(ganZhiOfLunarYear(2023)).toBe('癸卯');
  });
});

describe('8.2 Input validation matrix', () => {
  const validBase = {
    place: 'Beijing',
    solarDate: { year: 2000, month: 1, day: 1 },
    clockTime: { hour: 12, minute: 0 },
    gender: 'male' as const,
  };

  it('accepts the valid baseline', () => {
    expect(ZiweiInputSchema.safeParse(validBase).success).toBe(true);
  });

  it('rejects unknown and misspelled keys (.strict), including nested ones', () => {
    for (const bad of [
      { ...validBase, foo: 'bar' },
      { ...validBase, trueSolarTime: false },   // misspelling of trueSolar
      { ...validBase, yearDivides: 'lichun' },  // misspelling of yearDivide
      { ...validBase, latitude: 39.9 },         // deliberately not part of the contract
      { ...validBase, sect: 1 },                // a bazi-mcp field that does not exist here
      { ...validBase, solarDate: { year: 2000, month: 1, day: 1, extra: 123 } },
      { ...validBase, clockTime: { hour: 12, minute: 0, second: 30 } },
    ]) {
      expect(ZiweiInputSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('enforces the 1900-2100 year bounds identically for solar and lunar dates', () => {
    const solar = (year: number) => ZiweiInputSchema.safeParse({ ...validBase, solarDate: { year, month: 1, day: 1 } }).success;
    expect(solar(1899)).toBe(false);
    expect(solar(1900)).toBe(true);
    expect(solar(2100)).toBe(true);
    expect(solar(2101)).toBe(false);

    const lunar = (year: number) =>
      ZiweiInputSchema.safeParse({ place: 'Beijing', lunarDate: { year, month: 1, day: 1 }, clockTime: { hour: 12, minute: 0 }, gender: 'male' }).success;
    expect(lunar(1899)).toBe(false);
    expect(lunar(1900)).toBe(true);
    expect(lunar(2100)).toBe(true);
    expect(lunar(2101)).toBe(false);
  });

  /**
   * Finding #1 (spec §6): a schema-valid solarDate year (2100 is inside the
   * schema's own 1900-2100) can still project past 2100 once converted to the
   * Beijing-time (UTC+8) instant used for year-ganzhi determination (Axis A), for a
   * birth late enough in the year in a timezone west of China. Before the fix, this
   * surfaced @openfate/bazi-engine's own raw message ("year must be an integer
   * between 1800 and 2100") — a different range and wording than what the schema
   * told the caller. It must now use this service's own range/wording (spec §6:
   * "两层校验用同一个范围、同一套文案"), and must not leak the upstream "1800" bound at all.
   */
  it('reports the Beijing-year-projection overflow with this service\'s own range and wording, not the upstream engine\'s', () => {
    const call = () =>
      chart({
        timezone: 'America/Los_Angeles', longitude: -122.4443,
        solarDate: { year: 2100, month: 12, day: 31 }, clockTime: { hour: 20, minute: 0 }, gender: 'male',
      });
    expect(call).toThrow('Beijing-time (UTC+8) year');
    expect(call).toThrow('must be between 1900 and 2100');
    expect(call).not.toThrow(/\b1800\b/);
  });

  /**
   * Finding #5: `place`/`timezone`/`lookup_location`'s `query` accept arbitrary-length
   * strings today. A multi-megabyte `place` costs several seconds of CPU in the
   * 7,329-city linear scan (geo/resolver.ts) and blocks the single-threaded stdio
   * server for every other in-flight request. Reject oversized input at the schema
   * layer, before it ever reaches that scan.
   */
  it('rejects oversized place/timezone/query strings before they reach the city scan', () => {
    const long = (n: number) => 'a'.repeat(n);
    expect(ZiweiInputSchema.safeParse({ ...validBase, place: long(5_000_000) }).success).toBe(false);
    expect(ZiweiInputSchema.safeParse({ ...validBase, place: undefined, longitude: -122.44, timezone: long(1000) }).success).toBe(false);
    // Well within bounds must still work.
    expect(ZiweiInputSchema.safeParse({ ...validBase, place: 'Tacoma, WA' }).success).toBe(true);
  });

  it('rejects out-of-range date and time components', () => {
    for (const bad of [
      { ...validBase, solarDate: { year: 2000, month: 13, day: 1 } },
      { ...validBase, solarDate: { year: 2000, month: 0, day: 1 } },
      { ...validBase, solarDate: { year: 2000, month: 1, day: 32 } },
      { ...validBase, solarDate: { year: 2000, month: 1, day: 1.5 } },
      { ...validBase, clockTime: { hour: 24, minute: 0 } },
      { ...validBase, clockTime: { hour: 12, minute: 60 } },
      { place: 'Beijing', lunarDate: { year: 2000, month: 1, day: 31 }, clockTime: { hour: 12, minute: 0 }, gender: 'male' },
      { ...validBase, longitude: 181 },
      { ...validBase, shichen: '子丑' },
      { ...validBase, gender: 'other' },
      { ...validBase, dstFold: 2 },
    ]) {
      expect(ZiweiInputSchema.safeParse(bad).success).toBe(false);
    }
  });

  /**
   * An impossible Gregorian date is a DISTINCT error from a DST gap: the two look
   * similar (both are "that wall clock never existed") but mean completely different
   * things to the caller, so the messages must not be interchangeable.
   */
  it('reports an invalid Gregorian date distinctly from a DST-gap error', () => {
    const invalidDate = () =>
      chart({ place: 'Beijing', solarDate: { year: 1999, month: 2, day: 29 }, clockTime: { hour: 12, minute: 0 }, gender: 'male' });
    expect(invalidDate).toThrow('Invalid solar calendar date: 1999-02-29 does not exist');
    expect(invalidDate).not.toThrow('spring-forward gap');

    expect(() =>
      chart({ place: 'Beijing', solarDate: { year: 1998, month: 2, day: 30 }, clockTime: { hour: 12, minute: 0 }, gender: 'male' })
    ).toThrow('Invalid solar calendar date: 1998-02-30 does not exist');

    const dstGap = () =>
      chart({
        timezone: 'America/Los_Angeles', longitude: -122.4443,
        solarDate: { year: 1990, month: 4, day: 1 }, clockTime: { hour: 2, minute: 30 }, gender: 'male',
      });
    expect(dstGap).toThrow('DST spring-forward gap');
    expect(dstGap).not.toThrow('Invalid solar calendar date');
  });

  it('rejects mutually exclusive date and time combinations', () => {
    expect(ZiweiInputSchema.safeParse({
      ...validBase, lunarDate: { year: 2000, month: 1, day: 1 },
    }).success).toBe(false);

    expect(ZiweiInputSchema.safeParse({ ...validBase, shichen: '午' }).success).toBe(false);

    // Neither date at all.
    expect(ZiweiInputSchema.safeParse({ place: 'Beijing', clockTime: { hour: 12, minute: 0 }, gender: 'male' }).success).toBe(false);
    // Neither time at all.
    expect(ZiweiInputSchema.safeParse({ place: 'Beijing', solarDate: { year: 2000, month: 1, day: 1 }, gender: 'male' }).success).toBe(false);
    // No location at all.
    expect(ZiweiInputSchema.safeParse({ solarDate: { year: 2000, month: 1, day: 1 }, clockTime: { hour: 12, minute: 0 }, gender: 'male' }).success).toBe(false);
    // Longitude without timezone: inferring a timezone from longitude is forbidden.
    expect(ZiweiInputSchema.safeParse({ ...validBase, place: undefined, longitude: 116.4 }).success).toBe(false);
    // gender is required.
    expect(ZiweiInputSchema.safeParse({ place: 'Beijing', solarDate: { year: 2000, month: 1, day: 1 }, clockTime: { hour: 12, minute: 0 } }).success).toBe(false);
  });

  /**
   * spec §6: Zi Wei Dou Shu has no "unknown birth time" mode — 命宫/身宫/昌曲/火铃/空劫
   * all depend on the hour, so there is no meaningful partial chart. `timeUnknown` is a
   * real bazi-mcp field, so a caller migrating between the two will hit this; the
   * rejection must explain *why*, not just say "unrecognized key".
   */
  it('rejects timeUnknown with an explanation rather than a bare strict-mode error', () => {
    expect(() => parseZiweiInput({ place: 'Beijing', solarDate: { year: 2000, month: 1, day: 1 }, timeUnknown: true, gender: 'male' }))
      .toThrow('timeUnknown is not supported for Zi Wei Dou Shu charts');

    // The schema itself also refuses it (unknown key), so neither path can slip through.
    expect(ZiweiInputSchema.safeParse({ ...validBase, timeUnknown: true }).success).toBe(false);
    // ...and there is no partial-chart escape hatch: omitting the time is refused too.
    // (zod stringifies its issues, so match the unescaped fragment of the message.)
    const noTime = ZiweiInputSchema.safeParse({ place: 'Beijing', solarDate: { year: 2000, month: 1, day: 1 }, gender: 'male' });
    expect(noTime.success).toBe(false);
    expect(noTime.error!.issues.map(i => i.message).join(' ')).toContain('unknown birth time');
  });
});

describe('8.2 Location resolution and `place` conflicts', () => {
  it('resolves an unambiguous city, and refuses to guess an ambiguous one', () => {
    expect(lookupCity('Guangzhou')[0].timezone).toBe('Asia/Shanghai');
    expect(lookupCity('Tacoma')[0].timezone).toBe('America/Los_Angeles');

    expect(() => resolveLocation({ place: 'NonExistentCity999' })).toThrow('Could not recognize birth place');
    // "Los Angeles" matches both the US and the Chilean city; guessing would be worse
    // than failing, so the resolver lists candidates instead.
    expect(() => resolveLocation({ place: 'Los Angeles' })).toThrow('matched multiple candidate cities');
    expect(() => resolveLocation({ place: 'San Jose' })).toThrow('matched multiple candidate cities');
  });

  it('keeps same-name cities as distinct candidates instead of collapsing them', () => {
    const springfields = lookupCity('Springfield');
    expect(springfields.length).toBeGreaterThan(1);
  });

  it('reports locationSource truthfully across every place/longitude/timezone combination', () => {
    const dt = { solarDate: { year: 2000, month: 1, day: 1 }, clockTime: { hour: 12, minute: 0 }, gender: 'male' } as const;

    // place alone -> resolved
    expect(chart({ place: 'Beijing', ...dt }).diagnostics.locationSource).toBe('resolved');

    // explicit longitude + timezone -> caller_supplied
    expect(chart({ longitude: 116.4074, timezone: 'Asia/Shanghai', ...dt }).diagnostics.locationSource).toBe('caller_supplied');

    // place + BOTH explicit -> caller_supplied, with a warning that place was ignored
    const both = chart({ place: 'Beijing', longitude: -118.24, timezone: 'America/Los_Angeles', ...dt });
    expect(both.diagnostics.locationSource).toBe('caller_supplied');
    expect(both.diagnostics.warnings.some(w => w.includes('explicit coordinates'))).toBe(true);

    // place + timezone override only -> mixed
    const mixed = chart({ place: 'Beijing', timezone: 'Asia/Tokyo', ...dt });
    expect(mixed.diagnostics.locationSource).toBe('mixed');
    expect(mixed.diagnostics.warnings.some(w => w.includes('custom timezone'))).toBe(true);

    // place + longitude but NO timezone -> rejected, never silently half-applied
    expect(() => chart({ place: 'Beijing', longitude: -122.44, ...dt })).toThrow('Inconsistent location input');
  });

  it('warns when the longitude correction exceeds the +/-240 minute physical sanity bound', () => {
    const res = chart({
      longitude: -122.44, timezone: 'Asia/Shanghai',
      solarDate: { year: 2000, month: 1, day: 1 }, clockTime: { hour: 12, minute: 0 }, gender: 'male',
    });
    expect(res.diagnostics.warnings.some(w => w.includes('Astronomical sanity warning'))).toBe(true);
    expect(Math.abs(res.diagnostics.longitudeCorrectionMinutes)).toBeGreaterThan(240);
  });
});

describe('8.2 shichen input and its ambiguity reporting', () => {
  /**
   * A shichen is a ~2h claim and the correction is tens of minutes, so straddling a
   * boundary is the normal case, not an exotic one. The contract is that the service
   * says so rather than returning a falsely confident single chart.
   */
  it('flags candidate timeIndexes when the shichen window straddles a boundary', () => {
    const res = chart({ place: 'Urumqi', solarDate: { year: 1990, month: 6, day: 15 }, shichen: '未', gender: 'male' });
    expect(res.diagnostics.shichenAmbiguity?.isAmbiguous).toBe(true);
    expect(res.diagnostics.shichenAmbiguity!.candidateTimeIndexes.length).toBeGreaterThan(1);
    expect(res.diagnostics.shichenAmbiguity!.candidateTimeIndexes).toEqual([5, 6]);
    expect(res.diagnostics.shichenAmbiguity!.candidateTimeIndexes).toContain(res.lunar.timeIndex);
    expect(res.diagnostics.warnings.some(w => w.includes('straddles a shichen boundary'))).toBe(true);
  });

  it('reports 早子时/晚子时 as distinct candidates for shichen 子 (timeIndex 0 vs 12)', () => {
    const res = chart({ place: 'Beijing', solarDate: { year: 2000, month: 8, day: 16 }, shichen: '子', gender: 'male' });
    const candidates = res.diagnostics.shichenAmbiguity!.candidateTimeIndexes;
    expect(candidates).toContain(0);
    expect(candidates).toContain(12);
    expect(res.diagnostics.warnings.some(w => w.includes('早子时') || w.includes('late-Zi'))).toBe(true);
  });

  it('uses the shichen midpoint for the chart it does return', () => {
    const viaShichen = chart({ place: 'Beijing', solarDate: { year: 1998, month: 7, day: 31 }, shichen: '未', gender: 'male' });
    const viaClock = chart({ place: 'Beijing', solarDate: { year: 1998, month: 7, day: 31 }, clockTime: { hour: 14, minute: 0 }, gender: 'male' });
    expect(viaShichen.palaces).toEqual(viaClock.palaces);
    expect(viaShichen.lunar).toEqual(viaClock.lunar);
  });
});

/**
 * Finding #7 / spec §9 / §12: `mutagens` and `brightness` are 透传 (passthrough)
 * school/convention overrides, plumbed straight through to iztro's own
 * `config.mutagens` / `config.brightness` with no per-school presets.
 *
 * Delta security review findings F1/F2/F3 (see src/core/chart.ts's
 * resetIztroMutagensAndBrightness and src/schemas/input.ts's StarNameEnum):
 * F1 - iztro merges these two keys into module-level globals that persist across
 *      calls; a request carrying overrides must not affect any LATER request.
 * F2 - `brightness`'s key count was unbounded (a 50k-key payload cost 17.2s of
 *      CPU inside iztro's config() and blocked the single-threaded server).
 * F3 - override star names were shape-checked but not enumerated, so a typo'd
 *      name was silently accepted and (via F1) silently degraded every later
 *      chart's 四化/brightness table too.
 */
describe('spec §9 mutagens/brightness passthrough', () => {
  const base = { place: 'Beijing', solarDate: { year: 2000, month: 8, day: 16 }, clockTime: { hour: 4, minute: 0 }, gender: 'male' as const };

  it('overrides a star\'s brightness at every palace it appears in, without leaking into a later plain request', () => {
    const plain = chart(base);
    const plainZiwei = plain.palaces.flatMap(p => p.majorStars).find(s => s.name === '紫微')!;
    expect(plainZiwei.brightness).toBe('庙'); // this birth's default, per iztro's built-in table

    const overridden = chart({
      ...base,
      brightness: { '紫微': ['陷', '陷', '陷', '陷', '陷', '陷', '陷', '陷', '陷', '陷', '陷', '陷'] },
    });
    const overriddenZiwei = overridden.palaces.flatMap(p => p.majorStars).find(s => s.name === '紫微')!;
    expect(overriddenZiwei.brightness).toBe('陷');
    // Nothing else about the chart should move — only the requested star's brightness.
    expect(overridden.soulPalace).toEqual(plain.soulPalace);
    expect(overridden.palaces.map(p => p.majorStars.map(s => s.name))).toEqual(plain.palaces.map(p => p.majorStars.map(s => s.name)));

    // F1: a THIRD, plain call after the override must reproduce the FIRST plain call
    // exactly — this is what the old test structure could never catch, since it only
    // ever computed "plain" once, before any override had run.
    const plainAgain = chart(base);
    expect(plainAgain).toEqual(plain);
  });

  it('overrides which star carries a stem\'s mutagen, without leaking into a later plain request', () => {
    const plain = chart(base);
    const yearStem = plain.diagnostics.yearGanZhi[0];
    expect(plain.palaces.flatMap(p => [...p.majorStars, ...p.minorStars]).find(s => s.name === '太阴')?.mutagen).not.toBe('禄');

    const overridden = chart({ ...base, mutagens: { [yearStem]: ['太阴', '太阴', '太阴', '太阴'] } });
    const taiyin = overridden.palaces.flatMap(p => [...p.majorStars, ...p.minorStars]).find(s => s.name === '太阴')!;
    expect(taiyin.mutagen).toBe('禄');

    // F1: same as above, for mutagens.
    const plainAgain = chart(base);
    expect(plainAgain).toEqual(plain);
  });

  it('F1: overrides from one call never leak into ANY later call, plain or overridden differently', () => {
    // This is the review's exact repro shape: plain, then an override call (garbage
    // mutagens included, matching the report's repro), then the SAME plain chart
    // again — first and third must be byte-identical. Before the fix, the garbage
    // mutagens entry ('aaaa' etc.) would have failed schema validation (F3 closes
    // that hole too), so this also exercises the brightness leak path with a
    // schema-valid-but-nonstandard override, and a second unrelated override in
    // between to prove state doesn't accumulate across multiple contaminating calls.
    const plain1 = chart(base);

    chart({ ...base, brightness: { '紫微': Array(12).fill('陷') as ('庙'|'旺'|'得'|'利'|'平'|'不'|'陷'|'')[] } });
    chart({ ...base, mutagens: { '甲': ['太阴', '太阴', '太阴', '太阴'] } });

    const plain2 = chart(base);
    expect(plain2).toEqual(plain1);
  });

  it('rejects malformed override shapes', () => {
    // mutagens: wrong array length (must be exactly 4, [禄,权,科,忌]).
    expect(ZiweiInputSchema.safeParse({ ...base, mutagens: { '甲': ['廉贞', '破军'] } }).success).toBe(false);
    // mutagens: not a real heavenly stem.
    expect(ZiweiInputSchema.safeParse({ ...base, mutagens: { 'X': ['廉贞', '破军', '武曲', '太阳'] } }).success).toBe(false);
    // brightness: wrong array length (must be exactly 12, one per palace).
    expect(ZiweiInputSchema.safeParse({ ...base, brightness: { '紫微': ['庙', '旺'] } }).success).toBe(false);
    // brightness: not a real brightness grade.
    expect(ZiweiInputSchema.safeParse({ ...base, brightness: { '紫微': Array(12).fill('X') } }).success).toBe(false);
  });

  it('F3: rejects star names that are not real iztro stars, instead of silently no-opping', () => {
    // Exactly the review's repro: a typo'd/garbage star name in a mutagens override.
    expect(ZiweiInputSchema.safeParse({ ...base, mutagens: { '甲': ['aaaa', 'bbbb', 'cccc', 'dddd'] } }).success).toBe(false);
    // Same for brightness's key.
    expect(ZiweiInputSchema.safeParse({ ...base, brightness: { '不是星': Array(12).fill('庙') } }).success).toBe(false);
    // A single garbage entry among otherwise-real star names is still rejected.
    expect(ZiweiInputSchema.safeParse({ ...base, mutagens: { '甲': ['廉贞', '破军', '武曲', 'not-a-star'] } }).success).toBe(false);
  });

  it('F3 papercut: a bad star name gets a short, targeted message instead of zod\'s 162-name enum dump', () => {
    // Zod's default invalid_enum_value message inlines every option in the enum, once
    // per failing entry. With 162 star names that message alone runs to ~1.2KB, and a
    // 4-entry mutagens override (4 issues) used to balloon to ~4.7KB total — a bad
    // trade for an LLM caller that just needs to self-correct a typo. StarNameEnum's
    // custom errorMap (src/schemas/input.ts) must keep every such message short and
    // must name the value that was actually rejected.
    const typoResult = ZiweiInputSchema.safeParse({
      ...base,
      mutagens: { '甲': ['aaaa', 'bbbb', 'cccc', 'dddd'] },
    });
    expect(typoResult.success).toBe(false);
    if (!typoResult.success) {
      for (const issue of typoResult.error.issues) {
        expect(issue.message.length).toBeLessThan(200);
        expect(issue.message).not.toContain('紫微'); // no leaked full enum list
      }
      const totalChars = typoResult.error.issues.map(i => i.message).join('; ').length;
      expect(totalChars).toBeLessThan(400); // was ~4,686 before the fix
    }

    // A long garbage value (not just a short typo) must not blow the message back up —
    // the received value itself is echoed, so it needs its own cap independent of the
    // enum-list suppression above.
    const longGarbage = 'x'.repeat(10_000);
    const longGarbageResult = ZiweiInputSchema.safeParse({
      ...base,
      mutagens: { '甲': [longGarbage, '破军', '武曲', '太阳'] },
    });
    expect(longGarbageResult.success).toBe(false);
    if (!longGarbageResult.success) {
      expect(longGarbageResult.error.issues[0].message.length).toBeLessThan(200);
    }

    // Near-miss (zh-TW/typo variant) gets a "did you mean" pointing at the real name.
    const nearMissResult = ZiweiInputSchema.safeParse({
      ...base,
      brightness: { '紫薇': Array(12).fill('庙') }, // 薇 vs the real 微
    });
    expect(nearMissResult.success).toBe(false);
    if (!nearMissResult.success) {
      const message = nearMissResult.error.issues[0].message;
      expect(message.length).toBeLessThan(200);
      expect(message).toContain('紫薇'); // names the offending value
      expect(message).toContain('紫微'); // suggests the real star name
    }
  });

  it('F2: caps brightness override key count at iztro\'s real star count and rejects an oversized payload fast', () => {
    // The review's repro: a schema-valid-shaped but huge record (~50k keys) that
    // used to cost 17.2s of CPU inside iztro's config(). Since brightness keys are
    // now validated against the closed, ~162-entry star-name enum (see
    // src/schemas/input.ts's StarNameEnum), an object with 50k distinct fake keys
    // fails on the FIRST unrecognized key and never reaches iztro at all.
    const huge: Record<string, string[]> = {};
    for (let i = 0; i < 50_000; i++) huge[`fakeStar${i}`] = Array(12).fill('庙');

    const start = performance.now();
    const result = ZiweiInputSchema.safeParse({ ...base, brightness: huge });
    const elapsedMs = performance.now() - start;

    expect(result.success).toBe(false);
    // Generous ceiling: was 17.2s pre-fix; a closed-enum key check should be
    // milliseconds. 1s leaves headroom for slow CI without being a no-op check.
    expect(elapsedMs).toBeLessThan(1000);
  });

  it('F2: a real star name can only appear once, so a valid brightness override can never exceed iztro\'s real star count', () => {
    // A JS object literal can't hold duplicate keys, and every key must now be a
    // member of the closed real-star enum — so the max number of distinct,
    // schema-valid brightness keys is bounded by iztro's own star count (162),
    // "the low hundreds" the review called generous, without any separate
    // max-keys check to maintain.
    const allStarNames = Object.values(starZhCN);
    expect(allStarNames.length).toBeLessThan(300); // sanity: "low hundreds", not tens of thousands

    const allValid: Record<string, string[]> = {};
    for (const name of allStarNames) allValid[name] = Array(12).fill('庙');
    expect(ZiweiInputSchema.safeParse({ ...base, brightness: allValid }).success).toBe(true);

    // Adding one more distinct key that isn't a real star name still fails, proving
    // the cap is enforced by membership, not merely by a count that could be
    // bypassed with more real names than actually exist.
    expect(ZiweiInputSchema.safeParse({ ...base, brightness: { ...allValid, 'nope': Array(12).fill('庙') } }).success).toBe(false);
  });
});
