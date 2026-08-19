import { describe, it, expect } from 'bun:test';
import { calculateZiweiChart } from '../src/core/chart';
import { ZiweiInputSchema } from '../src/schemas/input';
import { ganZhiOfLunarYear } from '../src/core/lunar';
import type { ZiweiInput, ValidatedZiweiInput } from '../src/types';
import {
  G, M, idx, soulPalace, bodyPalace, palaceStem, fiveClass, ziweiPalace,
  PALACE_NAMES, FIVE_CLASS_LABEL, findStarTrimmed, makeRandom,
} from './ziwei-rules';

const chart = (input: ZiweiInput) => calculateZiweiChart(ZiweiInputSchema.parse(input) as ValidatedZiweiInput);

/**
 * Global multi-region suite, ported from bazi-mcp. The two projects share the time
 * layer verbatim, so the utcOffset / longitudeCorrectionMinutes expectations carry
 * over unchanged; the four-pillar assertions are rewritten as the Ziwei equivalents
 * (year ganzhi, shichen/timeIndex, 命宫支, 五行局, 紫微所在宫).
 */
describe('Global multi-region: China', () => {
  // Kashgar is 44° west of the UTC+8 standard meridian: ~176 minutes behind Beijing
  // time. A 13:30 clock time (nominally 未) is really 10:35 solar — the 巳 hour.
  it('extreme west: Kashgar (~3 hours of longitude delay moves the shichen by two)', () => {
    const res = chart({
      place: 'Kashgar', timezone: 'Asia/Shanghai',
      solarDate: { year: 2024, month: 6, day: 1 }, clockTime: { hour: 13, minute: 30 }, gender: 'male',
    });
    expect(res.diagnostics.longitudeCorrectionMinutes).toBeLessThan(-170);
    expect(res.lunar.shichen).toBe('巳');
    expect(res.lunar.timeIndex).toBe(5);
    expect(res.diagnostics.yearGanZhi).toBe('甲辰');
  });

  it('extreme east: Harbin (longitude ~26 minutes ahead pushes 06:40 into 辰)', () => {
    const res = chart({
      place: 'Harbin', solarDate: { year: 2024, month: 10, day: 1 }, clockTime: { hour: 6, minute: 40 }, gender: 'male',
    });
    expect(res.diagnostics.longitudeCorrectionMinutes).toBeGreaterThan(20);
    expect(res.lunar.shichen).toBe('辰');
    expect(res.lunar.timeIndex).toBe(4);
  });

  it('highest altitude: Lhasa (~2 hours of longitude offset)', () => {
    const res = chart({
      place: 'Lhasa', solarDate: { year: 2024, month: 5, day: 20 }, clockTime: { hour: 12, minute: 30 }, gender: 'female',
    });
    expect(res.lunar.shichen).toBe('巳');
    expect(res.diagnostics.longitudeCorrectionMinutes).toBeCloseTo(-115.6, 0);
  });

  it('extreme south: Sanya (tropical island, on Beijing civil time)', () => {
    const res = chart({
      place: 'Sanya', solarDate: { year: 2024, month: 8, day: 15 }, clockTime: { hour: 12, minute: 0 }, gender: 'male',
    });
    expect(res.diagnostics.wallClock).toContain('Asia/Shanghai');
    expect(res.palaces).toHaveLength(12);
  });

  it('Hong Kong and Taipei keep their own IANA zones', () => {
    const hk = chart({ place: 'Hong Kong', solarDate: { year: 2023, month: 1, day: 1 }, clockTime: { hour: 9, minute: 30 }, gender: 'male' });
    expect(hk.diagnostics.wallClock).toContain('Asia/Hong_Kong');
    // 2023-01-01 is before 立春 2023, so the year ganzhi is still 壬寅, not 癸卯.
    expect(hk.diagnostics.yearGanZhi).toBe('壬寅');

    const tw = chart({ place: 'Taipei', solarDate: { year: 2023, month: 1, day: 1 }, clockTime: { hour: 9, minute: 30 }, gender: 'female' });
    expect(tw.diagnostics.wallClock).toContain('Asia/Taipei');
    expect(tw.diagnostics.yearGanZhi).toBe('壬寅');
  });

  it('Chengdu and Wuhan longitude corrections', () => {
    expect(chart({ place: 'Chengdu', solarDate: { year: 2024, month: 3, day: 15 }, clockTime: { hour: 12, minute: 0 }, gender: 'male' })
      .diagnostics.longitudeCorrectionMinutes).toBeCloseTo(-63.7, 0);
    expect(chart({ place: 'Wuhan', solarDate: { year: 2024, month: 3, day: 15 }, clockTime: { hour: 12, minute: 0 }, gender: 'male' })
      .diagnostics.longitudeCorrectionMinutes).toBeCloseTo(-22.9, 0);
  });
});

