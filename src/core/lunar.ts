import { lunar2solar as lunar2solarRaw, solar2lunar, getTotalDaysOfLunarMonth } from 'lunar-lite';

export { solar2lunar };

/**
 * Wraps lunar-lite's own `lunar2solar` to fix a bug in lunar-lite itself (not just
 * iztro — iztro's `type:'lunar'` entry point turns out to call this exact same
 * function under the hood, see node_modules/iztro/lib/astro/astro.js:268 and
 * FunctionalAstrolabe.js:299, both `lunar2solar(dateStr, isLeapMonth)`): for a
 * genuine 闰月三十 (leap-month 30th day), it validates `lunarDay` against the
 * NON-leap twin month's day count and throws "only 29 days in lunar year Y month M"
 * even though the leap month genuinely has 30 days that day (verified: days 1-29 of
 * 2017's leap 6th month all resolve fine via lunar2solar; only day 30 throws, and
 * solar2lunar independently confirms solar 2017-08-21 IS 闰六月三十). 17 such days
 * exist between 1900-2100 (e.g. 2017-08-21) — this is the same defect that also
 * crashes iztro's `type:'lunar'` entry point, just hit here from our own conversion
 * of a caller-supplied `lunarDate` into a wall-clock solar date, which iztro's
 * `type:'solar'` workaround (see chart.ts) doesn't cover since it isn't invoking
 * iztro at all at this point. Work around it the same way: days 1..N of the leap
 * month resolve fine (N = the twin month's length from the error message), and the
 * leap month's days are contiguous on the solar calendar, so day N+1's solar date
 * is guessed as exactly one calendar day after day N's — then verified by
 * round-tripping through solar2lunar before being trusted (a leap month can
 * itself be short too, e.g. 29 days; in that case N+1 doesn't exist there
 * either and the guess would silently land on the 1st of the FOLLOWING lunar
 * month instead, which must be rejected rather than mislabeled as day N+1 of
 * the requested leap month).
 */
export function lunar2solar(dateStr: string, isLeapMonth = false): ReturnType<typeof lunar2solarRaw> {
  try {
    return lunar2solarRaw(dateStr, isLeapMonth);
  } catch (err) {
    const match = /only (\d+) days in lunar year (-?\d+) month (\d+)/.exec((err as Error).message);
    const [yearStr, monthStr, dayStr] = dateStr.split(/[-/]/);
    const month = Number(monthStr);
    const day = Number(dayStr);
    // Only handle the exact off-by-one leap-day-30 case; anything else (e.g. a
    // genuinely out-of-range day, or the leap month itself being too short —
    // that error carries a *negative* month number from lunar-lite's internal
    // leap-month representation and won't match this pattern) should still
    // surface as an error.
    if (!isLeapMonth || !match || day !== Number(match[1]) + 1) throw err;
    const base = lunar2solarRaw(`${yearStr}-${month}-${match[1]}`, true);
    const next = new Date(Date.UTC(base.solarYear, base.solarMonth - 1, base.solarDay + 1));
    const solarYear = next.getUTCFullYear();
    const solarMonth = next.getUTCMonth() + 1;
    const solarDay = next.getUTCDate();
    const roundTrip = solar2lunar(`${solarYear}-${pad(solarMonth)}-${pad(solarDay)}`);
    if (!roundTrip.isLeap || roundTrip.lunarMonth !== month || roundTrip.lunarDay !== day) throw err;
    return { solarYear, solarMonth, solarDay, toString: () => `${solarYear}-${solarMonth}-${solarDay}` };
  }
}

const STEMS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'] as const;
const BRANCHES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'] as const;

/**
 * Sexagenary (ganzhi) pair for iztro/lunar-lite's *numbered* lunar year (e.g. lunar
 * year 2000 -> 庚辰), i.e. the ganzhi you'd get under yearDivide:'lunar_new_year'
 * (正月初一 boundary). Anchored at 1984 = 甲子, matching iztro's own lunar tables —
 * verified against docs/parity-reference.mjs (0 mismatches across 800 random charts).
 *
 * This is also the formula used to test candidate "feed years" in
 * lunarYearForGanZhi below: two years 60 apart always share a ganzhi.
 */
