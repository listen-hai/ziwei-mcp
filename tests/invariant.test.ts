import { describe, it, expect } from 'bun:test';
import { calculateZiweiChart } from '../src/core/chart';
import { ZiweiInputSchema } from '../src/schemas/input';
import type { ZiweiInput, ValidatedZiweiInput, ZiweiCalculationResult } from '../src/types';
import { G, M, idx, soulPalace, bodyPalace, palaceStem, fiveClass, ziweiPalace, PALACE_NAMES, FIVE_CLASS_LABEL, findStarTrimmed } from './ziwei-rules';

const chart = (input: ZiweiInput) => calculateZiweiChart(ZiweiInputSchema.parse(input) as ValidatedZiweiInput);

/** Everything except diagnostics — the part that must be identical for identical astrology. */
const chartBody = (r: ZiweiCalculationResult) => ({
  soulPalace: r.soulPalace, bodyPalace: r.bodyPalace, soul: r.soul, body: r.body,
  fiveElementsClass: r.fiveElementsClass, palaces: r.palaces, lunar: r.lunar,
});

describe('8.3 Z1 defence: year ganzhi depends on the UTC instant, never on the calendar date', () => {
  /**
   * The single most important invariant in the project. iztro's own
   * `yearDivide:'exact'` divides the year by calendar DATE, so the same physical
   * instant expressed in two timezones that disagree about the date gets two
   * different year ganzhi — and with it different 宫干, 四化, all year-series stars
   * and 大限干支, i.e. a completely different chart for one person.
   *
   * Here the same instant (2024-02-04T16:00:00Z) is entered as four different
   * wall clocks on two different calendar days.
   */
  it('the same UTC instant expressed via four timezones yields one identical year ganzhi', () => {
    const cases = [
      { name: 'Los Angeles', solarDate: { year: 2024, month: 2, day: 4 }, clockTime: { hour: 8, minute: 0 }, timezone: 'America/Los_Angeles', longitude: -122.4443 },
      { name: 'Beijing', solarDate: { year: 2024, month: 2, day: 5 }, clockTime: { hour: 0, minute: 0 }, timezone: 'Asia/Shanghai', longitude: 116.4074 },
      { name: 'London', solarDate: { year: 2024, month: 2, day: 4 }, clockTime: { hour: 16, minute: 0 }, timezone: 'Europe/London', longitude: -0.1276 },
      { name: 'Tokyo', solarDate: { year: 2024, month: 2, day: 5 }, clockTime: { hour: 1, minute: 0 }, timezone: 'Asia/Tokyo', longitude: 139.6917 },
    ] as const;

    for (const { name, ...input } of cases) {
      const res = chart({ ...input, gender: 'male' });
      expect(res.diagnostics.utcInstant, name).toBe('2024-02-04T16:00:00.000Z');
      // 立春 2024 = 2024-02-04 08:26:56 UTC, so every one of these is after it.
      expect(res.diagnostics.yearGanZhi, name).toBe('甲辰');
    }
  });

  /**
   * The sharpest Z1 test: 立春 2025 falls at 22:10 Beijing time on 2025-02-03. Under
   * iztro's date-only rule, every timeIndex on that day would report 乙巳 — 22 hours
   * early. Scanning all 24 hours, the ganzhi must flip exactly ONCE, and at 22:10.
   */
  it('scanning a 立春 day hour by hour, the year ganzhi flips exactly once, at the true 立春 instant', () => {
    const seen: Array<{ hour: number; ganZhi: string }> = [];
    for (let hour = 0; hour < 24; hour++) {
      const res = chart({
        solarDate: { year: 2025, month: 2, day: 3 }, clockTime: { hour, minute: 30 },
        timezone: 'Asia/Shanghai', longitude: 120, trueSolar: false, gender: 'male',
      });
      seen.push({ hour, ganZhi: res.diagnostics.yearGanZhi });
    }

    const flips = seen.filter((s, i) => i > 0 && s.ganZhi !== seen[i - 1].ganZhi);
    expect(flips).toHaveLength(1);
    expect(seen[0].ganZhi).toBe('甲辰');
    expect(seen[23].ganZhi).toBe('乙巳');
    // 立春 2025 = 2025-02-03 22:10:13 CST, so 21:30 is still 甲辰 and 22:30 is 乙巳.
    expect(flips[0].hour).toBe(22);

    // ...and to the minute: 22:05 vs 22:15 straddles it.
    const at = (hour: number, minute: number) => chart({
      solarDate: { year: 2025, month: 2, day: 3 }, clockTime: { hour, minute },
      timezone: 'Asia/Shanghai', longitude: 120, trueSolar: false, gender: 'male',
    });
    expect(at(22, 5).diagnostics.yearGanZhi).toBe('甲辰');
    expect(at(22, 15).diagnostics.yearGanZhi).toBe('乙巳');

    // Ten minutes must move the WHOLE chart, not just a label: 宫干, 五行局 and
    // 紫微 all key off the year ganzhi.
    expect(at(22, 5).soulPalace.stem).toBe('丁');
    expect(at(22, 15).soulPalace.stem).toBe('己');
    expect(at(22, 5).fiveElementsClass).toBe('火六局');
    expect(at(22, 15).fiveElementsClass).toBe('土五局');
    expect(at(22, 5).diagnostics.feedYear).toBe(2024);
    expect(at(22, 15).diagnostics.feedYear).toBe(2025);
  });

  it('the same 立春-day scan on a second year (2021, 立春 22:59) also flips exactly once', () => {
    const seen = Array.from({ length: 24 }, (_, hour) =>
      chart({
        solarDate: { year: 2021, month: 2, day: 3 }, clockTime: { hour, minute: 30 },
        timezone: 'Asia/Shanghai', longitude: 120, trueSolar: false, gender: 'male',
      }).diagnostics.yearGanZhi
    );
    const flips = seen.filter((g, i) => i > 0 && g !== seen[i - 1]);
    expect(flips).toHaveLength(1);
    expect(seen[0]).toBe('庚子');
    expect(seen[23]).toBe('辛丑');
    expect(seen.indexOf('辛丑')).toBe(23); // 22:59 is after 22:30, so only 23:30 has flipped
  });
});