describe('Global multi-region: worldwide UTC offsets and DST', () => {
  const cases: Array<[string, ZiweiInput, string]> = [
    ['New York (EDT)', { place: 'New York', solarDate: { year: 2024, month: 7, day: 15 }, clockTime: { hour: 14, minute: 0 }, gender: 'male' }, '-04:00 (DST in effect)'],
    ['Los Angeles (PST)', { place: 'Los Angeles, CA', solarDate: { year: 2024, month: 1, day: 15 }, clockTime: { hour: 14, minute: 0 }, gender: 'female' }, '-08:00'],
    ['Chicago (CDT)', { place: 'Chicago', solarDate: { year: 2024, month: 5, day: 1 }, clockTime: { hour: 10, minute: 0 }, gender: 'male' }, '-05:00 (DST in effect)'],
    ['Phoenix (no DST)', { place: 'Phoenix', solarDate: { year: 2024, month: 7, day: 1 }, clockTime: { hour: 12, minute: 0 }, gender: 'male' }, '-07:00'],
    ["St. John's (UTC-3:30)", { place: "St. John's", solarDate: { year: 2024, month: 1, day: 15 }, clockTime: { hour: 12, minute: 0 }, gender: 'male' }, '-03:30'],
    ['London (BST)', { place: 'London, United Kingdom', solarDate: { year: 2024, month: 6, day: 21 }, clockTime: { hour: 12, minute: 0 }, gender: 'male' }, '+01:00 (DST in effect)'],
    ['Paris (CET)', { place: 'Paris', solarDate: { year: 2024, month: 2, day: 1 }, clockTime: { hour: 15, minute: 30 }, gender: 'female' }, '+01:00'],
    ['Moscow (UTC+3)', { place: 'Moscow', solarDate: { year: 2024, month: 5, day: 9 }, clockTime: { hour: 10, minute: 0 }, gender: 'male' }, '+03:00'],
    ['Vladivostok (UTC+10)', { place: 'Vladivostok', solarDate: { year: 2024, month: 8, day: 1 }, clockTime: { hour: 14, minute: 0 }, gender: 'male' }, '+10:00'],
    ['Reykjavik (UTC+0, no DST)', { place: 'Reykjavík', solarDate: { year: 2024, month: 7, day: 1 }, clockTime: { hour: 12, minute: 0 }, gender: 'male' }, '+00:00'],
    ['Tokyo (UTC+9)', { place: 'Tokyo', solarDate: { year: 2024, month: 4, day: 8 }, clockTime: { hour: 11, minute: 30 }, gender: 'female' }, '+09:00'],
    ['Seoul (UTC+9)', { place: 'Seoul', solarDate: { year: 2024, month: 10, day: 1 }, clockTime: { hour: 14, minute: 0 }, gender: 'male' }, '+09:00'],
    ['Singapore (UTC+8)', { place: 'Singapore', solarDate: { year: 2024, month: 8, day: 9 }, clockTime: { hour: 12, minute: 0 }, gender: 'male' }, '+08:00'],
    ['New Delhi (UTC+5:30)', { place: 'New Delhi', solarDate: { year: 2024, month: 1, day: 26 }, clockTime: { hour: 12, minute: 0 }, gender: 'male' }, '+05:30'],
    ['Mumbai (UTC+5:30)', { place: 'Mumbai', solarDate: { year: 2024, month: 1, day: 26 }, clockTime: { hour: 12, minute: 0 }, gender: 'female' }, '+05:30'],
    ['Dubai (UTC+4)', { place: 'Dubai', solarDate: { year: 2024, month: 11, day: 1 }, clockTime: { hour: 13, minute: 0 }, gender: 'male' }, '+04:00'],
    ['Sydney summer (AEDT)', { place: 'Sydney, Australia', solarDate: { year: 2024, month: 1, day: 10 }, clockTime: { hour: 15, minute: 0 }, gender: 'male' }, '+11:00 (DST in effect)'],
    ['Sydney winter (AEST)', { place: 'Sydney, Australia', solarDate: { year: 2024, month: 7, day: 10 }, clockTime: { hour: 15, minute: 0 }, gender: 'male' }, '+10:00'],
    ['Perth (UTC+8, no DST)', { place: 'Perth, Australia', solarDate: { year: 2024, month: 1, day: 10 }, clockTime: { hour: 12, minute: 0 }, gender: 'female' }, '+08:00'],
    ['Auckland (NZDT)', { place: 'Auckland', solarDate: { year: 2024, month: 12, day: 25 }, clockTime: { hour: 12, minute: 0 }, gender: 'male' }, '+13:00 (DST in effect)'],
    ['São Paulo (UTC-3)', { place: 'São Paulo', solarDate: { year: 2024, month: 3, day: 20 }, clockTime: { hour: 11, minute: 0 }, gender: 'male' }, '-03:00'],
    ['Buenos Aires (UTC-3)', { place: 'Buenos Aires', solarDate: { year: 2024, month: 5, day: 25 }, clockTime: { hour: 16, minute: 0 }, gender: 'female' }, '-03:00'],
    ['Johannesburg (UTC+2)', { place: 'Johannesburg', solarDate: { year: 2024, month: 9, day: 20 }, clockTime: { hour: 8, minute: 30 }, gender: 'male' }, '+02:00'],
    ['Cairo (EEST)', { place: 'Cairo', solarDate: { year: 2024, month: 6, day: 1 }, clockTime: { hour: 12, minute: 0 }, gender: 'male' }, '+03:00 (DST in effect)'],
  ];

  for (const [name, input, expectedOffset] of cases) {
    it(`${name} resolves to ${expectedOffset}`, () => {
      const res = chart(input);
      expect(res.diagnostics.utcOffset).toBe(expectedOffset);
      expect(res.palaces).toHaveLength(12);
      expect(res.lunar.timeIndex).toBeGreaterThanOrEqual(0);
      expect(res.lunar.timeIndex).toBeLessThanOrEqual(12);
    });
  }

  it('extreme geography: date line, half-hour and three-quarter-hour offsets', () => {
    const adak = chart({ place: 'Adak, Alaska', longitude: -176.65, timezone: 'America/Adak', solarDate: { year: 2000, month: 6, day: 21 }, clockTime: { hour: 12, minute: 0 }, gender: 'male' });
    expect(adak.diagnostics.wallClock).toContain('America/Adak');

    const chatham = chart({ place: 'Chatham Islands', longitude: -176.5, timezone: 'Pacific/Chatham', solarDate: { year: 2024, month: 1, day: 1 }, clockTime: { hour: 12, minute: 0 }, gender: 'female' });
    expect(chatham.diagnostics.utcOffset).toBe('+13:45 (DST in effect)');

    const kiritimati = chart({ place: 'Kiritimati', longitude: -157.36, timezone: 'Pacific/Kiritimati', solarDate: { year: 2000, month: 1, day: 1 }, clockTime: { hour: 12, minute: 0 }, gender: 'male' });
    expect(kiritimati.diagnostics.utcOffset).toBe('+14:00');

    const kathmandu = chart({ place: 'Kathmandu', longitude: 85.32, timezone: 'Asia/Kathmandu', solarDate: { year: 2024, month: 6, day: 15 }, clockTime: { hour: 12, minute: 0 }, gender: 'female' });
    expect(kathmandu.diagnostics.utcOffset).toBe('+05:45');

    const fiji = chart({ place: 'Suva', longitude: 178.4415, timezone: 'Pacific/Fiji', solarDate: { year: 2024, month: 2, day: 10 }, clockTime: { hour: 14, minute: 30 }, gender: 'female' });
    expect(fiji.diagnostics.longitudeCorrectionMinutes).toBeLessThan(0);
  });

  it('historical mid-year base-offset shifts survive the +/-6-month standard-offset probe', () => {
    // Moscow moved its base offset from +3 to +2 on 1922-10-01. A naive "sample January"
    // standard-offset guess gets this wrong by an hour.
    const moscow = chart({
      timezone: 'Europe/Moscow', longitude: 37.6173,
      solarDate: { year: 1922, month: 11, day: 9 }, clockTime: { hour: 23, minute: 0 }, gender: 'male',
    });
    expect(moscow.diagnostics.utcOffset).toBe('+02:00');
    expect(moscow.diagnostics.axisB_localTrueSolarTime).toBe('1922-11-09 23:46');
    expect(moscow.lunar.timeIndex).toBe(12); // 晚子时
    expect(moscow.lunar.shichen).toBe('子');
    expect(moscow.diagnostics.yearGanZhi).toBe('壬戌');

    // US War Time: Phoenix 1944 was on MST (UTC-7), not war time, at this instant.
    const phoenix = chart({
      timezone: 'America/Phoenix', longitude: -112.074,
      solarDate: { year: 1944, month: 2, day: 4 }, clockTime: { hour: 4, minute: 9 }, gender: 'male',
    });
    expect(phoenix.diagnostics.utcOffset).toBe('-07:00');
    expect(phoenix.diagnostics.axisB_localTrueSolarTime).toBe('1944-02-04 03:26');
    expect(phoenix.lunar.shichen).toBe('寅');
    // 立春 1944 was 1944-02-05, so this birth is still in 癸未.
    expect(phoenix.diagnostics.yearGanZhi).toBe('癸未');
  });

  /**
   * Year-range floor. bazi-mcp accepts 1800-2100; this project accepts 1900-2100
   * because that is the range lunar-lite's calendar tables actually cover. The two
   * layers (schema + engine) must agree on the same bound, so the schema rejection
   * and an executable chart at the boundary are both asserted.
   */
  it('year bounds: 1900 and 2100 are executable, 1899 and 2101 are rejected by the schema', () => {
    for (const year of [1900, 2100]) {
      const res = chart({ timezone: 'Asia/Shanghai', longitude: 120, solarDate: { year, month: 6, day: 15 }, clockTime: { hour: 12, minute: 0 }, gender: 'male' });
      expect(res.palaces).toHaveLength(12);
    }
    for (const year of [1899, 2101]) {
      expect(ZiweiInputSchema.safeParse({
        timezone: 'Asia/Shanghai', longitude: 120, solarDate: { year, month: 6, day: 15 },
        clockTime: { hour: 12, minute: 0 }, gender: 'male',
      }).success).toBe(false);
    }
  });
});

