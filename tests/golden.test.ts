import { describe, it, expect } from 'bun:test';
import { calculateZiweiChart } from '../src/core/chart';
import { ZiweiInputSchema } from '../src/schemas/input';
import type { ZiweiInput, ValidatedZiweiInput } from '../src/types';
import {
  G, idx, soulPalace, bodyPalace, palaceStem, fiveClass, ziweiPalace,
  stemOfLunarYear, findStarTrimmed, FIVE_CLASS_LABEL,
} from './ziwei-rules';

const chart = (input: ZiweiInput) => calculateZiweiChart(ZiweiInputSchema.parse(input) as ValidatedZiweiInput);

/**
 * Re-derives the whole placement layer from the classical rules (tests/ziwei-rules.ts)
 * using ONLY the year ganzhi + lunar month/day + timeIndex, then checks the service's
 * output against it. This turns every golden case below into a genuine correctness
 * claim rather than a snapshot of whatever the implementation happens to emit: the
 * hardcoded expectations pin the *time layer* (which ganzhi / lunar date / timeIndex
 * the birth resolves to), and this function independently proves the *chart* that
 * follows from them.
 */
function expectSelfConsistent(res: ReturnType<typeof chart>) {
  const ys = res.diagnostics.yearGanZhi[0];
  const { month: lm, day: ld, timeIndex: ti } = res.lunar;

  const sp = soulPalace(lm, ti);
  expect(idx(res.soulPalace.branch)).toBe(sp);
  expect(idx(res.bodyPalace.branch)).toBe(bodyPalace(lm, ti));
  expect(res.soulPalace.stem).toBe(G[palaceStem(ys, sp)]);

  const fc = fiveClass(ys, sp);
  expect(res.fiveElementsClass).toBe(FIVE_CLASS_LABEL[fc.n]);
  expect(findStarTrimmed(res, '紫微')).toBe(ziweiPalace(fc.n, ld));

  // 五行局 <-> 命宫 decadal start age (水二局 -> 2, 木三局 -> 3, ...)
  const soulPalaceObj = res.palaces.find(p => p.branch === res.soulPalace.branch)!;
  expect(soulPalaceObj.decadal.ageRange[0]).toBe(fc.n);
}

