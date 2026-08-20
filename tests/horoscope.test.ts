import { describe, it, expect } from 'bun:test';
import { astro } from 'iztro';
import { solar2lunar } from 'lunar-lite';
import { calculateZiweiHoroscope } from '../src/core/horoscope';
import { calculateZiweiChart } from '../src/core/chart';
import { parseZiweiHoroscopeInput, ZiweiHoroscopeInputSchema } from '../src/schemas/horoscope';
import { parseZiweiInput } from '../src/schemas/input';
import { daysInLunarMonth, makeRandom } from './ziwei-rules';
// The 运限 oracle is the same permanent asset tests/horoscope-parity.test.ts uses — see
// that file and tests/horoscope-parity-reference.mjs's own header. Imported, not
// transplanted, for the same reason: it must stay independent of src/.
import { expectHoroscope } from './horoscope-parity-reference.mjs';

/**
 * Tests for the calculate_ziwei_horoscope wrapper — specifically the five interface
 * defects it exists to fix (project brief "运限" section). tests/horoscope-parity.test.ts
 * already proves iztro's own 运限 ARITHMETIC is correct (303,582 assertions vs an
 * independent oracle); this file proves the WRAPPER around that arithmetic is safe.
 * Each defect test is written so it fails if its specific fix is removed — see the
 * comment on each for exactly which line of production code it is pinned to.
 */
describe('运限 wrapper: defect 1 — feedYear ±60 compensation', () => {
  it('compensates the ±60 feed-year shift so 虚岁/大限/小限 reflect the TRUE birth year, not the shifted one', () => {
    // Fixture from probe-findings P2a/P2b, also used in tests/boundary.test.ts's own
    // feed-year tests: birth solar 2024-02-09 == lunar 2023-12-30 (腊月三十), which
    // falls AFTER 立春 2024 (Feb 4) — so under the default yearDivide:'lichun', the
    // correct year ganzhi is 2024's (甲辰), requiring feedYear = lunarYear + 1 = 2024.
    // But 2024's own 腊月 only has 29 days, so iztro would crash feeding day 30 into
    // it — lunarYearForGanZhi falls back to feedYear = 1964 (2024 - 60, same ganzhi).
    // That -60 has zero calendrical meaning and, left uncompensated, corrupts 虚岁
    // by exactly 60 years for every target (see the "would be corrupted" assertion
    // below). The intentional +1 (2023 -> 2024, the lichun-window component) must
    // NOT be compensated — it is what makes the year ganzhi correct in the first
    // place, and letting 虚岁 move with it is what the lichun school means.
    // This fixture's whole premise is the 立春-window feed-year shift (P2a/P2b) — pin
    // yearDivide:'lichun' explicitly (0.2.0 default is 'lunar_new_year').
    const res = calculateZiweiHoroscope(parseZiweiHoroscopeInput({
      place: 'Beijing',
      solarDate: { year: 2024, month: 2, day: 9 },
      clockTime: { hour: 10, minute: 0 },
      yearDivide: 'lichun',
      gender: 'male',
      target: { solarDate: { year: 2054, month: 6, day: 15 }, clockTime: { hour: 10, minute: 0 } },
    }));

    expect(res.diagnostics.feedYearCompensation.birthFeedYear).toBe(1964);
    expect(res.diagnostics.feedYearCompensation.birthLunarYear).toBe(2023);
    expect(res.diagnostics.feedYearCompensation.sixtyYearOffsetApplied).toBe(-60);
    expect(res.diagnostics.feedYearCompensation.decadalAgeSource).toBe('anchor');

    // Cross-checked against the independent oracle by treating the birth AS the
    // lichun-shifted lunar year 2024 (i.e. the mathematically correct "lichun
    // school" interpretation of this birth) — the decadal/age results must match
    // EXACTLY, proving the ±1/±60 split in the fix is algebraically correct, not
    // just "some other number than the naive one". Deliberately re-derives the
    // BIRTH's own timeIndex from the natal tool rather than reusing
    // res.diagnostics.targetTimeIndex (the TARGET's own ti) — decadal.index depends
    // on the soul palace, which depends on the birth's ti, not the target's; those
    // two only coincidentally matched (both resolve to ti 5) for this fixture's
    // specific clock times, and reusing the target's would silently stop testing
    // the right thing the moment either clockTime changed.
    const natalTi = calculateZiweiChart(parseZiweiInput({
      place: 'Beijing', solarDate: { year: 2024, month: 2, day: 9 }, clockTime: { hour: 10, minute: 0 }, gender: 'male',
    })).lunar.timeIndex;
    const want = expectHoroscope({ lunarYear: 2024, lunarMonth: 12, lunarDay: 30, timeIndex: natalTi, gender: 'male' }, '2054-06-15', 0);
    expect(res.decadal.index).toBe(want.decadal.index);
    expect(res.decadal.stem).toBe(want.decadal.stem);
    expect(res.decadal.branch).toBe(want.decadal.branch);
    expect(res.age.index).toBe(want.age.index);
    expect(res.age.nominalAge).toBe(want.age.nominalAge!);
    expect(res.age.nominalAge).toBe(31);

    // Prove the fix is load-bearing: without the -60 compensation, iztro's own
    // formula (target lunar year - feedYear + 1) computes a nominalAge inflated by
    // exactly 60 — a 30-something person reported as 91. This is the literal
    // reproducer from the project brief ("feed 1930 (P2b ±60) -> 虚岁 96").
    const naiveChart = astro.withOptions({
      type: 'lunar', dateStr: '1964-12-30', timeIndex: res.diagnostics.targetTimeIndex, gender: 'male',
      isLeapMonth: false, fixLeap: false, language: 'zh-CN',
      config: { yearDivide: 'normal', horoscopeDivide: 'normal', ageDivide: 'normal', dayDivide: 'current' },
    } as any);
    const naiveResult: any = naiveChart.horoscope('2054-06-15', 0);
    expect(naiveResult.age.nominalAge).toBe(91);
    expect(naiveResult.age.nominalAge).not.toBe(res.age.nominalAge);
  });
});