/**
 * ── Differential batteries ───────────────────────────────────────────────────
 *
 * These do NOT exist in bazi-mcp (grep confirms; spec §8.2's "600 例 / 800 例" counts
 * were aspirational). Written fresh here.
 *
 * There is no external oracle for arbitrary birth instants, so instead every chart is
 * checked for INTERNAL consistency against the independent classical rules in
 * tests/ziwei-rules.ts: given only what the time layer resolved to (year ganzhi, lunar
 * month/day, timeIndex), the entire palace and star layout is re-derived and compared.
 * That catches any drift where the time layer and the star layer stop agreeing —
 * which is precisely the failure mode of the Z1/Z2 bypass this project is built around.
 *
 * Two rules make the batteries honest:
 *   (a) star-placement checks are skipped for leap months — the parity baseline never
 *       validated leap placement, so asserting it here would be inventing an oracle;
 *   (b) thrown errors are CLASSIFIED. Only DST gaps and unresolved folds are tolerated
 *       (they are correct refusals). Any other error fails the battery — blanket
 *       swallowing is what would have hidden the probe-findings P2a crash class.
 */
function runBattery(
  label: string,
  zones: Array<[string, number]>,
  samplesPerZone: number,
  seed: number
): { charts: number; tolerated: number; knownDefect: string[]; failures: string[] } {
  const rnd = makeRandom(seed);
  const failures: string[] = [];
  const knownDefect: string[] = [];
  let charts = 0;
  let tolerated = 0;

  for (const [timezone, longitude] of zones) {
    for (let i = 0; i < samplesPerZone; i++) {
      const year = 1920 + Math.floor(rnd() * 105);
      const month = 1 + Math.floor(rnd() * 12);
      const day = 1 + Math.floor(rnd() * 28);
      const hour = Math.floor(rnd() * 24);
      const minute = Math.floor(rnd() * 60);
      const gender = rnd() < 0.5 ? 'male' : 'female';
      const tag = `[${label} ${timezone} ${year}-${month}-${day} ${hour}:${minute}]`;

      let res;
      try {
        res = chart({ timezone, longitude, solarDate: { year, month, day }, clockTime: { hour, minute }, gender });
      } catch (err) {
        const msg = (err as Error).message;
        // Correct refusals: the wall clock genuinely did not exist, or genuinely
        // happened twice and the caller did not say which.
        if (msg.includes('DST spring-forward gap') || msg.includes('DST fall-back overlap')) {
          tolerated++;
          continue;
        }
        // Bucketed separately so this known upstream defect produces one clear
        // battery failure instead of masquerading as a consistency failure. See
        // the dedicated reproduction in tests/boundary.test.ts.
        if (msg.includes('only 29 days in lunar year')) {
          knownDefect.push(`${tag} ${msg.slice(0, 140)}`);
          continue;
        }
        failures.push(`${tag} unexpected error: ${msg.slice(0, 160)}`);
        continue;
      }
      charts++;

      const ys = res.diagnostics.yearGanZhi[0];
      const { month: lm, day: ld, timeIndex: ti, isLeapMonth } = res.lunar;
      const push = (cond: boolean, what: string) => { if (!cond) failures.push(`${tag} ${what}`); };

      // Time layer <-> feed year: the whole Z1 bypass rests on the fed lunar year
      // reproducing the independently determined ganzhi.
      push(ganZhiOfLunarYear(res.diagnostics.feedYear) === res.diagnostics.yearGanZhi,
        `feedYear ${res.diagnostics.feedYear} has ganzhi ${ganZhiOfLunarYear(res.diagnostics.feedYear)}, expected ${res.diagnostics.yearGanZhi}`);

      // Structure
      push(res.palaces.length === 12, 'palace count');
      push(new Set(res.palaces.map(p => p.branch)).size === 12, 'duplicate palace branches');
      push(new Set(res.palaces.map(p => p.name)).size === 12, 'duplicate palace names');
      push(ti >= 0 && ti <= 12, `timeIndex out of range: ${ti}`);
      push(res.palaces.filter(p => p.isBodyPalace).length === 1, 'body palace count');
      push(res.palaces.find(p => p.isBodyPalace)!.branch === res.bodyPalace.branch, 'body palace branch mismatch');

      const sp = idx(res.soulPalace.branch);

      // 十二宫名 direction — (命宫 - 本宫) mod 12 by earthly branch.
      for (const p of res.palaces) {
        push(p.name === PALACE_NAMES[M(sp - idx(p.branch))], `宫名@${p.branch} was ${p.name}`);
        push(p.stem === G[palaceStem(ys, idx(p.branch))], `宫干@${p.branch} was ${p.stem}`);
      }

      // 五行局 <-> 命宫 decadal start age
      const fc = fiveClass(ys, sp);
      push(res.fiveElementsClass === FIVE_CLASS_LABEL[fc.n], `五行局 was ${res.fiveElementsClass}, expected ${FIVE_CLASS_LABEL[fc.n]}`);
      push(res.palaces.find(p => p.name === '命宫')!.decadal.ageRange[0] === fc.n, '命宫大限起始年龄');

      // Star placement — skipped for leap months (see rule (a) above).
      if (!isLeapMonth) {
        push(sp === soulPalace(lm, ti), `命宫 was ${res.soulPalace.branch}`);
        push(idx(res.bodyPalace.branch) === bodyPalace(lm, ti), `身宫 was ${res.bodyPalace.branch}`);
        push(findStarTrimmed(res, '紫微') === ziweiPalace(fc.n, ld), '紫微');
        push(findStarTrimmed(res, '文昌') === M(10 - ti), '文昌');
        push(findStarTrimmed(res, '文曲') === M(4 + ti), '文曲');
      }
    }
  }
  return { charts, tolerated, knownDefect, failures };
}