describe('8.2 Golden cases G1-G5 (ported from bazi-mcp, rewritten in Ziwei terms)', () => {
  /**
   * Each case's `yearGanZhi` and `timeIndex` are cross-validated against bazi-mcp's
   * own verified golden suite: the two projects share the time layer, so bazi's
   * asserted year pillar must equal our yearGanZhi, and its asserted hour pillar's
   * branch must equal our shichen. Those cross-checks are written out per case.
   */

  // G1: 1998-07-31 14:10 Asia/Shanghai 116.4074. bazi: 戊寅 己未 己卯 辛未 (hour branch 未 -> ti 7)
  it('G1: Baseline China - Beijing standard', () => {
    const res = chart({
      solarDate: { year: 1998, month: 7, day: 31 },
      clockTime: { hour: 14, minute: 10 },
      timezone: 'Asia/Shanghai',
      longitude: 116.4074,
      gender: 'male',
    });
    expect(res.diagnostics.yearGanZhi).toBe('戊寅');
    expect(res.lunar).toMatchObject({ year: 1998, month: 6, day: 9, isLeapMonth: false, shichen: '未', timeIndex: 7 });
    expect(res.soulPalace).toEqual({ branch: '子', stem: '甲', name: '命宫' });
    expect(res.bodyPalace.branch).toBe('寅');
    expect(res.fiveElementsClass).toBe('金四局');
    expect(findStarTrimmed(res, '紫微')).toBe(idx('丑'));
    expect(res.diagnostics.utcOffset).toBe('+08:00');
    expect(res.diagnostics.feedYear).toBe(1998); // no 立春 shift needed in July
    expectSelfConsistent(res);
  });

  // G2: 2024-02-04 08:00 America/Los_Angeles -122.4443. bazi: 甲辰 丙寅 戊戌 丙辰 (hour branch 辰 -> ti 4)
  // 立春 2024 = 2024-02-04 00:26:56 PST; born ~7.5h after, so the year ganzhi must be 甲辰
  // even though the lunar date is still 2023-12-25 — this is exactly the decoupling
  // spec §5 Z1 requires, and it forces feedYear (2024) away from lunar.year (2023).
  it('G2: Overseas 立春 boundary — year ganzhi and lunar year deliberately disagree', () => {
    // This case's whole point is the 立春-instant boundary (spec §5 Z1) — pin
    // yearDivide:'lichun' explicitly rather than relying on the default (0.2.0
    // default is 'lunar_new_year'; see project spec / README Conventions table).
    const res = chart({
      solarDate: { year: 2024, month: 2, day: 4 },
      clockTime: { hour: 8, minute: 0 },
      timezone: 'America/Los_Angeles',
      longitude: -122.4443,
      yearDivide: 'lichun',
      gender: 'male',
    });
    expect(res.diagnostics.yearGanZhi).toBe('甲辰');
    expect(res.lunar).toMatchObject({ year: 2023, month: 12, day: 25, timeIndex: 4, shichen: '辰' });
    expect(res.diagnostics.feedYear).toBe(2024);
    expect(res.diagnostics.feedYear).not.toBe(res.lunar.year);
    expect(res.soulPalace).toEqual({ branch: '酉', stem: '癸', name: '命宫' });
    expect(res.bodyPalace.branch).toBe('巳');
    expect(res.fiveElementsClass).toBe('金四局');
    expect(findStarTrimmed(res, '紫微')).toBe(idx('巳'));
    expectSelfConsistent(res);
  });

  // G3: 1990-06-15 20:00 America/Los_Angeles -122.4443. bazi: 庚午 壬午 辛亥 丁酉 (hour branch 酉 -> ti 9)
  it('G3: Overseas day roll + US DST', () => {
    const res = chart({
      solarDate: { year: 1990, month: 6, day: 15 },
      clockTime: { hour: 20, minute: 0 },
      timezone: 'America/Los_Angeles',
      longitude: -122.4443,
      gender: 'male',
    });
    expect(res.diagnostics.yearGanZhi).toBe('庚午');
    expect(res.diagnostics.utcOffset).toContain('DST in effect');
    expect(res.diagnostics.axisB_localSolarTime).toBe('1990-06-15 18:49');
    expect(res.lunar).toMatchObject({ year: 1990, month: 5, day: 23, timeIndex: 9, shichen: '酉' });
    expect(res.soulPalace).toEqual({ branch: '酉', stem: '乙', name: '命宫' });
    expect(res.bodyPalace.branch).toBe('卯');
    expect(res.fiveElementsClass).toBe('水二局');
    expect(findStarTrimmed(res, '紫微')).toBe(idx('子'));
    expectSelfConsistent(res);
  });

  // G4: 1990-06-15 08:00 Asia/Shanghai 87.6168 (Xinjiang). bazi: 庚午 壬午 辛亥 庚寅 (hour branch 寅 -> ti 2)
  // ~-130 min of longitude correction on top of China's 1986-1991 DST: 08:00 wall clock
  // becomes 04:50 true solar, dropping the birth from 辰 all the way to 寅.
  it('G4: Xinjiang large longitude shift + China historical DST', () => {
    const res = chart({
      solarDate: { year: 1990, month: 6, day: 15 },
      clockTime: { hour: 8, minute: 0 },
      timezone: 'Asia/Shanghai',
      longitude: 87.6168,
      gender: 'male',
    });
    expect(res.diagnostics.yearGanZhi).toBe('庚午');
    expect(res.diagnostics.utcOffset).toContain('+09:00');
    expect(res.diagnostics.utcOffset).toContain('DST in effect');
    expect(res.diagnostics.axisB_localSolarTime).toBe('1990-06-15 04:50');
    expect(res.diagnostics.longitudeCorrectionMinutes).toBeLessThan(-125);
    expect(res.lunar).toMatchObject({ year: 1990, month: 5, day: 23, timeIndex: 2, shichen: '寅' });
    expect(res.soulPalace).toEqual({ branch: '辰', stem: '庚', name: '命宫' });
    expect(res.bodyPalace.branch).toBe('申');
    expect(res.fiveElementsClass).toBe('金四局');
    expect(findStarTrimmed(res, '紫微')).toBe(idx('午'));
    expectSelfConsistent(res);
  });

  // G5: 1988-07-01 07:20 Asia/Shanghai 116.4074. bazi: 戊辰 戊午 丁巳 癸卯 (hour branch 卯 -> ti 3)
  it('G5: China historical DST (1988)', () => {
    const res = chart({
      solarDate: { year: 1988, month: 7, day: 1 },
      clockTime: { hour: 7, minute: 20 },
      timezone: 'Asia/Shanghai',
      longitude: 116.4074,
      gender: 'male',
    });
    expect(res.diagnostics.yearGanZhi).toBe('戊辰');
    expect(res.diagnostics.utcOffset).toContain('+09:00');
    expect(res.diagnostics.utcInstant).toBe('1988-06-30T22:20:00.000Z');
    expect(res.lunar).toMatchObject({ year: 1988, month: 5, day: 18, timeIndex: 3, shichen: '卯' });
    expect(res.soulPalace).toEqual({ branch: '卯', stem: '乙', name: '命宫' });
    expect(res.fiveElementsClass).toBe('水二局');
    expect(findStarTrimmed(res, '紫微')).toBe(idx('戌'));
    expectSelfConsistent(res);
  });

  // G5 equivalence: the same physical birth entered as lunarDate {1988,5,18} with
  // lunarDateFrame:'beijing' must derive the instant via the real Asia/Shanghai offset
  // (UTC+9 that summer, not a hardcoded +8), so it produces the identical chart.
  it('G5: lunarDate {1988,5,18} frame=beijing reproduces the solarDate 1988-07-01 chart exactly', () => {
    const common = { clockTime: { hour: 7, minute: 20 }, timezone: 'Asia/Shanghai', longitude: 116.4074, gender: 'male' } as const;
    const solar = chart({ solarDate: { year: 1988, month: 7, day: 1 }, ...common });
    const lunar = chart({ lunarDate: { year: 1988, month: 5, day: 18 }, lunarDateFrame: 'beijing', ...common });

    expect(lunar.diagnostics.utcInstant).toBe(solar.diagnostics.utcInstant);
    expect(solar.diagnostics.utcInstant).toBe('1988-06-30T22:20:00.000Z');
    // `diagnostics.lunar.frame` legitimately differs ('beijing' vs 'local'), so compare
    // the chart body and the top-level lunar block rather than the whole diagnostics blob.
    expect(lunar.palaces).toEqual(solar.palaces);
    expect(lunar.soulPalace).toEqual(solar.soulPalace);
    expect(lunar.bodyPalace).toEqual(solar.bodyPalace);
    expect(lunar.lunar).toEqual(solar.lunar);
    expect(lunar.diagnostics.yearGanZhi).toBe(solar.diagnostics.yearGanZhi);
    expect(lunar.diagnostics.lunar.frame).toBe('beijing');
    expect(solar.diagnostics.lunar.frame).toBe('local');
  });
});