describe('8.3 Axis B: identical local true solar time yields an identical chart', () => {
  /**
   * Six timezones, each at its own standard meridian, all at 12:00 local. They are six
   * *different* UTC instants, but the same local true solar time — which is what the
   * lunar date, the timeIndex and every palace placement are actually a function of.
   * Includes the two fractional-offset zones (+5:30, +5:45), which is where an
   * offset-rounding regression would show up first.
   */
  const meridianZones: Array<[string, number]> = [
    ['Asia/Shanghai', 120],
    ['Asia/Tokyo', 135],
    ['Asia/Kolkata', 82.5],
    ['Asia/Kathmandu', 86.25],
    ['Asia/Dubai', 60],
    ['Asia/Bangkok', 105],
  ];

  it('produces byte-identical charts across six timezones at the same local true solar time', () => {
    const ref = chart({
      timezone: 'Asia/Shanghai', longitude: 120,
      solarDate: { year: 2000, month: 8, day: 16 }, clockTime: { hour: 12, minute: 0 }, gender: 'male',
    });
    expect(ref.diagnostics.axisB_localTrueSolarTime).toBe('2000-08-16 11:55');

    const instants = new Set<string>();
    for (const [timezone, longitude] of meridianZones) {
      const res = chart({
        timezone, longitude,
        solarDate: { year: 2000, month: 8, day: 16 }, clockTime: { hour: 12, minute: 0 }, gender: 'male',
      });
      instants.add(res.diagnostics.utcInstant);
      expect(res.diagnostics.axisB_localTrueSolarTime, timezone).toBe(ref.diagnostics.axisB_localTrueSolarTime);
      expect(res.lunar, timezone).toEqual(ref.lunar);
      expect(chartBody(res), timezone).toEqual(chartBody(ref));
    }
    // Sanity: these really were different physical instants, not the same one six times.
    expect(instants.size).toBe(meridianZones.length);
  });
});