describe('Differential battery: 20 mainstream timezones', () => {
  const REGULAR: Array<[string, number]> = [
    ['Asia/Shanghai', 116.4074], ['Asia/Hong_Kong', 114.1694], ['Asia/Taipei', 121.5654],
    ['Asia/Tokyo', 139.6917], ['Asia/Seoul', 126.978], ['Asia/Singapore', 103.8198],
    ['Asia/Bangkok', 100.5018], ['Asia/Dubai', 55.2708], ['Europe/London', -0.1276],
    ['Europe/Paris', 2.3522], ['Europe/Berlin', 13.405], ['Europe/Moscow', 37.6173],
    ['America/New_York', -74.006], ['America/Chicago', -87.6298], ['America/Denver', -104.9903],
    ['America/Los_Angeles', -118.2437], ['America/Sao_Paulo', -46.6333], ['Africa/Johannesburg', 28.0473],
    ['Australia/Sydney', 151.2093], ['Pacific/Auckland', 174.7633],
  ];

  it('600 seeded charts stay internally consistent with the classical rules', () => {
    const { charts, tolerated, knownDefect, failures } = runBattery('regular', REGULAR, 30, 19700101);
    expect(failures.slice(0, 20)).toEqual([]);
    expect(knownDefect).toEqual([]);
    expect(charts + tolerated + knownDefect.length).toBe(600);
    expect(charts).toBeGreaterThan(550);
  });
});

