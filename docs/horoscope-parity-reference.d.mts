/**
 * Type declaration for horoscope-parity-reference.mjs, the permanent 运限 oracle
 * (independent classical implementation, verified at 303,582 assertions / 0 mismatches
 * — see that file's own header). This file is a SEPARATE, newly-added sibling — the
 * project rules forbid editing horoscope-parity-reference.mjs or
 * tests/horoscope-parity.test.ts (the frozen verification asset), but adding this
 * co-located `.d.mts` (the standard TypeScript convention for typing a plain `.mjs`
 * module) does not touch either: it only makes `bunx tsc --noEmit` clean for every
 * file that imports expectHoroscope, including this project's own horoscope tests.
 * Shape mirrors expectHoroscope's `out[scope]` objects exactly.
 */
export interface HoroscopeOracleScope {
  index: number;
  stem: string;
  branch: string;
  mutagen: string[];
  palaceNames: string[];
  stars?: Record<string, number>;
  nominalAge?: number;
  tongxian?: boolean;
  suiqian12?: string[];
  jiangqian12?: string[];
}

export interface HoroscopeOracleResult {
  decadal: HoroscopeOracleScope;
  age: HoroscopeOracleScope;
  yearly: HoroscopeOracleScope;
  monthly: HoroscopeOracleScope;
  daily: HoroscopeOracleScope;
  hourly: HoroscopeOracleScope;
}

export function expectHoroscope(
  natal: { lunarYear: number; lunarMonth: number; lunarDay: number; timeIndex: number; gender: 'male' | 'female' },
  target: string,
  targetTi?: number
): HoroscopeOracleResult;
