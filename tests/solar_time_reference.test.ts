import { describe, it, expect } from 'bun:test';
import { calculateZiweiChart } from '../src/core/chart';
import { calculateZiweiHoroscope } from '../src/core/horoscope';
import { ZiweiInputSchema } from '../src/schemas/input';
import { parseZiweiHoroscopeInput } from '../src/schemas/horoscope';
import type { ZiweiInput, ValidatedZiweiInput } from '../src/types';

/**
 * True solar time checked against sources outside this project.
 *
 * Every other test in this suite compares the server against itself, against
 * iztro, or against the two hand-written classical oracles
 * (tests/parity-reference.mjs, tests/horoscope-parity-reference.mjs). All three
 * take `timeIndex` as an INPUT: they verify star placement *given* an hour. The
 * hour itself comes from @openfate/true-solar-time, and nothing checked that
 * layer against anything external — an equation-of-time sign error or a bad
 * longitude correction would move the 时辰, silently change every affected
 * chart, and leave every oracle we own green, because they would be handed the
 * already-corrupted hour.
 *
 * The equation of time is not a 紫微斗数 quantity at all — it is astronomy, its
 * extremes and zero crossings are published in almanacs, and the longitude
 * correction is plain geometry. Both can therefore be checked against values
 * derived without reference to this codebase.
 *
 * Published reference values: the equation of time reaches about −14.24 minutes
 * around 11 February and about +16.49 minutes around 2-3 November, and passes
 * through zero near 15 April, 13 June, 1 September and 25 December.
 *
 * Ported from bazi-mcp's tests/solar_time_reference.test.ts (commit 01981f1);
 * the substitution is calculateDualAxisBazi -> calculateZiweiChart.
 */

const chart = (input: ZiweiInput) => calculateZiweiChart(ZiweiInputSchema.parse(input) as ValidatedZiweiInput);

const eotOn = (month: number, day: number, year = 2023): number =>
  chart({
    timezone: 'UTC',
    longitude: 0,
    solarDate: { year, month, day },
    clockTime: { hour: 12, minute: 0 },
    gender: 'male',
  }).diagnostics.equationOfTimeMinutes;

/** [name, IANA timezone, longitude, standard UTC offset in hours] */
const SITES: Array<[string, string, number, number]> = [
  ['Beijing', 'Asia/Shanghai', 116.4074, 8],
  ['London', 'Europe/London', -0.1276, 0],
  ['New York', 'America/New_York', -74.006, -5],
  ['Kathmandu', 'Asia/Kathmandu', 85.324, 5.75], // 45-minute offset zone
];