export function ganZhiOfLunarYear(lunarYear: number): string {
  const stem = STEMS[((lunarYear - 1984) % 10 + 10) % 10];
  const branch = BRANCHES[((lunarYear - 1984) % 12 + 12) % 12];
  return stem + branch;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * True iff lunar year `y` actually has a leap `lunarMonth`. Round-trip through
 * solar and back, because lunar-lite's own `getLeapMonth`/`getLeapDays` (lib/leap.ts)
 * reference a `LUNAR_INFO` constant that doesn't exist in lunar-lite@0.2.8's
 * constants.ts and throw at runtime (same underlying bug as monthHasEnoughDays
 * below) — never call them. `lunar2solar(..., true)` silently ignores the leap
 * flag and returns the ordinary month's date when no such leap month exists
 * (e.g. `lunar2solar('2021-4-15', true)` === `lunar2solar('2021-4-15', false)`),
 * so the only way to detect "this leap month doesn't exist" is to convert back
 * to lunar and check whether the round trip actually landed on a leap month.
 */
function leapMonthExists(lunarYear: number, lunarMonth: number): boolean {
  const solar = lunar2solar(`${lunarYear}-${lunarMonth}-1`, true);
  const back = solar2lunar(`${solar.solarYear}-${pad(solar.solarMonth)}-${pad(solar.solarDay)}`);
  return back.isLeap && back.lunarMonth === lunarMonth;
}

/**
 * Finds which month (if any) is lunar year `y`'s actual leap month, for use in
 * the leapMonthExists rejection error below. A lunar year has at most one leap
 * month, so this is just a linear scan.
 */
function actualLeapMonthOf(lunarYear: number): number | undefined {
  for (let m = 1; m <= 12; m++) {
    if (leapMonthExists(lunarYear, m)) return m;
  }
  return undefined;
}

/**
 * Rejects `isLeapMonth:true` inputs naming a leap month that doesn't exist (defect A).
 * Without this, `lunar2solar` silently ignores the leap flag and the service charts
 * the ordinary (non-leap) date instead, with the returned `lunar.isLeapMonth:false`
 * quietly contradicting what the caller asked for — the worst outcome for a
 * birth-chart service. bazi-mcp rejects the same input; we must too.
 */
export function assertLeapMonthExists(lunarYear: number, lunarMonth: number): void {
  if (leapMonthExists(lunarYear, lunarMonth)) return;
  const actual = actualLeapMonthOf(lunarYear);
  const detail = actual === undefined ? `${lunarYear} has no leap month at all` : `${lunarYear}'s only leap month is month ${actual}`;
  throw new Error(
    `Lunar year ${lunarYear} has no leap month ${lunarMonth} (isLeapMonth:true was requested for month ${lunarMonth}); ${detail}. Please double-check the birth record and either drop isLeapMonth or correct the month.`
  );
}

/**
 * True iff lunar year `y`'s month `lunarMonth` (non-leap) has at least `lunarDay` days.
 * Deliberately does NOT use lunar-lite's getLeapMonth/getLeapDays (lib/leap.ts) —
 * that pair references a `LUNAR_INFO` constant that does not exist anywhere in
 * lunar-lite@0.2.8's constants.ts and throws `undefined is not an object` at
 * runtime. This is a real bug in the installed version, not covered by
 * probe-findings.md. getTotalDaysOfLunarMonth (misc.ts) is unaffected — it goes
 * through lunar-typescript directly — so that's the only lunar-lite day-count
 * helper used anywhere in this project.
 */
function monthHasEnoughDays(lunarYear: number, lunarMonth: number, lunarDay: number): boolean {
  try {
    const solar = lunar2solar(`${lunarYear}-${lunarMonth}-1`, false);
    const total = getTotalDaysOfLunarMonth(`${solar.solarYear}-${solar.solarMonth}-${solar.solarDay}`);
    return total >= lunarDay;
  } catch {
    return false;
  }
}

/**
 * Finds a lunar year number to feed iztro (with config.yearDivide:'normal', per
 * spec §5 Z1) that produces the given target year ganzhi, while its target lunar
 * month actually has enough days for `lunarDay` (probe-findings P2a/P2b: a naive
 * `lunarYear ± 1` crashes iztro with "only 29 days in lunar year X month Y"
 * whenever a 立春-shifted 腊月三十 birth lands in a short lunar month — a real,
 * reachable path under yearDivide:'lichun', not a theoretical edge case).
 *
 * Ganzhi repeats every 60 years, so once a base year within ±1 of the caller's
 * own lunar year matches the target ganzhi, any year 60 years away also
 * matches; if the nearest one crashes, we search those for one whose target
 * month is long enough (P2b, verified: stripping the polluted calendar fields,
 * feeding year Y vs Y+60 produces byte-identical charts).
 */
export function lunarYearForGanZhi(
  targetGanZhi: string,
  lunarYear: number,
  lunarMonth: number,
  lunarDay: number,
  isLeapMonth: boolean
): number {
  let baseYear: number | undefined;
  for (const offset of [0, -1, 1]) {
    if (ganZhiOfLunarYear(lunarYear + offset) === targetGanZhi) {
      baseYear = lunarYear + offset;
      break;
    }
  }
  if (baseYear === undefined) {
    throw new Error(
      `Internal error: no lunar year within +/-1 of ${lunarYear} has ganzhi "${targetGanZhi}". This indicates a bug in year-ganzhi determination, not a bad input — please report it.`
    );
  }

  // No shift needed: the caller's own (already-valid) lunar date works as-is.
  if (baseYear === lunarYear) return lunarYear;

  // Shifted feed year: probe-findings P2c confirms this window (yearDivide:'lichun'
  // crossing the 立春<->正月初一 gap) only ever lands in 正月 or 腊月, and a scan of
  // 1800-2100 found zero years where either of those is itself a leap month. A leap
  // month here would be genuinely unvalidated territory, so refuse rather than guess.
  if (isLeapMonth) {
    throw new Error(
      `Lunar ${lunarYear}-${lunarMonth}(leap)-${lunarDay} falls in the yearDivide feed-year shift window (正月/腊月) and is itself a leap month; probe-findings found zero such cases in 1800-2100 and this path was never empirically validated. Refusing to guess — please double-check this birth date.`
    );
  }

  for (let cycle = 0; cycle <= 4; cycle++) {
    const dirs = cycle === 0 ? [0] : [-1, 1];
    for (const dir of dirs) {
      const y = baseYear + dir * cycle * 60;
      if (monthHasEnoughDays(y, lunarMonth, lunarDay)) return y;
    }
  }

  throw new Error(
    `Could not find a lunar year matching ganzhi "${targetGanZhi}" whose month ${lunarMonth} has at least ${lunarDay} days, searched +/-240 years around ${baseYear}. This is a data problem, not a caller error — please report it.`
  );
}
