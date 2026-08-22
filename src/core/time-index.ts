import { calculateTrueSolarTime } from '@openfate/true-solar-time';
import { ShichenBranch } from '../types';
import { getShichenSamplePoints } from './shichen';
import { wallToInstant, getStandardOffsetMinutes, toUTCWall } from './time';

const BRANCH_ORDER: ShichenBranch[] = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

/**
 * Maps a local wall-clock hour/minute to iztro's timeIndex (0-12).
 * 0 = early Zi (早子时, 00:00-01:00), 12 = late Zi (晚子时, 23:00-24:00) —
 * distinct indices, never merge them (spec §6).
 */
export function toTimeIndex(hour: number, _minute: number): number {
  if (hour === 23) return 12;
  if (hour === 0) return 0;
  return Math.floor((hour + 1) / 2);
}

/** timeIndex -> shichen branch name. 0 and 12 both map to 子. */
export function timeIndexToShichen(timeIndex: number): ShichenBranch {
  return BRANCH_ORDER[timeIndex === 12 ? 0 : timeIndex];
}

export interface TrueSolarTimeIndexResult {
  timeIndex: number;
  trueSolarWall: { year: number; month: number; day: number; hour: number; minute: number };
  longitudeCorrectionMinutes: number;
  equationOfTimeMinutes: number;
}

/**
 * Applies True Solar Time correction to the actual local civil wall clock and
 * derives the resulting timeIndex. Mirrors bazi-mcp's use of
 * @openfate/true-solar-time exactly: the ACTUAL wall clock (DST included, if
 * any) goes in as `hour`/`minute`, alongside the *standard* (non-DST) offset
 * and a separate `dstOffsetHours` — the library itself subtracts the DST
 * component back out before applying the longitude/equation-of-time
 * correction. Passing an already DST-stripped wall clock here (a bug this
 * project hit once — see the ziwei-mcp implementation report) double-counts
 * the DST offset and produces a hidden extra 1h shift, which is silent and
 * plausible-looking rather than a crash.
 */
export function trueSolarTimeIndex(params: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  standardOffsetHours: number;
  dstOffsetHours: number;
  longitude: number;
}): TrueSolarTimeIndexResult {
  const detail = calculateTrueSolarTime(
    {
      year: params.year,
      month: params.month,
      day: params.day,
      hour: params.hour,
      minute: params.minute,
      second: 0,
      timeZoneOffset: params.standardOffsetHours,
      dstOffset: params.dstOffsetHours,
    },
    { longitude: params.longitude }
  );
  const m = detail.trueSolarDateTime.match(/^(\d+)-(\d+)-(\d+)[ T](\d+):(\d+)/);
  if (!m) {
    throw new Error(`Internal error: could not parse true solar date-time "${detail.trueSolarDateTime}".`);
  }
  const trueSolarWall = { year: +m[1], month: +m[2], day: +m[3], hour: +m[4], minute: +m[5] };
  return {
    timeIndex: toTimeIndex(trueSolarWall.hour, trueSolarWall.minute),
    trueSolarWall,
    longitudeCorrectionMinutes: detail.longitudeCorrectionMinutes,
    equationOfTimeMinutes: detail.equationOfTimeMinutes,
  };
}

/**
 * Applies ONLY the longitude correction (地方平太阳时 / local mean solar time) — no
 * equation of time. Port of bazi-mcp's dual-axis.ts `resolveAxisBWall` 'mean' branch:
 * the engine there is all-or-nothing, so bazi computes @openfate/true-solar-time's own
 * decomposed `longitudeCorrectionMinutes` (a pure function of longitude and the standard
 * meridian, safe at `dstOffset: 0` regardless of the actual DST state — see that
 * comment) and shifts the wall clock by hand, rather than ever touching the library's
 * combined `trueSolarDateTime` output (which also bakes in the equation of time). Ziwei
 * has no engine-level True Solar Time to disable (iztro is never told about solar time
 * at all — this project computes timeIndex itself and feeds iztro a plain date +
 * timeIndex), so there is no second correction to suppress the way bazi's
 * `enableTrueSolarTime` flag needs to be; the only failure mode this function itself
 * must avoid is reading `detail.trueSolarDateTime` (which would leak the equation of
 * time back in) instead of `detail.longitudeCorrectionMinutes` (which never includes it).
 *
 * Callers must pass the DST-stripped *standard* wall clock (matching bazi's
 * `standardWall`) — this function always evaluates the library at `dstOffset: 0`.
 */
