import { describe, it, expect } from 'bun:test';
import { calculateZiweiChart } from '../src/core/chart';
import { ZiweiInputSchema } from '../src/schemas/input';
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
      // Same physical correction reported in both modes — trueSolar only toggles
      // whether it's applied to the chart (convention.trueSolar), not what's reported.
      expect(off.diagnostics.longitudeCorrectionMinutes, name).toBeCloseTo(on.diagnostics.longitudeCorrectionMinutes, 6);
      expect(off.diagnostics.convention.trueSolar, name).toBe(false);
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
      // `axisB_localTrueSolarTime` is minute-precision with the seconds dropped
      // (src/core/time-index.ts parses only HH:MM out of the library's
      // second-precision string), so ~90s of slack is structural. bazi's version
      // of this test reads a second-precision field and can afford 60s. Two
      // minutes is still two orders of magnitude tighter than any sign error:
      // inverting the equation of time here is an ~18-minute excursion.
      const reported = atNoon.diagnostics.axisB_localTrueSolarTime.slice(11);
      const [h, m] = reported.split(':').map(Number);
      const minutesFromNoon = Math.abs(h * 60 + m - 12 * 60);
      expect(minutesFromNoon, `${name} reported ${reported}`).toBeLessThanOrEqual(2);
    }
  });
});