describe('True solar time against external references', () => {
  it('reproduces the published extremes of the equation of time', () => {
    expect(eotOn(2, 11)).toBeCloseTo(-14.24, 1);
    expect(eotOn(11, 3)).toBeCloseTo(16.49, 1);

    // And they are the extremes — not merely close to the published value on
    // those dates, but the largest excursions anywhere in the year.
    let min = { value: Infinity, date: '' };
    let max = { value: -Infinity, date: '' };
    for (let month = 1; month <= 12; month++) {
      for (let day = 1; day <= 28; day++) {
        const value = eotOn(month, day);
        if (value < min.value) min = { value, date: `${month}/${day}` };
        if (value > max.value) max = { value, date: `${month}/${day}` };
      }
    }
    expect(min.date).toBe('2/11');
    expect(max.date).toBe('11/3');
  }, 120_000); // 336 full chart builds; well over bun's 5s default.

  it('crosses zero on the four published dates', () => {
    for (const [month, day] of [[4, 15], [6, 13], [9, 1], [12, 25]]) {
      expect(Math.abs(eotOn(month, day)), `${month}/${day}`).toBeLessThan(0.3);
    }
  });

  it('derives the longitude correction as plain geometry', () => {
    // (longitude − standard meridian) × 4 minutes per degree, computed here
    // rather than read back from the implementation.
    for (const [name, timezone, longitude, utcOffsetHours] of SITES) {
      const res = chart({
        timezone,
        longitude,
        solarDate: { year: 2023, month: 1, day: 15 },
        clockTime: { hour: 12, minute: 0 },
        gender: 'male',
      });
      const expected = (longitude - 15 * utcOffsetHours) * 4;
      expect(res.diagnostics.longitudeCorrectionMinutes, name).toBeCloseTo(expected, 2);
    }
  });

  it('reports the longitude correction truthfully even when trueSolar:false (does not silently zero it out)', () => {
    // Fix: trueSolar:false used to hard-report longitudeCorrectionMinutes as 0 instead
    // of the real (unapplied) correction, hiding how far the discarded correction would
    // have moved the chart. The correction is a pure function of longitude/timezone, so
    // it must be identical to the trueSolar:true case above — computed against the same
    // external geometric oracle here, not read back from what the implementation happens
    // to produce.
    for (const [name, timezone, longitude, utcOffsetHours] of SITES) {
      const date = { year: 2023, month: 1, day: 15 };
      const clockTime = { hour: 12, minute: 0 };
      const on = chart({ timezone, longitude, solarDate: date, clockTime, gender: 'male' });
      const off = chart({ timezone, longitude, solarDate: date, clockTime, gender: 'male', trueSolar: false });
      const expected = (longitude - 15 * utcOffsetHours) * 4;

      expect(off.diagnostics.longitudeCorrectionMinutes, name).toBeCloseTo(expected, 2);
      // Same physical correction reported in both modes — solarTime only toggles
      // whether it's applied to the chart (convention.solarTime), not what's reported.
      expect(off.diagnostics.longitudeCorrectionMinutes, name).toBeCloseTo(on.diagnostics.longitudeCorrectionMinutes, 6);
      expect(off.diagnostics.convention.solarTime, name).toBe('off');
    }
  });

  it('warns when trueSolar:false discards a correction large enough to move the 时辰 (>30 min)', () => {
    // Kashgar under Asia/Shanghai: ~176 minutes of longitude correction alone, far past
    // the 30-minute threshold ported from bazi-mcp's dual-axis.ts.
    const off = chart({
      timezone: 'Asia/Shanghai', longitude: 75.99,
      solarDate: { year: 1990, month: 6, day: 15 }, clockTime: { hour: 8, minute: 0 },
      gender: 'male', trueSolar: false,
    });
    expect(off.diagnostics.longitudeCorrectionMinutes).toBeCloseTo(-176.04, 1);
    expect(off.diagnostics.warnings.some(w => w.includes('trueSolar is false') && w.includes('NOT applied'))).toBe(true);

    // And a small correction (well under 30 min) must NOT trigger the warning.
    const small = chart({
      timezone: 'Asia/Shanghai', longitude: 118,
      solarDate: { year: 1990, month: 6, day: 15 }, clockTime: { hour: 8, minute: 0 },
      gender: 'male', trueSolar: false,
    });
    expect(Math.abs(small.diagnostics.longitudeCorrectionMinutes)).toBeLessThan(30);
    expect(small.diagnostics.warnings.some(w => w.includes('trueSolar is false'))).toBe(false);
  });

  it('reads 12:00 solar at the clock time of solar noon', () => {
    // Composes both corrections: solar noon happens at
    // 12:00 − longitudeCorrection − equationOfTime on the clock, so feeding that
    // moment back in must return local noon. This is what catches a sign error
    // or a dropped term that the two components pass individually.
    for (const [name, timezone, longitude, utcOffsetHours] of SITES) {
      const date = { year: 2023, month: 1, day: 15 };
      const probe = chart({
        timezone, longitude, solarDate: date,
        clockTime: { hour: 12, minute: 0 }, gender: 'male',
      }).diagnostics;

      const offsetFromClock = (longitude - 15 * utcOffsetHours) * 4 + probe.equationOfTimeMinutes;
      const noonMinutes = 12 * 60 - offsetFromClock;
      const hour = Math.floor(noonMinutes / 60);
      const minute = Math.round(noonMinutes % 60);

      const atNoon = chart({
        timezone, longitude, solarDate: date,
        clockTime: { hour, minute }, gender: 'male',
      });

      // Tolerance: the input clock time is rounded to a whole minute (±30s) and
      // `axisB_localSolarTime` is minute-precision with the seconds dropped
      // (src/core/time-index.ts parses only HH:MM out of the library's
      // second-precision string), so ~90s of slack is structural. bazi's version
      // of this test reads a second-precision field and can afford 60s. Two
      // minutes is still two orders of magnitude tighter than any sign error:
      // inverting the equation of time here is an ~18-minute excursion.
      const reported = atNoon.diagnostics.axisB_localSolarTime.slice(11);
      const [h, m] = reported.split(':').map(Number);
      const minutesFromNoon = Math.abs(h * 60 + m - 12 * 60);
      expect(minutesFromNoon, `${name} reported ${reported}`).toBeLessThanOrEqual(2);
    }
  });
});