export function meanSolarTimeIndex(params: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  standardOffsetHours: number;
  longitude: number;
}): TrueSolarTimeIndexResult {
  const detail = calculateTrueSolarTime(
    {
      year: params.year,
      month: params.month,
      day: params.day,
      hour: params.hour,
      minute: params.minute,
      second: 0,
      timeZoneOffset: params.standardOffsetHours,
      dstOffset: 0,
    },
    { longitude: params.longitude }
  );
  const shifted = toUTCWall(
    Date.UTC(params.year, params.month - 1, params.day, params.hour, params.minute, 0) +
      detail.longitudeCorrectionMinutes * 60000
  );
  const trueSolarWall = { year: shifted.year, month: shifted.month, day: shifted.day, hour: shifted.hour, minute: shifted.minute };
  return {
    timeIndex: toTimeIndex(trueSolarWall.hour, trueSolarWall.minute),
    trueSolarWall,
    // Reported for diagnostics/warning purposes — NOT applied to `trueSolarWall` above.
    longitudeCorrectionMinutes: detail.longitudeCorrectionMinutes,
    equationOfTimeMinutes: detail.equationOfTimeMinutes,
  };
}

export type SolarTimeMode = 'true' | 'mean' | 'off';

export interface SolarTimeResolution {
  /** Whichever of `full`/`mean`/a raw (uncorrected) result this `mode` actually feeds
   * to the chart — timeIndex + trueSolarWall are the values downstream code must use. */
  applied: TrueSolarTimeIndexResult;
  /** Full True Solar Time (longitude + equation of time). Computed unconditionally,
   * regardless of `mode`, so it is always available for diagnostics/warnings/the 'mean'-
   * vs-'true' boundary check below — never applied to the chart unless mode === 'true'. */
  full: TrueSolarTimeIndexResult;
  /** Local mean solar time (longitude only). Computed unconditionally for the same
   * reason as `full` — never applied to the chart unless mode === 'mean'. */
  mean: TrueSolarTimeIndexResult;
  /** timeIndex from the DST-stripped standard wall clock alone, no correction at all —
   * the baseline every mode's "did this correction cross a shichen boundary" check
   * compares against. */
  rawTimeIndex: number;
}

/**
 * Single point where a `solarTime` mode is turned into the timeIndex/wall actually fed
 * to the chart, shared by the natal path (chart.ts), the horoscope target path
 * (horoscope.ts), and shichen-ambiguity sampling (`shichenCandidateTimeIndexes` below) —
 * one implementation, not three, is what keeps 'mean' from silently double-correcting or
 * leaking the equation of time back in on any one of those call sites while staying
 * fixed on the others.
 */
export function resolveSolarTimeIndex(params: {
  mode: SolarTimeMode;
  /** Actual civil wall clock (DST included, if any) — what 'true' mode needs, since
   * @openfate/true-solar-time subtracts the DST component internally. */
  actualWall: { year: number; month: number; day: number; hour: number; minute: number };
  /** DST-stripped standard wall clock — what 'mean' and 'off' both key off of. */
  standardWall: { year: number; month: number; day: number; hour: number; minute: number };
  standardOffsetHours: number;
  dstOffsetHours: number;
  longitude: number;
}): SolarTimeResolution {
  const full = trueSolarTimeIndex({
    ...params.actualWall,
    standardOffsetHours: params.standardOffsetHours,
    dstOffsetHours: params.dstOffsetHours,
    longitude: params.longitude,
  });
  const mean = meanSolarTimeIndex({
    ...params.standardWall,
    standardOffsetHours: params.standardOffsetHours,
    longitude: params.longitude,
  });
  const rawTimeIndex = toTimeIndex(params.standardWall.hour, params.standardWall.minute);
  const applied: TrueSolarTimeIndexResult =
    params.mode === 'true'
      ? full
      : params.mode === 'mean'
        ? mean
        : {
            timeIndex: rawTimeIndex,
            trueSolarWall: params.standardWall,
            longitudeCorrectionMinutes: full.longitudeCorrectionMinutes,
            equationOfTimeMinutes: full.equationOfTimeMinutes,
          };
  return { applied, full, mean, rawTimeIndex };
}