describe('8.3 timeIndex 0 (早子时) vs 12 (晚子时)', () => {
  const base = {
    timezone: 'Asia/Shanghai', longitude: 120, solarDate: { year: 2000, month: 8, day: 16 },
    trueSolar: false, gender: 'male' as const,
  };

  it('dayDivide:"current" — the two are the same chart, differing only in timeIndex', () => {
    const early = chart({ ...base, clockTime: { hour: 0, minute: 30 }, dayDivide: 'current' });
    const late = chart({ ...base, clockTime: { hour: 23, minute: 30 }, dayDivide: 'current' });

    expect(early.lunar.timeIndex).toBe(0);
    expect(late.lunar.timeIndex).toBe(12);
    expect(early.lunar.shichen).toBe('子');
    expect(late.lunar.shichen).toBe('子');

    // Strip only timeIndex: this project's trimmed output has no time/timeRange labels
    // (those are iztro-internal), so timeIndex is the sole legitimate difference.
    const { timeIndex: _e, ...earlyLunar } = early.lunar;
    const { timeIndex: _l, ...lateLunar } = late.lunar;
    expect(lateLunar).toEqual(earlyLunar);
    expect(late.palaces).toEqual(early.palaces);
    expect(late.soulPalace).toEqual(early.soulPalace);
    expect(late.bodyPalace).toEqual(early.bodyPalace);
    expect(late.fiveElementsClass).toBe(early.fiveElementsClass);
  });

  it('dayDivide:"forward" — 紫微 must actually move for the late-Zi hour', () => {
    const early = chart({ ...base, clockTime: { hour: 0, minute: 30 }, dayDivide: 'forward' });
    const late = chart({ ...base, clockTime: { hour: 23, minute: 30 }, dayDivide: 'forward' });

    expect(early.lunar.timeIndex).toBe(0);
    expect(late.lunar.timeIndex).toBe(12);
    expect(findStarTrimmed(early, '紫微')).toBe(idx('酉'));
    expect(findStarTrimmed(late, '紫微')).toBe(idx('戌'));
    expect(findStarTrimmed(late, '紫微')).not.toBe(findStarTrimmed(early, '紫微'));

    // And 'forward' must differ from 'current' for exactly the late-Zi hour, not the early one.
    const lateCurrent = chart({ ...base, clockTime: { hour: 23, minute: 30 }, dayDivide: 'current' });
    expect(findStarTrimmed(lateCurrent, '紫微')).toBe(idx('酉'));
    const earlyCurrent = chart({ ...base, clockTime: { hour: 0, minute: 30 }, dayDivide: 'current' });
    expect(early.palaces).toEqual(earlyCurrent.palaces);
  });
});

