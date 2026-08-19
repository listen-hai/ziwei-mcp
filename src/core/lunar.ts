import { lunar2solar, solar2lunar, getTotalDaysOfLunarMonth } from 'lunar-lite';

export { lunar2solar, solar2lunar };

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