describe('Regression: zod defaults must not depend on who built the input', () => {
  /**
   * The most recently fixed defect: calculateZiweiChart used to read zod-`.default()`ed
   * fields straight off the raw input object. Callers that build ValidatedZiweiInput
   * directly (every test in this suite, plus any library consumer) got `undefined` for
   * every omitted field — silently disabling True Solar Time, among others — and so
   * produced a *different chart* than the MCP path for the same birth.
   *
   * The case is chosen so the correction is large and chart-changing: longitude 86 under
   * Asia/Shanghai is -136 minutes (-140 with the equation of time), which drags 20:00
   * back to 17:39 — timeIndex 10 (戌)
   * without the correction, timeIndex 9 (酉) with it. Note this differs from the
   * project's written pitfall note, which says the hour moves "戌 to 申"; measured, it
   * is 戌 -> 酉.
   *
   * The deep-equal alone is not enough — it would still pass if BOTH paths lost True
   * Solar Time — so the teeth are the explicit timeIndex assertions.
   */
  const raw = {
    longitude: 86,
    timezone: 'Asia/Shanghai',
    solarDate: { year: 2000, month: 8, day: 16 },
    clockTime: { hour: 20, minute: 0 },
    gender: 'male',
  } as const;

  it('calculateZiweiChart(raw) deep-equals calculateZiweiChart(schema.parse(raw))', () => {
    const direct = calculateZiweiChart(raw as unknown as ValidatedZiweiInput);
    const parsed = calculateZiweiChart(ZiweiInputSchema.parse(raw) as ValidatedZiweiInput);
    expect(direct).toEqual(parsed);
  });

  it('True Solar Time is actually ON in both paths (timeIndex 9 = 酉, not 10 = 戌)', () => {
    const direct = calculateZiweiChart(raw as unknown as ValidatedZiweiInput);
    const parsed = calculateZiweiChart(ZiweiInputSchema.parse(raw) as ValidatedZiweiInput);

    for (const res of [direct, parsed]) {
      expect(res.diagnostics.convention.solarTime).toBe('true');
      expect(res.diagnostics.longitudeCorrectionMinutes).toBe(-136);
      expect(res.diagnostics.axisB_localSolarTime).toBe('2000-08-16 17:39');
      expect(res.lunar.timeIndex).toBe(9);
      expect(res.lunar.shichen).toBe('酉');
    }
  });

  it('...and the correction genuinely changes the chart (trueSolar:false gives timeIndex 10)', () => {
    const off = chart({ ...raw, trueSolar: false });
    expect(off.lunar.timeIndex).toBe(10);
    expect(off.lunar.shichen).toBe('戌');
    // Fix: trueSolar:false must not silently report the discarded correction as 0 — the
    // -136 min value is the same physical correction independently asserted above (same
    // longitude/timezone/date, trueSolar:true), just not applied to the chart here.
    // `convention.solarTime` (asserted below) is what actually says "not applied".
    expect(off.diagnostics.longitudeCorrectionMinutes).toBe(-136);
    expect(off.diagnostics.convention.solarTime).toBe('off');
    expect(off.diagnostics.warnings).toContain(
      'trueSolar is false: a longitude correction of -136.0 minutes was computed but NOT applied; the timeIndex (时辰) and lunar date placement may differ from a true-solar-time chart.'
    );
    // Different timeIndex => different 命宫 => a materially different chart.
    expect(off.soulPalace.branch).not.toBe(chart(raw).soulPalace.branch);
  });
});