describe('运限 wrapper: defect 2 — horoscopeDivide decoupling (立春↔正月初一 window)', () => {
  // 2024: 立春 = Feb 4, 正月初一 = Feb 10. A target in between (Feb 6) has already
  // crossed 立春 (so the lichun-correct 流年 is already 甲辰) but not yet crossed
  // 正月初一 (so iztro's own internal, hardcoded-to-'normal' division still says 癸卯).
  const birth = { place: 'Beijing', solarDate: { year: 1990, month: 6, day: 15 }, clockTime: { hour: 10, minute: 0 }, gender: 'male' as const };
  const target = { solarDate: { year: 2024, month: 2, day: 6 }, clockTime: { hour: 10, minute: 0 } };

  it('determines 流年 independently on Axis A (lichun) rather than iztro\'s self-contradictory exact-boundary mode', () => {
    // Pins horoscopeDivide:'lichun' explicitly (0.2.0 default is 'lunar_new_year') —
    // this test's whole point is exercising the 立春-window decoupling.
    const res = calculateZiweiHoroscope(parseZiweiHoroscopeInput({ ...birth, horoscopeDivide: 'lichun', target }));
    expect(res.diagnostics.yearlyGanZhi).toBe('甲辰');
    expect(res.yearly.stem).toBe('甲');
    expect(res.yearly.branch).toBe('辰');
    expect(res.diagnostics.yearlySource).toBe('anchor');
    // The decoupled call sources ONLY the yearly block (spec: "the yearly block
    // depends only on the lunar year") — iztro's own internal (正月初一-only)
    // division for this exact date is a DIFFERENT ganzhi, proving the two are
    // genuinely decoupled, not just relabeled.
    expect(res.diagnostics.monthlyAnchor.ganZhi).toBe('癸卯');
    expect(res.diagnostics.monthlyAnchor.ganZhi).not.toBe(res.diagnostics.yearlyGanZhi);
    expect(res.diagnostics.warnings.some(w => w.includes('立春') && w.includes('正月初一'))).toBe(true);
  });

  it('has no window effect under horoscopeDivide:lunar_new_year (the two years coincide)', () => {
    const res = calculateZiweiHoroscope(parseZiweiHoroscopeInput({ ...birth, horoscopeDivide: 'lunar_new_year', target }));
    expect(res.diagnostics.yearlyGanZhi).toBe('癸卯');
    expect(res.diagnostics.monthlyAnchor.ganZhi).toBe('癸卯');
    expect(res.diagnostics.yearlySource).toBe('true-target');
    expect(res.diagnostics.warnings.some(w => w.includes('立春') && w.includes('正月初一'))).toBe(false);
  });
});

