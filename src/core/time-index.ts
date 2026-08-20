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
 * For a `shichen` (traditional double-hour) input, samples the shichen's
 * start/mid/end clock times and returns the distinct timeIndex values a
 * resolved instant can produce for them. More than one candidate means the
 * caller must not silently commit to one (spec §6; mirrors bazi-mcp's
 * shichen hour-pillar ambiguity check, but on timeIndex instead of hour
 * pillar). This can happen even with `trueSolar: false`: DST-stripping alone
 * (converting the civil clock to the *standard*, non-DST wall clock) can push
 * a sample point across a shichen boundary on its own, independent of the
 * longitude/equation-of-time correction that `trueSolar` toggles.
 */
export function shichenCandidateTimeIndexes(params: {
  shichen: ShichenBranch;
  year: number;
  month: number;
  day: number;
  tz: string;
  longitude: number;
  dstFold?: 0 | 1;
  trueSolar: boolean;
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
        if (params.trueSolar) {
          const dstOffsetHours = wRes.isDst ? (wRes.offsetMinutes - stdOffsetMinutes) / 60 : 0;
          const { timeIndex } = trueSolarTimeIndex({
            year: wallForSample.year,
            month: wallForSample.month,
            day: wallForSample.day,
            hour: wallForSample.hour,
            minute: wallForSample.minute,
            standardOffsetHours: stdOffsetMinutes / 60,
            dstOffsetHours,
            longitude: params.longitude,
          });
          candidates.add(timeIndex);
        } else {
          const stdWall = toUTCWall(wRes.instant + stdOffsetMinutes * 60000);
          candidates.add(toTimeIndex(stdWall.hour, stdWall.minute));
        }
      } catch {
        // Gap: this occurrence doesn't exist, skip it. (A fold never throws here
        // since we're sampling each occurrence explicitly via `fold`.)
      }
    }
  }
  return Array.from(candidates).sort((a, b) => a - b);
}