describe('Output shape (spec §7)', () => {
  /**
   * spec §7's example JSON claims soulPalace.stem "戊" for the 2000-08-16 寅时 chart.
   * That is an error in the spec: 五虎遁 for a 庚 year gives 寅宫 = 戊, and the 命宫 here
   * is 午, four palaces on, i.e. 壬 — which is what both the implementation and the
   * independent rule engine produce. This test pins the correct value so nobody
   * "fixes" it back to the spec's prose.
   */
  it('2000-08-16 寅时 Beijing: soulPalace.stem is 壬, not the spec §7 example\'s 戊', () => {
    const res = chart({
      place: 'Beijing',
      solarDate: { year: 2000, month: 8, day: 16 },
      clockTime: { hour: 4, minute: 0 },
      gender: 'male',
    });
    expect(res.diagnostics.yearGanZhi).toBe('庚辰');
    expect(res.lunar).toMatchObject({ year: 2000, month: 7, day: 17, shichen: '寅', timeIndex: 2 });
    expect(res.soulPalace).toEqual({ branch: '午', stem: '壬', name: '命宫' });
    expect(res.bodyPalace.branch).toBe('戌');
    expect(res.fiveElementsClass).toBe('木三局');
    // Independently: 五虎遁 庚 -> 寅宫 戊, 命宫 午 is 4 steps on -> 壬.
    expect(G[palaceStem('庚', idx('寅'))]).toBe('戊');
    expect(G[palaceStem('庚', idx('午'))]).toBe('壬');
    expectSelfConsistent(res);
  });

  it('trims to the spec §7 shape and never leaks iztro\'s poisoned calendar fields', () => {
    const res = chart({
      place: 'Beijing',
      solarDate: { year: 2000, month: 8, day: 16 },
      clockTime: { hour: 4, minute: 0 },
      gender: 'male',
    });

    expect(Object.keys(res).sort()).toEqual(
      ['bodyPalace', 'body', 'diagnostics', 'fiveElementsClass', 'lunar', 'palaces', 'soul', 'soulPalace'].sort()
    );
    // spec §5 / probe-findings P2: these iztro fields are poisoned by the feed-year
    // trick (and lunarDate is additionally desynced under dayDivide:'forward').
    // (checked on the chart body only: diagnostics.lunar legitimately has its own
    // `solarDate`, computed by this project rather than read off the astrolabe.)
    const { diagnostics, ...chartBody } = res;
    const serialized = JSON.stringify(chartBody);
    for (const banned of ['solarDate', 'lunarDate', 'chineseDate', 'rawDates', 'sign']) {
      expect(serialized).not.toContain(banned);
    }

    expect(res.palaces).toHaveLength(12);
    for (const p of res.palaces) {
      expect(Object.keys(p).sort()).toEqual(
        ['adjectiveStars', 'branch', 'decadal', 'index', 'isBodyPalace', 'majorStars', 'minorStars', 'name', 'stem'].sort()
      );
      // adjectiveStars keep only the name — no type/scope internals.
      for (const s of p.adjectiveStars) expect(typeof s).toBe('string');
      for (const s of [...p.majorStars, ...p.minorStars]) {
        expect(Object.keys(s).sort()).toEqual(['brightness', 'mutagen', 'name']);
      }
    }
    expect(res.palaces.filter(p => p.isBodyPalace)).toHaveLength(1);
    expect(res.palaces.find(p => p.isBodyPalace)!.branch).toBe(res.bodyPalace.branch);
  });

  it('reports the engine versions the whole suite is baselined against', () => {
    const res = chart({
      place: 'Beijing',
      solarDate: { year: 2000, month: 8, day: 16 },
      clockTime: { hour: 4, minute: 0 },
      gender: 'male',
    });
    // A bump here invalidates the §8.1 parity baseline — review before re-pinning.
    expect(res.diagnostics.engineInfo.iztro).toBe('2.6.0');
    expect(res.diagnostics.engineInfo.lunarLite).toBe('0.2.8');
    expect(res.diagnostics.yearDivideNote).toContain('立春');
    expect(res.diagnostics.yearDivideNote).toContain("yearDivide:'exact'");
  });
});