describe('运限 wrapper: defect 3 — iztro config is global and read lazily by horoscope()', () => {
  const birth = { place: 'Beijing', solarDate: { year: 1990, month: 6, day: 15 }, clockTime: { hour: 10, minute: 0 }, gender: 'male' as const };
  const target = { solarDate: { year: 2024, month: 6, day: 6 }, clockTime: { hour: 10, minute: 0 } };

  it('applies this request\'s own mutagens override to horoscope() output (not silently the default table)', () => {
    // Discover which stem this fixture's own decadal scope lands on, then override
    // exactly that stem — buildNatalAstrolabe's F1 finally-block wipes
    // mutagens/brightness to pristine immediately after the natal chart is built
    // (correct for the natal path), so WITHOUT horoscope.ts's own re-apply
    // (withHoroscopeConfig in src/core/horoscope.ts), this override would never
    // reach the .horoscope() call at all and `decadal.mutagen` below would show
    // iztro's default table instead.
    const plain = calculateZiweiHoroscope(parseZiweiHoroscopeInput({ ...birth, target }));
    expect(plain.decadal.stem).toBe('辛');
    expect(plain.decadal.mutagen).toEqual(['巨门', '太阳', '文曲', '文昌']);

    const override = ['文昌', '文曲', '天魁', '天钺'];
    const withOverride = calculateZiweiHoroscope(parseZiweiHoroscopeInput({
      ...birth, target, mutagens: { 辛: override },
    }));
    expect(withOverride.decadal.stem).toBe('辛');
    expect(withOverride.decadal.mutagen).toEqual(override);
  });

  it('does not leak an override from one horoscope() request into the NEXT plain one', () => {
    // Same birth+target as above, called with an override THEN without one,
    // immediately after. Without resetIztroConfig() running after the first call
    // (the other half of the withHoroscopeConfig discipline), the override would
    // still be sitting in iztro's module-level globals when the second, override-
    // free call reads them.
    calculateZiweiHoroscope(parseZiweiHoroscopeInput({
      ...birth, target, mutagens: { 辛: ['文昌', '文曲', '天魁', '天钺'] },
    }));
    const after = calculateZiweiHoroscope(parseZiweiHoroscopeInput({ ...birth, target }));
    expect(after.decadal.mutagen).toEqual(['巨门', '太阳', '文曲', '文昌']);
  });
});

describe('运限 wrapper: defect 4 — ageDivide:\'birthday\' is upstream-broken and rejected', () => {
  const birth = { place: 'Beijing', solarDate: { year: 1990, month: 6, day: 15 }, clockTime: { hour: 10, minute: 0 }, gender: 'male' as const };

  it('rejects ageDivide:\'birthday\' with an explanation, not a bare enum error', () => {
    expect(() => parseZiweiHoroscopeInput({ ...birth, ageDivide: 'birthday' })).toThrow(/以生日为界/);
    expect(() => ZiweiHoroscopeInputSchema.parse({ ...birth, ageDivide: 'birthday' })).toThrow();
  });

  it('accepts ageDivide:\'birthday\' on the natal tool (小限 has no effect there — the defect is dormant)', () => {
    expect(() => parseZiweiInput({ ...birth, ageDivide: 'birthday' })).not.toThrow();
    const plain = calculateZiweiChart(parseZiweiInput({ ...birth }));
    const withBirthday = calculateZiweiChart(parseZiweiInput({ ...birth, ageDivide: 'birthday' }));
    expect(withBirthday.palaces).toEqual(plain.palaces);
  });
});