/**
 * 0.3.0: the three-way `solarTime` mode ('true' | 'mean' | 'off'), mirroring bazi-mcp's
 * BaziInputSchema/dual-axis.ts exactly. 'true' and 'off' reproduce the exact pre-0.3.0
 * `trueSolar: true`/`false` behavior (regression guard: every pre-existing test in this
 * suite, and the rest of the project, passes unmodified except for the two mandated
 * renames — axisB_localTrueSolarTime -> axisB_localSolarTime and
 * convention.trueSolar -> convention.solarTime — and the alias-equivalence tests below
 * pin that explicitly). 'mean' (地方平太阳时) is net-new: longitude correction applied,
 * equation of time reported but withheld — this file is the natural place to pin it,
 * since it already anchors the astronomy against published almanac constants.
 */
describe('solarTime: "mean" (0.3.0, 地方平太阳时 — longitude only, no equation of time)', () => {
  const wallMinutes = (localSolarTime: string): number => {
    const [h, m] = localSolarTime.slice(11).split(':').map(Number);
    return h * 60 + m;
  };

  it('applies exactly the geometric longitude correction to the wall clock, and reports (without applying) the equation of time', () => {
    for (const [name, timezone, longitude, utcOffsetHours] of SITES) {
      const date = { year: 2023, month: 1, day: 15 };
      const clockTime = { hour: 12, minute: 0 };
      const off = chart({ timezone, longitude, solarDate: date, clockTime, gender: 'male', solarTime: 'off' });
      const mean = chart({ timezone, longitude, solarDate: date, clockTime, gender: 'male', solarTime: 'mean' });
      const trueMode = chart({ timezone, longitude, solarDate: date, clockTime, gender: 'male', solarTime: 'true' });
      const expectedLongitude = (longitude - 15 * utcOffsetHours) * 4;

      // longitudeCorrectionMinutes is the same pure-geometry value in every mode —
      // computed here, not read back from what 'mean' happens to produce.
      expect(mean.diagnostics.longitudeCorrectionMinutes, name).toBeCloseTo(expectedLongitude, 2);
      // equationOfTimeMinutes is REPORTED under 'mean' (never hard-zeroed) — identical
      // to what 'true' reports, since it's the same unconditional computation...
      expect(mean.diagnostics.equationOfTimeMinutes, name).toBeCloseTo(trueMode.diagnostics.equationOfTimeMinutes, 6);
      // ...but NOT applied: 'mean's wall clock is 'off's wall clock shifted by ONLY the
      // longitude correction, never by the equation of time on top of it.
      const meanShift = wallMinutes(mean.diagnostics.axisB_localSolarTime) - wallMinutes(off.diagnostics.axisB_localSolarTime);
      expect(Math.abs(meanShift - expectedLongitude), name).toBeLessThanOrEqual(2);
      // The full True Solar Time shift also includes the equation of time on top of the
      // same longitude correction, so 'true' and 'mean' disagree by exactly that amount.
      const trueShift = wallMinutes(trueMode.diagnostics.axisB_localSolarTime) - wallMinutes(off.diagnostics.axisB_localSolarTime);
      expect(Math.abs(trueShift - meanShift - mean.diagnostics.equationOfTimeMinutes), name).toBeLessThanOrEqual(2);
    }
  });

  it('pins the true-vs-mean difference as exactly the published equation of time at its extremes', () => {
    // longitude 0 under a zero-offset zone: the geometric longitude correction is
    // exactly zero, so 'mean' must leave the wall clock completely UNCHANGED — isolating
    // the equation of time as the only thing that can move 'true' away from it.
    const site = { timezone: 'UTC', longitude: 0, clockTime: { hour: 12, minute: 0 }, gender: 'male' as const };
    for (const [month, day, expectedEot] of [[2, 11, -14.24], [11, 3, 16.49]] as const) {
      const solarDate = { year: 2023, month, day };
      const mean = chart({ ...site, solarDate, solarTime: 'mean' });
      const trueMode = chart({ ...site, solarDate, solarTime: 'true' });

      expect(mean.diagnostics.longitudeCorrectionMinutes).toBeCloseTo(0, 6);
      expect(mean.diagnostics.axisB_localSolarTime.slice(11)).toBe('12:00');
      expect(trueMode.diagnostics.equationOfTimeMinutes).toBeCloseTo(expectedEot, 1);

      const trueMinutes = wallMinutes(trueMode.diagnostics.axisB_localSolarTime);
      const meanMinutes = wallMinutes(mean.diagnostics.axisB_localSolarTime);
      expect(Math.abs(trueMinutes - (720 + expectedEot))).toBeLessThanOrEqual(2);
      expect(Math.abs(trueMinutes - meanMinutes - expectedEot)).toBeLessThanOrEqual(2);
    }
  });

  it('strips DST before applying the longitude correction (no double-counting) under an active-DST fixture', () => {
    // America/Los_Angeles in July observes PDT (UTC-7); the STANDARD (non-DST) offset
    // is UTC-8 — the meridian the longitude correction must be measured against. If
    // 'mean' mistakenly keyed off the civil (DST-included) wall clock instead of the
    // DST-stripped standard wall clock (this project's own documented historical bug —
    // see src/core/time-index.ts's trueSolarTimeIndex comment), the result would be off
    // by a full hour, not by the ~7-minute longitude correction computed below.
    const fixture = {
      timezone: 'America/Los_Angeles', longitude: -118.2437,
      solarDate: { year: 2023, month: 7, day: 15 }, clockTime: { hour: 12, minute: 0 },
      gender: 'male' as const,
    };
    const off = chart({ ...fixture, solarTime: 'off' });
    const mean = chart({ ...fixture, solarTime: 'mean' });
    const expectedLongitude = (-118.2437 - 15 * -8) * 4; // standard (non-DST) meridian

    expect(mean.diagnostics.longitudeCorrectionMinutes).toBeCloseTo(expectedLongitude, 2);
    const shift = wallMinutes(mean.diagnostics.axisB_localSolarTime) - wallMinutes(off.diagnostics.axisB_localSolarTime);
    expect(Math.abs(shift - expectedLongitude)).toBeLessThanOrEqual(2);
  });

  it('applies to the horoscope TARGET instant too, not just the birth (both paths, consistently)', () => {
    const horoscope = (o: Record<string, unknown>) => calculateZiweiHoroscope(parseZiweiHoroscopeInput(o));
    const base = {
      timezone: 'UTC', longitude: 0,
      solarDate: { year: 1990, month: 6, day: 15 }, clockTime: { hour: 8, minute: 0 },
      gender: 'male' as const,
    };
    // 2025-11-03 is the published +16.49-minute equation-of-time extreme. At longitude 0
    // under UTC (zero longitude correction), a target clock time of 12:44 sits 16
    // minutes shy of the 13:00 shichen (时辰) boundary: 'true' (longitude + equation of
    // time) crosses it, 'mean' (longitude only — zero here — equation of time discarded)
    // does not, and is therefore identical to 'off' in this fixture.
    const target = { solarDate: { year: 2025, month: 11, day: 3 }, clockTime: { hour: 12, minute: 44 } };

    const off = horoscope({ ...base, target, solarTime: 'off' });
    const mean = horoscope({ ...base, target, solarTime: 'mean' });
    const trueMode = horoscope({ ...base, target, solarTime: 'true' });

    expect(off.diagnostics.targetTimeIndex).toBe(6); // 午 (11:00-13:00)
    expect(mean.diagnostics.targetTimeIndex).toBe(6); // longitude correction is 0 here
    expect(trueMode.diagnostics.targetTimeIndex).toBe(7); // 未 (13:00-15:00) — eot alone crosses it

    // The horoscope path's own 'mean' discard-boundary warning (horoscope.ts, separate
    // code from the natal path's) must fire here too, and only for 'mean'.
    expect(off.diagnostics.warnings.some(w => w.includes('solarTime is "mean"'))).toBe(false);
    expect(trueMode.diagnostics.warnings.some(w => w.includes('solarTime is "mean"'))).toBe(false);
    expect(mean.diagnostics.warnings.some(w => w.includes('solarTime is "mean"'))).toBe(true);
  });

  it('warns (only under "mean") when the discarded equation of time alone crosses a 时辰 boundary; trueSolarNote never calls it "True Solar Time"', () => {
    // Same eot-extreme / zero-longitude fixture as the horoscope test above, but on the
    // natal path: 'off' never crosses (no correction at all); 'true' crosses via the
    // full correction and stays silent on the 0.3.0 "mean discards eot" warning (it
    // doesn't discard anything); only 'mean' discards exactly the margin that mattered
    // here, so only 'mean' gets both the warning AND a trueSolarNote that (per item 6)
    // must not call itself "True Solar Time" or break out a "longitude + equation of
    // time" total, since only longitude was actually applied.
    const fixture = {
      timezone: 'UTC', longitude: 0,
      solarDate: { year: 2023, month: 11, day: 3 }, clockTime: { hour: 12, minute: 44 },
      gender: 'male' as const,
    };
    const off = chart({ ...fixture, solarTime: 'off' });
    const mean = chart({ ...fixture, solarTime: 'mean' });
    const trueMode = chart({ ...fixture, solarTime: 'true' });

    expect(off.lunar.timeIndex).toBe(6);
    expect(mean.lunar.timeIndex).toBe(6); // longitude alone doesn't move it
    expect(trueMode.lunar.timeIndex).toBe(7); // full correction does

    expect(off.diagnostics.warnings.some(w => w.includes('solarTime is "mean"'))).toBe(false);
    expect(trueMode.diagnostics.warnings.some(w => w.includes('solarTime is "mean"'))).toBe(false);
    const meanWarning = mean.diagnostics.warnings.find(w => w.includes('solarTime is "mean"'));
    expect(meanWarning).toBeDefined();
    expect(meanWarning).toContain('longitude correction (0.0 minutes) was applied');
    expect(meanWarning).toMatch(/equation of time \(1[67]\.\d minutes\) was NOT applied/);

    // trueSolarNote fires only when the APPLIED correction moves the birth relative to
    // the uncorrected clock. Here the longitude correction is zero, so 'mean' (longitude
    // only) doesn't move it — no trueSolarNote for 'mean' in THIS fixture (the discard
    // warning above is what discloses it instead). 'true' does move it (the full
    // correction includes the equation of time), so it alone gets a trueSolarNote.
    expect(off.diagnostics.trueSolarNote).toBeUndefined();
    expect(mean.diagnostics.trueSolarNote).toBeUndefined();
    expect(trueMode.diagnostics.trueSolarNote).toBeDefined();
    expect(trueMode.diagnostics.trueSolarNote).toContain('True Solar Time correction moved');
  });

  it('trueSolarNote under "mean" itself crossing a boundary: names local mean solar time, not "True Solar Time"', () => {
    // Same Xinjiang-under-Beijing-time fixture as invariant.test.ts's trueSolarNote
    // suite (longitude correction alone, -129.5 min, crosses two 时辰 boundaries) — here
    // 'mean' itself (not just 'true') is the one crossing, so it gets its own
    // trueSolarNote, worded per item 6: it must call itself "local mean solar time",
    // not "True Solar Time", and must not break the correction into a "longitude +
    // equation of time" total, since only longitude was actually applied.
    const mean = chart({
      solarDate: { year: 1990, month: 6, day: 15 }, clockTime: { hour: 8, minute: 0 },
      timezone: 'Asia/Shanghai', longitude: 87.6168, gender: 'male', solarTime: 'mean',
    });
    expect(mean.lunar.timeIndex).toBe(2); // 寅 — same as 'true' gives for this fixture
    expect(mean.diagnostics.trueSolarNote).toBeDefined();
    expect(mean.diagnostics.trueSolarNote).toContain('Local mean solar time');
    expect(mean.diagnostics.trueSolarNote).toContain("solarTime:'mean'");
    expect(mean.diagnostics.trueSolarNote).not.toContain('True Solar Time correction moved');
    expect(mean.diagnostics.trueSolarNote).not.toMatch(/-?\d+\.\d minutes \(-?\d+\.\d longitude \+/);
    // No "mean discards eot" warning here: the eot at this date (~mid-June) is tiny
    // (see the SITES test above, June 13 is a published zero-crossing) and does not
    // cross a boundary on its own.
    expect(mean.diagnostics.warnings.some(w => w.includes('solarTime is "mean"'))).toBe(false);
  });
});

describe('solarTime / trueSolar alias reconciliation (0.3.0)', () => {
  const base = {
    timezone: 'Asia/Shanghai', longitude: 87.6168,
    solarDate: { year: 1990, month: 6, day: 15 }, clockTime: { hour: 8, minute: 0 },
    gender: 'male' as const,
  };

  it('solarTime omitted, solarTime:"true", and the deprecated trueSolar:true alias are byte-identical', () => {
    const omitted = chart(base);
    expect(chart({ ...base, solarTime: 'true' })).toEqual(omitted);
    expect(chart({ ...base, trueSolar: true })).toEqual(omitted);
  });

  it('solarTime:"off" and the deprecated trueSolar:false alias are byte-identical', () => {
    const off = chart({ ...base, solarTime: 'off' });
    expect(chart({ ...base, trueSolar: false })).toEqual(off);
  });

  it('rejects trueSolar/solarTime disagreement, accepts agreement (including with "mean")', () => {
    const schemaBase = { place: 'Beijing', solarDate: base.solarDate, clockTime: base.clockTime, gender: base.gender };
    expect(() => ZiweiInputSchema.parse({ ...schemaBase, solarTime: 'true', trueSolar: false })).toThrow(/disagree/);
    expect(() => ZiweiInputSchema.parse({ ...schemaBase, solarTime: 'off', trueSolar: true })).toThrow(/disagree/);
    expect(() => ZiweiInputSchema.parse({ ...schemaBase, solarTime: 'mean', trueSolar: true })).toThrow(/disagree/);
    expect(ZiweiInputSchema.safeParse({ ...schemaBase, solarTime: 'true', trueSolar: true }).success).toBe(true);
    expect(ZiweiInputSchema.safeParse({ ...schemaBase, solarTime: 'off', trueSolar: false }).success).toBe(true);
    expect(ZiweiInputSchema.safeParse({ ...schemaBase, solarTime: 'mean' }).success).toBe(true);
  });
});