/**
 * For a `shichen` (traditional double-hour) input, samples the shichen's
 * start/mid/end clock times and returns the distinct timeIndex values a
 * resolved instant can produce for them. More than one candidate means the
 * caller must not silently commit to one (spec §6; mirrors bazi-mcp's
 * shichen hour-pillar ambiguity check, but on timeIndex instead of hour
 * pillar). This can happen even with `solarTimeMode: 'off'`: DST-stripping alone
 * (converting the civil clock to the *standard*, non-DST wall clock) can push
 * a sample point across a shichen boundary on its own, independent of the
 * longitude/equation-of-time correction that `solarTimeMode` toggles.
 */
export function shichenCandidateTimeIndexes(params: {
  shichen: ShichenBranch;
  year: number;
  month: number;
  day: number;
  tz: string;
  longitude: number;
  dstFold?: 0 | 1;
  solarTimeMode: SolarTimeMode;
}): number[] {
  const candidates = new Set<number>();
  // A gap (spring-forward) and a fold (fall-back) both make a bare sample point
  // throw, but they mean opposite things: a gap wall time doesn't exist, so
  // skipping is correct; a fold wall time exists twice, so skipping would
  // silently drop exactly the candidate this function exists to enumerate. If
  // the caller already disambiguated via `params.dstFold`, honor that and sample
  // only the occurrence they meant. Otherwise, try both fold occurrences for
  // each sample point: `wallToInstant` ignores `dstFold` whenever there's only
  // one candidate (ordinary day, or a gap), so this is a no-op there and the
  // `Set` below dedupes; on a fold it yields both timeIndex values.
  const foldsToTry: Array<0 | 1 | undefined> = params.dstFold !== undefined ? [params.dstFold] : [0, 1];
  for (const pt of getShichenSamplePoints(params.shichen)) {
    for (const fold of foldsToTry) {
      try {
        const wallForSample = { year: params.year, month: params.month, day: params.day, hour: pt.hour, minute: pt.minute };
        const wRes = wallToInstant(wallForSample, params.tz, fold);
        const stdOffsetMinutes = getStandardOffsetMinutes(wRes.instant, params.tz);
        const dstOffsetHours = wRes.isDst ? (wRes.offsetMinutes - stdOffsetMinutes) / 60 : 0;
        const stdWall = toUTCWall(wRes.instant + stdOffsetMinutes * 60000);
        const { applied } = resolveSolarTimeIndex({
          mode: params.solarTimeMode,
          actualWall: wallForSample,
          standardWall: stdWall,
          standardOffsetHours: stdOffsetMinutes / 60,
          dstOffsetHours,
          longitude: params.longitude,
        });
        candidates.add(applied.timeIndex);
      } catch (err) {
        // Only a DST spring-forward gap is expected: that occurrence genuinely
        // does not exist, so skipping it is correct. (A fold never throws here
        // since we sample each occurrence explicitly via `fold`.) Anything else
        // would silently drop a candidate time index -- under-reporting the
        // ambiguity we are here to measure -- so rethrow it.
        if (!(err instanceof Error) || !/spring-forward gap/.test(err.message)) throw err;
      }
    }
  }
  return Array.from(candidates).sort((a, b) => a - b);
}