describe('运限 wrapper: defect 5 — degenerate targets', () => {
  const birth = { place: 'Beijing', timezone: 'Asia/Shanghai', longitude: 120, trueSolar: false, solarDate: { year: 1990, month: 6, day: 15 }, clockTime: { hour: 8, minute: 0 }, gender: 'male' as const };

  it('rejects a pre-birth target instead of returning iztro\'s garbage (index -1, untranslated keys)', () => {
    expect(() => calculateZiweiHoroscope(parseZiweiHoroscopeInput({
      ...birth, target: { solarDate: { year: 1980, month: 1, day: 1 }, clockTime: { hour: 12, minute: 0 } },
    }))).toThrow(/before the birth lunar year/);
  });

  it('does NOT reject a same-lunar-year target before the birth date (虚岁 1 covers the whole birth year)', () => {
    const res = calculateZiweiHoroscope(parseZiweiHoroscopeInput({
      ...birth, target: { solarDate: { year: 1990, month: 2, day: 1 }, clockTime: { hour: 12, minute: 0 } },
    }));
    expect(res.age.nominalAge).toBe(1);
  });

  it('normalizes a 晚子时 (late-Zi, timeIndex 12) target to next-day timeIndex 0 instead of desyncing daily.index from the day ganzhi', () => {
    // dayDivide has no effect on horoscope() (brief item 5) and iztro's OWN
    // internal ti=12 handling advances the day ganzhi without advancing
    // daily.index/lunarDate — so the wrapper must never hand horoscope() a raw 12.
    // Prove it by checking the normalized-late-Zi result is byte-identical to
    // calling with the equivalent already-normalized target directly.
    const lateZi = calculateZiweiHoroscope(parseZiweiHoroscopeInput({
      ...birth, target: { solarDate: { year: 2025, month: 6, day: 15 }, clockTime: { hour: 23, minute: 30 } },
    }));
    expect(lateZi.diagnostics.lateZiNormalized).toBe(true);
    expect(lateZi.diagnostics.targetTimeIndex).toBe(0);

    const nextDayExplicit = calculateZiweiHoroscope(parseZiweiHoroscopeInput({
      ...birth, target: { solarDate: { year: 2025, month: 6, day: 16 }, clockTime: { hour: 0, minute: 0 } },
    }));
    expect(nextDayExplicit.diagnostics.lateZiNormalized).toBe(false);

    expect(lateZi.daily).toEqual(nextDayExplicit.daily);
    expect(lateZi.hourly).toEqual(nextDayExplicit.hourly);
    expect(lateZi.decadal).toEqual(nextDayExplicit.decadal);
    expect(lateZi.monthly).toEqual(nextDayExplicit.monthly);
    // Internally consistent: whatever palace daily lands in, its branch is the
    // one actually reachable from timeIndex 0 — no index/branch desync.
    expect(lateZi.daily.index).toBeGreaterThanOrEqual(0);
    expect(lateZi.daily.index).toBeLessThanOrEqual(11);
  });
});

describe('运限 wrapper: output shape (spec §7 trimming discipline)', () => {
  it('omits the natal chart entirely and trims each scope to name/index/干支/palaceNames/mutagen/stars', () => {
    const res: any = calculateZiweiHoroscope(parseZiweiHoroscopeInput({
      place: 'Beijing', solarDate: { year: 1990, month: 6, day: 15 }, clockTime: { hour: 10, minute: 0 }, gender: 'male',
      target: { solarDate: { year: 2024, month: 6, day: 6 }, clockTime: { hour: 10, minute: 0 } },
    }));
    expect(res.palaces).toBeUndefined();
    expect(res.soulPalace).toBeUndefined();

    for (const scope of ['decadal', 'yearly', 'monthly', 'daily', 'hourly']) {
      expect(Array.isArray(res[scope].stars)).toBe(true);
      expect(res[scope].stars).toHaveLength(12);
      for (const palaceStars of res[scope].stars) {
        expect(Array.isArray(palaceStars)).toBe(true);
        for (const name of palaceStars) expect(typeof name).toBe('string');
      }
      expect(res[scope].mutagen).toHaveLength(4);
      expect(res[scope].palaceNames).toHaveLength(12);
    }
    // 小限 (age) never gets a stars array from iztro — must not fabricate one.
    expect(res.age.stars).toBeUndefined();
    expect(typeof res.age.nominalAge).toBe('number');
    // 流年-exclusive fields.
    expect(res.yearly.yearlyDecStars.suiqian12).toHaveLength(12);
    expect(res.yearly.yearlyDecStars.jiangqian12).toHaveLength(12);
    expect(res.decadal.yearlyDecStars).toBeUndefined();
  });
});