describe('8.3 Structural invariants of the twelve palaces', () => {
  const samples: ZiweiInput[] = [
    { place: 'Beijing', solarDate: { year: 2000, month: 8, day: 16 }, clockTime: { hour: 4, minute: 0 }, gender: 'male' },
    { timezone: 'America/Los_Angeles', longitude: -122.4443, solarDate: { year: 1990, month: 6, day: 15 }, clockTime: { hour: 20, minute: 0 }, gender: 'female' },
    { timezone: 'Asia/Shanghai', longitude: 87.6168, solarDate: { year: 1990, month: 6, day: 15 }, clockTime: { hour: 8, minute: 0 }, gender: 'male' },
    { timezone: 'Europe/London', longitude: -0.1276, solarDate: { year: 1955, month: 2, day: 24 }, clockTime: { hour: 19, minute: 15 }, gender: 'female' },
    { timezone: 'Australia/Sydney', longitude: 151.2093, solarDate: { year: 2024, month: 1, day: 10 }, clockTime: { hour: 15, minute: 0 }, gender: 'male' },
  ];

  it('十二宫名 run counterclockwise from 命宫 by earthly branch, with no gaps or repeats', () => {
    for (const input of samples) {
      const res = chart(input);
      const sp = idx(res.soulPalace.branch);

      expect(res.palaces).toHaveLength(12);
      expect(new Set(res.palaces.map(p => p.branch)).size).toBe(12);
      expect(new Set(res.palaces.map(p => p.name)).size).toBe(12);

      for (const p of res.palaces) {
        // Direction matters: (命宫 - 本宫) mod 12, NOT the inverse — the inverse still
        // "looks right" and agrees on exactly 2 of the 12 palaces.
        expect(p.name, `${JSON.stringify(input.solarDate)} @${p.branch}`).toBe(PALACE_NAMES[M(sp - idx(p.branch))]);
      }
      expect(res.palaces.find(p => p.name === '命宫')!.branch).toBe(res.soulPalace.branch);
    }
  });

  it('三方四正 are self-consistent: 命宫/财帛/官禄 form a trine, 迁移 sits opposite', () => {
    for (const input of samples) {
      const res = chart(input);
      const at = (name: string) => idx(res.palaces.find(p => p.name === name)!.branch);
      const life = at('命宫');

      expect(M(at('财帛') - life)).toBe(8);
      expect(M(at('官禄') - life)).toBe(4);
      expect(M(at('迁移') - life)).toBe(6);
      // Every opposing pair is exactly 6 apart.
      for (const [a, b] of [['兄弟', '仆役'], ['夫妻', '官禄'], ['子女', '田宅'], ['财帛', '福德'], ['疾厄', '父母']] as const) {
        expect(M(at(a) - at(b)), `${a}/${b}`).toBe(6);
      }
    }
  });

  it('宫干 follow 五虎遁 from the year ganzhi, and 大限 tiles the 12 palaces in 10-year steps', () => {
    for (const input of samples) {
      const res = chart(input);
      const ys = res.diagnostics.yearGanZhi[0];

      for (const p of res.palaces) {
        expect(p.stem, `宫干@${p.branch}`).toBe(G[palaceStem(ys, idx(p.branch))]);
        expect(p.decadal.stem).toBe(p.stem);
        expect(p.decadal.branch).toBe(p.branch);
        expect(p.decadal.ageRange[1] - p.decadal.ageRange[0]).toBe(9);
      }

      const starts = res.palaces.map(p => p.decadal.ageRange[0]).sort((a, b) => a - b);
      expect(starts).toEqual(Array.from({ length: 12 }, (_, i) => starts[0] + i * 10));
    }
  });

  it('五行局 matches 命宫 納音 and sets the 命宫 decadal start age (水二局 -> 2, 木三局 -> 3, ...)', () => {
    for (const input of samples) {
      const res = chart(input);
      const ys = res.diagnostics.yearGanZhi[0];
      const sp = idx(res.soulPalace.branch);
      const fc = fiveClass(ys, sp);

      expect(res.fiveElementsClass).toBe(FIVE_CLASS_LABEL[fc.n]);
      expect(res.palaces.find(p => p.name === '命宫')!.decadal.ageRange[0]).toBe(fc.n);
      // ...and the label's own numeral agrees with the start age.
      const numeral: Record<string, number> = { 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
      expect(numeral[res.fiveElementsClass[1]]).toBe(fc.n);
    }
  });

  it('命宫/身宫/紫微 follow the classical rules from lunar month, day and timeIndex alone', () => {
    for (const input of samples) {
      const res = chart(input);
      const { month: lm, day: ld, timeIndex: ti } = res.lunar;
      const ys = res.diagnostics.yearGanZhi[0];
      const sp = soulPalace(lm, ti);

      expect(idx(res.soulPalace.branch)).toBe(sp);
      expect(idx(res.bodyPalace.branch)).toBe(bodyPalace(lm, ti));
      expect(findStarTrimmed(res, '紫微')).toBe(ziweiPalace(fiveClass(ys, sp).n, ld));
      // 文昌/文曲/地空/地劫 are pure functions of timeIndex — the cheapest possible
      // check that the resolved hour actually reached the star placement.
      expect(findStarTrimmed(res, '文昌')).toBe(M(10 - ti));
      expect(findStarTrimmed(res, '文曲')).toBe(M(4 + ti));
      expect(findStarTrimmed(res, '地空')).toBe(M(11 - ti));
      expect(findStarTrimmed(res, '地劫')).toBe(M(11 + ti));
    }
  });
});

describe('8.3 Determinism', () => {
  it('repeated calls with identical input return identical results (no wall-clock dependence)', () => {
    const input: ZiweiInput = {
      place: 'Beijing', solarDate: { year: 2000, month: 8, day: 16 },
      clockTime: { hour: 4, minute: 0 }, gender: 'male',
    };
    const a = chart(input);
    const b = chart(input);
    expect(b).toEqual(a);
  });

  it('conventions are echoed back exactly as applied', () => {
    const res = chart({
      place: 'Beijing', solarDate: { year: 2000, month: 8, day: 16 }, clockTime: { hour: 4, minute: 0 },
      gender: 'male', yearDivide: 'lunar_new_year', horoscopeDivide: 'lunar_new_year',
      ageDivide: 'birthday', dayDivide: 'forward', algorithm: 'zhongzhou', astroType: 'earth',
      fixLeap: true, trueSolar: false,
    });
    expect(res.diagnostics.convention).toEqual({
      yearDivide: 'lunar_new_year', horoscopeDivide: 'lunar_new_year', ageDivide: 'birthday',
      dayDivide: 'forward', algorithm: 'zhongzhou', astroType: 'earth', fixLeap: true, trueSolar: false,
    });
    expect(res.diagnostics.yearDivideApplied).toBe('lunar_new_year');
  });
});