describe('Differential battery: 20 pathological timezones', () => {
  /**
   * Date-line crossers, quarter- and three-quarter-hour offsets, UTC+14 and UTC-11
   * extremes, zones with historically violent offset changes (Shanghai's LMT era,
   * Moscow 1922, Phoenix war time, Kiritimati's 1994 date-line jump, Samoa's 2011
   * skipped day, Kazakhstan's 2024 unification), and the world's most aggressive
   * southern-hemisphere DST rules.
   */
  const PATHOLOGICAL: Array<[string, number]> = [
    ['Pacific/Kiritimati', -157.36], ['Pacific/Apia', -171.7667], ['Pacific/Chatham', -176.5],
    ['Pacific/Fiji', 178.4415], ['Pacific/Tongatapu', -175.2], ['Pacific/Marquesas', -139.6],
    ['America/Adak', -176.65], ['America/St_Johns', -52.71], ['America/Santiago', -70.6693],
    ['Asia/Kathmandu', 85.324], ['Asia/Kolkata', 77.209], ['Asia/Yangon', 96.1951],
    ['Asia/Tehran', 51.389], ['Asia/Kabul', 69.2075], ['Asia/Almaty', 76.8512],
    ['Asia/Urumqi', 87.575], ['Australia/Eucla', 128.8806], ['Australia/Lord_Howe', 159.0776],
    ['Antarctica/Troll', 2.5333], ['Europe/Lisbon', -9.1393],
  ];

  it('800 seeded charts stay internally consistent with the classical rules', () => {
    const { charts, tolerated, knownDefect, failures } = runBattery('pathological', PATHOLOGICAL, 40, 19940101);
    expect(failures.slice(0, 20)).toEqual([]);
    // EXPECTED TO FAIL: hits the 闰月三十 defect (1952-07-21 = 1952 闰五月三十).
    expect(knownDefect).toEqual([]);
    expect(charts + tolerated + knownDefect.length).toBe(800);
    expect(charts).toBeGreaterThan(700);
  });

  it('produces a chart on both sides of the international date line for one UTC instant', () => {
    // 1994-12-31T10:00:00Z. Kiritimati skipped 1994-12-31 entirely when it jumped the
    // date line, so this instant is 1995-01-01 00:00 there but 1994-12-31 in Honolulu.
    const kiritimati = chart({
      timezone: 'Pacific/Kiritimati', longitude: -157.36,
      solarDate: { year: 1995, month: 1, day: 1 }, clockTime: { hour: 0, minute: 0 }, gender: 'male',
    });
    const honolulu = chart({
      timezone: 'Pacific/Honolulu', longitude: -157.8583,
      solarDate: { year: 1994, month: 12, day: 31 }, clockTime: { hour: 0, minute: 0 }, gender: 'male',
    });
    expect(kiritimati.diagnostics.utcInstant).toBe('1994-12-31T10:00:00.000Z');
    expect(honolulu.diagnostics.utcInstant).toBe('1994-12-31T10:00:00.000Z');
    // Same instant, same near-identical longitude => same year ganzhi and the same
    // local true solar time, despite the calendar dates differing by a day.
    expect(kiritimati.diagnostics.yearGanZhi).toBe(honolulu.diagnostics.yearGanZhi);
    expect(kiritimati.lunar.timeIndex).toBe(honolulu.lunar.timeIndex);
  });
});