describe('运限 wrapper: broad smoke test vs the independent oracle', () => {
  it('matches the classical rules across seeded charts, with horoscopeDivide/yearDivide pinned to lunar_new_year to isolate the wrapper from the lichun-school divergence covered by the defect-2 tests above', () => {
    // Restricted to 1992-2019 births deliberately: this range has no historical
    // China DST (1986-1991) or WWII-era regional DST (1940s), so
    // Asia/Shanghai + longitude 120 + trueSolar:false reduces cleanly to "the
    // clock hour IS the true solar hour", letting this test drive
    // calculateZiweiHoroscope through its full public (clockTime-based) input
    // instead of iztro's raw timeIndex — exercising the real axis-B time layer
    // this tool shares with the natal one, not just the horoscope-specific math.
    const rnd = makeRandom(20260819);
    const hourForTi = (ti: number) => (ti === 0 ? 0 : 2 * ti - 1);
    const fails: string[] = [];
    let checks = 0;
    const ser = (v: unknown) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? JSON.stringify(Object.keys(v as object).sort().map(k => [k, (v as any)[k]]))
        : JSON.stringify(v);
    const eq = (got: unknown, want: unknown, msg: string) => {
      checks++;
      if (ser(got) !== ser(want)) fails.push(`${msg}: got ${ser(got)}, want ${ser(want)}`);
    };

    for (let k = 0; k < 40; k++) {
      const ly = 1992 + Math.floor(rnd() * 27);
      const lm = 1 + Math.floor(rnd() * 12);
      const ld = 1 + Math.floor(rnd() * daysInLunarMonth(ly, lm));
      const ti = Math.floor(rnd() * 12);
      const gender = rnd() < 0.5 ? 'male' : 'female';

      for (let j = 0; j < 3; j++) {
        const tYear = ly + Math.floor(rnd() * Math.min(95, 2100 - ly));
        const tMonth = 1 + Math.floor(rnd() * 12);
        const tDay = 1 + Math.floor(rnd() * 28);
        const targetStr = `${tYear}-${String(tMonth).padStart(2, '0')}-${String(tDay).padStart(2, '0')}`;
        if (solar2lunar(targetStr).lunarYear < ly) continue;
        // 0-11 only (late-Zi/ti=12 normalization is covered by its own defect-5 test,
        // which needs a real clock time to land in that window, not a synthetic ti).
        const tTi = Math.floor(rnd() * 12);
        const tag = `[${ly}-${lm}-${ld} ti${ti} ${gender} -> ${targetStr} ti${tTi}]`;

        const got = calculateZiweiHoroscope(parseZiweiHoroscopeInput({
          timezone: 'Asia/Shanghai', longitude: 120, trueSolar: false,
          yearDivide: 'lunar_new_year', horoscopeDivide: 'lunar_new_year',
          lunarDate: { year: ly, month: lm, day: ld },
          clockTime: { hour: hourForTi(ti), minute: 0 },
          gender,
          target: { solarDate: { year: tYear, month: tMonth, day: tDay }, clockTime: { hour: hourForTi(tTi), minute: 0 } },
        })) as any;
        const want: any = expectHoroscope({ lunarYear: ly, lunarMonth: lm, lunarDay: ld, timeIndex: ti, gender: gender as any }, targetStr, tTi);

        for (const s of ['decadal', 'age', 'yearly', 'monthly', 'daily', 'hourly'] as const) {
          const g = got[s];
          const w = want[s];
          eq(g.index, w.index, `${tag} ${s}.index`);
          eq(g.stem, w.stem, `${tag} ${s}.stem`);
          eq(g.branch, w.branch, `${tag} ${s}.branch`);
          eq(g.palaceNames, w.palaceNames, `${tag} ${s}.palaceNames`);
          eq(g.mutagen, w.mutagen, `${tag} ${s}.mutagen`);
          if (s === 'age') { eq(g.nominalAge, w.nominalAge, `${tag} age.nominalAge`); continue; }
          const gotStars: Record<string, number> = {};
          (g.stars ?? []).forEach((arr: string[], i: number) => arr.forEach((name: string) => { gotStars[name] = i; }));
          eq(gotStars, w.stars, `${tag} ${s}.stars`);
        }
        eq(got.yearly.yearlyDecStars.suiqian12, want.yearly.suiqian12, `${tag} suiqian12`);
        eq(got.yearly.yearlyDecStars.jiangqian12, want.yearly.jiangqian12, `${tag} jiangqian12`);
      }
    }

    if (fails.length) throw new Error(`${fails.length}/${checks} mismatches:\n  ${fails.slice(0, 20).join('\n  ')}`);
    expect(checks).toBeGreaterThan(300);
  });
});
