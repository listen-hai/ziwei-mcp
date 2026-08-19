import { astro } from 'iztro';
import type FunctionalAstrolabe from 'iztro/lib/astro/FunctionalAstrolabe';
import type { ConfigMutagens } from 'iztro/lib/data/types';
import { calculateBaziChart } from '@openfate/bazi-engine';
import iztroPkg from 'iztro/package.json';
import lunarLitePkg from 'lunar-lite/package.json';
import baziEnginePkg from '@openfate/bazi-engine/package.json';
import trueSolarTimePkg from '@openfate/true-solar-time/package.json';

import { ValidatedZiweiInput, WallDateTime, ZiweiCalculationResult, ZiweiDiagnostics } from '../types';
import { ZIWEI_DEFAULTS, ZIWEI_YEAR_MAX, yearRangeMessage } from '../schemas/input';
import { wallToInstant, instantToWall, toUTCWall, tzOffsetMinutes, getStandardOffsetMinutes, formatOffsetString } from './time';
import { getShichenMidpoint, getShichenSamplePoints } from './shichen';
import { toTimeIndex, trueSolarTimeIndex, shichenCandidateTimeIndexes, timeIndexToShichen } from './time-index';
import { lunar2solar, solar2lunar, ganZhiOfLunarYear, lunarYearForGanZhi, assertLeapMonthExists } from './lunar';
import { resolveLocation } from '../geo/resolver';
import { trimChart } from './output';

// F1 fix: iztro's astro.config() (node_modules/iztro/lib/astro/astro.js, ~L82-103)
// merges the `mutagens`/`brightness` keys of every `config` object passed to
// astro.withOptions() into two MODULE-LEVEL objects (`_mutagens`/`_brightness`) and
// never clears them — unlike every other config key (yearDivide, dayDivide, etc.),
// which is a scalar that gets fully re-supplied (defaulted from the same module
// globals) on every call, so it can never carry state a caller didn't just provide.
// mutagens/brightness are merge-only: a key omitted from `config.mutagens` on this
// call still reads back whatever a PREVIOUS call last merged in. On a long-lived
// stdio MCP server this means one caller's override permanently rewrites every
// later chart this process ever produces (proved: see tests/boundary.test.ts's
// "does not leak overrides into a later plain request" case).
//
// iztro exposes no "reset to defaults" call, but astro.getConfig() (same file,
// exports.getConfig) returns `{ mutagens: _mutagens, brightness: _brightness, ... }`
// where `.mutagens`/`.brightness` are the SAME object references iztro mutates
// in-place (never reassigned to a new object — verified by reading astro.js: every
// write is `_mutagens[key] = ...`, never `_mutagens = {...}`). That means a snapshot
// taken via getConfig() the FIRST time this module is loaded (before any request has
// ever run, and therefore before any override could have touched it) is a live
// handle to iztro's actual internal state forever. We use that handle to wipe and
// restore the two tables after every astro.withOptions() call, whether or not this
// particular request passed overrides — restoring unconditionally is what stops a
// PRIOR call's leftover state from leaking into a request that itself supplies no
// override (config() only touches _mutagens/_brightness when a value is truthy, so
// `mutagens: undefined` silently no-ops instead of clearing anything).
//
// Do not "simplify" this to only reset when input.mutagens/input.brightness are set,
// and do not replace the delete-then-reassign with `cfg.mutagens = {...}` — that
// would rebind the local variable, not iztro's internal `_mutagens`, and the leak
// would come right back.
const _iztroConfigSnapshot = astro.getConfig();
const PRISTINE_MUTAGENS = { ..._iztroConfigSnapshot.mutagens };
const PRISTINE_BRIGHTNESS = { ..._iztroConfigSnapshot.brightness };

function resetIztroMutagensAndBrightness(): void {
  const cfg = astro.getConfig();
  for (const key of Object.keys(cfg.mutagens)) delete (cfg.mutagens as Record<string, unknown>)[key];
  Object.assign(cfg.mutagens, PRISTINE_MUTAGENS);
  for (const key of Object.keys(cfg.brightness)) delete (cfg.brightness as Record<string, unknown>)[key];
  Object.assign(cfg.brightness, PRISTINE_BRIGHTNESS);
}

const pad = (n: number) => String(n).padStart(2, '0');
const fmtDate = (w: { year: number; month: number; day: number }) => `${w.year}-${pad(w.month)}-${pad(w.day)}`;
const fmtDateTime = (w: { year: number; month: number; day: number; hour: number; minute: number }) =>
  `${fmtDate(w)} ${pad(w.hour)}:${pad(w.minute)}`;

/**
 * The core orchestrator: birth location + date/time input -> resolved UTC
 * instant -> Axis A (year ganzhi) + Axis B (local true solar time, lunar
 * date, timeIndex) -> iztro (with yearDivide bypass, spec §5 Z1) -> trimmed
 * chart + diagnostics.
 */
export function calculateZiweiChart(input: ValidatedZiweiInput): ZiweiCalculationResult {
  const warnings: string[] = [];

  // ZiweiInputSchema's `.default(...)` only fires when input goes through
  // ZiweiInputSchema.parse(). Callers that build ValidatedZiweiInput directly get
  // `undefined` for any field they omit, and reading input.* below would silently
  // treat that as falsy/missing instead of the documented default (e.g. trueSolar
  // silently disabling True Solar Time). Resolve every defaulted field once, here,
  // against the same ZIWEI_DEFAULTS the schema itself uses, and read only `opts`
  // below this point.
  const opts = {
    lunarDateFrame: input.lunarDateFrame ?? ZIWEI_DEFAULTS.lunarDateFrame,
    yearDivide: input.yearDivide ?? ZIWEI_DEFAULTS.yearDivide,
    horoscopeDivide: input.horoscopeDivide ?? ZIWEI_DEFAULTS.horoscopeDivide,
    ageDivide: input.ageDivide ?? ZIWEI_DEFAULTS.ageDivide,
    dayDivide: input.dayDivide ?? ZIWEI_DEFAULTS.dayDivide,
    algorithm: input.algorithm ?? ZIWEI_DEFAULTS.algorithm,
    astroType: input.astroType ?? ZIWEI_DEFAULTS.astroType,
    fixLeap: input.fixLeap ?? ZIWEI_DEFAULTS.fixLeap,
    trueSolar: input.trueSolar ?? ZIWEI_DEFAULTS.trueSolar,
  };

  const loc = resolveLocation({ place: input.place, longitude: input.longitude, timezone: input.timezone });
  if (loc.mixedWarning) warnings.push(loc.mixedWarning);

  const baseHour = input.clockTime ? input.clockTime.hour : getShichenMidpoint(input.shichen!).hour;
  const baseMinute = input.clockTime ? input.clockTime.minute : getShichenMidpoint(input.shichen!).minute;

  // Resolves a local wall clock to a UTC instant in timezone `tz` (defaults to the
  // birth place's timezone). If the wall clock was built from a shichen midpoint and
  // lands exactly in a DST spring-forward gap, falls back to the first shichen sample
  // point (start/mid/end) that does exist, mirroring bazi-mcp. Also used for the
  // lunarDateFrame:'beijing' path with tz:'Asia/Shanghai' (finding #4) — China had its
  // own spring-forward gaps through 1991, and that frame's shichen midpoint can land
  // in one (e.g. 1986-05-04 02:00 Asia/Shanghai) exactly like the local-frame path
  // does; without this, that call bypassed the fallback entirely and hard-errored
  // naming Asia/Shanghai instead of recovering with a warning like every other path.
  function resolveWallInstant(wall: WallDateTime, tz: string = loc.timezone) {
    try {
      return { wall, result: wallToInstant(wall, tz, input.dstFold) };
    } catch (err) {
      if (!input.shichen || input.clockTime || !(err as Error).message.includes('spring-forward gap')) {
        throw err;
      }
      for (const pt of getShichenSamplePoints(input.shichen)) {
        if (pt.hour === wall.hour && pt.minute === wall.minute) continue;
        try {
          const fallbackWall = { ...wall, hour: pt.hour, minute: pt.minute };
          const result = wallToInstant(fallbackWall, tz, input.dstFold);
          warnings.push(
            `The midpoint of shichen "${input.shichen}" (${pad(wall.hour)}:${pad(wall.minute)}) falls in a DST spring-forward gap in ${tz} and does not exist; used ${pad(pt.hour)}:${pad(pt.minute)} instead. Please double-check the exact clock time.`
          );
          return { wall: fallbackWall, result };
        } catch {
          // try the next sample point
        }
      }
      throw err;
    }
  }

  let localWall: WallDateTime;
  let instant: number;
  let offsetMinutes: number;
  let isDst: boolean;
  const lunarFrame: 'local' | 'beijing' = input.lunarDate ? opts.lunarDateFrame : 'local';

  if (input.lunarDate) {
    // Defect A: lunar-lite's lunar2solar silently ignores isLeapMonth when the named
    // leap month doesn't exist (e.g. lunar2solar('2021-4-15', true) === (...,false)),
    // so without this check the service would silently chart the wrong (non-leap)
    // date. Validate first and throw a clear error instead.
    if (input.lunarDate.isLeapMonth) {
      assertLeapMonthExists(input.lunarDate.year, input.lunarDate.month);
    }
    let conv;
    try {
      conv = lunar2solar(`${input.lunarDate.year}-${input.lunarDate.month}-${input.lunarDate.day}`, Boolean(input.lunarDate.isLeapMonth));
    } catch (err) {
      throw new Error(`Lunar date conversion failed: ${(err as Error).message}`);
    }
    if (lunarFrame === 'beijing') {
      // Beijing frame: the instant is already unambiguously resolved via Asia/Shanghai,
      // so — matching bazi-mcp's dual-axis.ts exactly — derive offsetMinutes/isDst
      // directly from that instant rather than round-tripping the derived local wall
      // clock back through resolveWallInstant, which could spuriously land in (or
      // misresolve) a DST fold at the birth place even though the instant itself was
      // never ambiguous.
      const beijingWall: WallDateTime = { year: conv.solarYear, month: conv.solarMonth, day: conv.solarDay, hour: baseHour, minute: baseMinute, second: 0 };
      instant = resolveWallInstant(beijingWall, 'Asia/Shanghai').result.instant;
      localWall = instantToWall(instant, loc.timezone);
      offsetMinutes = tzOffsetMinutes(instant, loc.timezone);
      const janOffset = tzOffsetMinutes(Date.UTC(localWall.year, 0, 15, 12, 0), loc.timezone);
      const julOffset = tzOffsetMinutes(Date.UTC(localWall.year, 6, 15, 12, 0), loc.timezone);
      isDst = offsetMinutes > Math.min(janOffset, julOffset);
    } else {
      localWall = { year: conv.solarYear, month: conv.solarMonth, day: conv.solarDay, hour: baseHour, minute: baseMinute, second: 0 };
      const { wall: resolvedWall, result: wRes } = resolveWallInstant(localWall);
      localWall = resolvedWall;
      instant = wRes.instant;
      offsetMinutes = wRes.offsetMinutes;
      isDst = wRes.isDst;
    }
  } else {
    localWall = { year: input.solarDate!.year, month: input.solarDate!.month, day: input.solarDate!.day, hour: baseHour, minute: baseMinute, second: 0 };
    const { wall: resolvedWall, result: wRes } = resolveWallInstant(localWall);
    localWall = resolvedWall;
    instant = wRes.instant;
    offsetMinutes = wRes.offsetMinutes;
    isDst = wRes.isDst;
  }

  // Axis B: local true solar time -> timeIndex + lunar date. Per @openfate/true-solar-time's
  // contract (matching bazi-mcp's dual-axis.ts exactly): pass the ACTUAL civil wall clock
  // (DST included) plus the *standard* offset and a separate dstOffsetHours — the library
  // subtracts the DST component internally. Passing an already DST-stripped wall clock here
  // would double-count DST and silently shift the result by an extra hour.
  const standardOffsetMinutes = getStandardOffsetMinutes(instant, loc.timezone);
  const dstOffsetHours = isDst ? (offsetMinutes - standardOffsetMinutes) / 60 : 0;

  // trueSolar:false still strips DST (matching bazi-mcp: Axis B is always computed from the
  // *standard* wall clock, with `enableTrueSolarTime` only toggling the longitude/equation-of-
  // time step on top of that) — it does not mean "use the raw civil clock unmodified".
  const standardWall = toUTCWall(instant + standardOffsetMinutes * 60000);
  const solarIdx = opts.trueSolar
    ? trueSolarTimeIndex({
        year: localWall.year,
        month: localWall.month,
        day: localWall.day,
        hour: localWall.hour,
        minute: localWall.minute,
        standardOffsetHours: standardOffsetMinutes / 60,
        dstOffsetHours,
        longitude: loc.longitude,
      })
    : {
        timeIndex: toTimeIndex(standardWall.hour, standardWall.minute),
        trueSolarWall: standardWall,
        longitudeCorrectionMinutes: 0,
        equationOfTimeMinutes: 0,
      };

  if (Math.abs(solarIdx.longitudeCorrectionMinutes) > 240) {
    warnings.push(
      `Astronomical sanity warning: longitude correction (${solarIdx.longitudeCorrectionMinutes.toFixed(1)} min) exceeds +/-240 minutes relative to the timezone standard meridian (${loc.timezone}). Please verify that the specified longitude and timezone belong to the same geographic region.`
    );
  }

  // Shichen ambiguity: mirrors bazi-mcp's shichen/hour-pillar ambiguity check (on
  // timeIndex instead of hour pillar) rather than rejecting outright — a "shichen"
  // is an inherently ~2h-wide claim, and True Solar Time / DST-strip correction is
  // typically tens of minutes, so *some* boundary disagreement between the window's
  // start/mid/end sample points is the normal case, not a rare edge case (empirically:
  // every one of the 12 shichens is "ambiguous" by this test at a typical longitude).
  // We still proceed with the midpoint-derived chart already computed above, but flag
  // it plainly via `shichenAmbiguity` + a warning so the caller knows the soul palace
  // and star placements could differ from the neighboring candidate — not a falsely
  // confident single chart (spec §6), just an honestly-labeled best estimate.
  let shichenAmbiguity: ZiweiDiagnostics['shichenAmbiguity'];
  if (input.shichen) {
    const candidates = shichenCandidateTimeIndexes({
      shichen: input.shichen,
      year: localWall.year,
      month: localWall.month,
      day: localWall.day,
      tz: loc.timezone,
      longitude: loc.longitude,
      dstFold: input.dstFold,
      trueSolar: opts.trueSolar,
    });
    if (candidates.length > 1) {
      shichenAmbiguity = { isAmbiguous: true, candidateTimeIndexes: candidates };
      const shown = candidates
        .map(ti => `timeIndex ${ti} (${timeIndexToShichen(ti)}${ti === 0 ? ' 早子时' : ti === 12 ? ' 晚子时' : ''})`)
        .join(', ');
      if (input.shichen === '子') {
        warnings.push(
          `The provided shichen is "子" (Zi), which spans early-Zi (00:00-01:00, belongs to the current day) and late-Zi (23:00-24:00, belongs to the previous day); this range contains multiple candidate timeIndex values: ${shown}. The soul palace, body palace, and several star placements can differ completely between candidates. Please provide an exact \`clockTime\` to disambiguate.`
        );
      } else {
        warnings.push(
          `The provided shichen "${input.shichen}" straddles a shichen boundary once resolved to an exact instant; this range contains multiple candidate timeIndex values: ${shown}. The soul palace, body palace, and several star placements can differ completely between candidates. Please provide an exact \`clockTime\` to disambiguate.`
        );
      }
    }
  }

  const { timeIndex, trueSolarWall } = solarIdx;
  const lunarConv = solar2lunar(fmtDate(trueSolarWall));

  // Axis A: year ganzhi via the true UTC instant's Beijing wall clock — exactly like
  // bazi-mcp's dual-axis.ts step 5, so the two projects never disagree on which side
  // of 立春 a birth falls (spec §5 Z1, §6 hard rule 3).
  const beijingWallForA = toUTCWall(instant + 8 * 3600000);

  // Finding #1: the schema (src/schemas/input.ts) only bounds the caller's own
  // wall-clock year (1900-2100). It does NOT bound the Beijing-projected year computed
  // above, which is computed unconditionally regardless of yearDivide (this runs before
  // the branch that decides whether the value is even used). A schema-valid instant near
  // a UTC year boundary in a timezone west of China (e.g. solarDate 2100-12-31 20:00
  // America/Los_Angeles) projects to Beijing year 2101, outside @openfate/bazi-engine's
  // own 1800-2100 range (see node_modules/@openfate/bazi-engine/dist/core/validation.js) —
  // and without this guard, calculateBaziChart below throws ITS raw message ("year must
  // be an integer between 1800 and 2100"), a different range and wording than what the
  // schema told the caller (spec §6: "两层校验用同一个范围、同一套文案"). Only the max needs
  // guarding here: the engine's own floor (1800) is 100 years below the schema's floor
  // (1900), and a UTC-offset day shift can move the Beijing year at most +/-1 from the
  // schema-valid wall-clock year, so a schema-valid year can never project below 1899 —
  // still inside the engine's range. Fail with our own wording before ever calling in.
  if (beijingWallForA.year > ZIWEI_YEAR_MAX) {
    throw new Error(
      `${yearRangeMessage('The Beijing-time (UTC+8) year of the resolved birth instant')} The birth instant's own wall-clock year was within that range, but this service always determines the year ganzhi from the Beijing-time (UTC+8) projection of the exact birth instant (Axis A, spec §6) — for a birth within roughly a day of a UTC year boundary, in a timezone west of China, that projection can fall in the following year. Beijing year computed: ${beijingWallForA.year}.`
    );
  }

  const A = calculateBaziChart({
    year: beijingWallForA.year,
    month: beijingWallForA.month,
    day: beijingWallForA.day,
    hour: beijingWallForA.hour,
    minute: beijingWallForA.minute,
    gender: input.gender,
    longitude: 120,
    timezone: 8,
    enableTrueSolarTime: false,
    dayBoundaryMode: 'ZI_HOUR_23',
  });
  const yearGanZhiLichun = A.pillars.year.stem + A.pillars.year.branch;
  const yearGanZhiLunarNewYear = ganZhiOfLunarYear(lunarConv.lunarYear);
  const yearGanZhi = opts.yearDivide === 'lunar_new_year' ? yearGanZhiLunarNewYear : yearGanZhiLichun;

  const feedYear = lunarYearForGanZhi(yearGanZhi, lunarConv.lunarYear, lunarConv.lunarMonth, lunarConv.lunarDay, lunarConv.isLeap);

  const commonOptions = {
    timeIndex,
    gender: input.gender,
    fixLeap: opts.fixLeap,
    language: 'zh-CN' as const,
    astroType: opts.astroType,
    config: {
      yearDivide: 'normal' as const,
      horoscopeDivide: 'normal' as const,
      ageDivide: opts.ageDivide,
      dayDivide: opts.dayDivide,
      algorithm: opts.algorithm,
      // spec §9/§12 passthrough (finding #7): plumbing only, validated by
      // MutagensSchema/BrightnessSchema (src/schemas/input.ts) — including, as of the
      // F3 fix, membership against iztro's own runtime-loaded star-name table — not
      // re-validated here. Cast needed for mutagens only: zod's z.record(...) infers
      // star-name entries as plain `string[]` (a structural, not nominal, type), while
      // iztro's own ConfigMutagens types them as `StarName[]` (its own closed union of
      // ~160 literal star names) — the two types describe the same runtime values but
      // aren't assignable to each other without a cast. brightness needs no cast:
      // BrightnessValueEnum's members are already literal subsets of iztro's
      // Brightness union, so it's structurally compatible as-is.
      mutagens: input.mutagens as ConfigMutagens | undefined,
      brightness: input.brightness,
    },
  };

  let chart: FunctionalAstrolabe;
  try {
    // Defect B: iztro's `type:'lunar'` entry point validates the day count against
    // the NON-leap twin month even when isLeapMonth:true is passed, so it throws
    // "only 29 days in lunar year Y month M" for any of the 17 real 闰月三十 days
    // between 1900-2100 (e.g. 2017 闰六月三十) — even though that's a real calendar
    // day and lunar-lite reports it fine. `type:'solar'` builds the same days
    // correctly (verified: 300 random charts, 1930-2019, byte-identical to the
    // `type:'lunar'` path after stripping the polluted calendar fields — including
    // re-checked for dayDivide:'forward' + timeIndex:12, the Z2 late-Zi case).
    // So whenever no feed-year shift is needed (the overwhelming majority of
    // births), feed the Axis-B local true solar date via `type:'solar'` instead —
    // this fixes the leap-30 crash and changes nothing else. When a shift IS
    // needed (feedYear !== lunarConv.lunarYear), probe-findings P2c found zero
    // leap 正月/腊月 in 1800-2100, so that path never needs to express a leap
    // month and can safely keep using `type:'lunar'` with the computed feedYear.
    chart =
      feedYear === lunarConv.lunarYear
        ? astro.withOptions<FunctionalAstrolabe>({
            ...commonOptions,
            type: 'solar',
            dateStr: fmtDate(trueSolarWall),
          })
        : astro.withOptions<FunctionalAstrolabe>({
            ...commonOptions,
            type: 'lunar',
            dateStr: `${feedYear}-${lunarConv.lunarMonth}-${lunarConv.lunarDay}`,
            isLeapMonth: lunarConv.isLeap,
          });
  } catch (err) {
    throw new Error(
      `iztro chart calculation failed for feed year ${feedYear}, lunar month ${lunarConv.lunarMonth} day ${lunarConv.lunarDay}: ${(err as Error).message}`
    );
  } finally {
    // F1 fix: always wipe iztro's module-level mutagens/brightness globals back to
    // pristine after this call, success or throw — see resetIztroMutagensAndBrightness's
    // definition above for why this must run unconditionally, not just when this
    // request itself passed overrides.
    resetIztroMutagensAndBrightness();
  }

  const trimmed = trimChart(chart);
  const beijingWallOfInstant = instantToWall(instant, 'Asia/Shanghai');

  const diagnostics: ZiweiDiagnostics = {
    wallClock: `${fmtDateTime(localWall)} (${loc.timezone})`,
    utcOffset: formatOffsetString(offsetMinutes, isDst),
    utcInstant: new Date(instant).toISOString(),
    axisA_instant_forYearPillar: `${fmtDateTime(beijingWallForA)} (UTC+8)`,
    axisB_localTrueSolarTime: fmtDateTime(trueSolarWall),
    longitudeCorrectionMinutes: Number(solarIdx.longitudeCorrectionMinutes.toFixed(2)),
    equationOfTimeMinutes: Number(solarIdx.equationOfTimeMinutes.toFixed(2)),
    yearGanZhi,
    yearDivideApplied: opts.yearDivide,
    yearDivideNote: `The year ganzhi was determined by this service on the true 立春 (start of spring) instant (Axis A: @openfate/bazi-engine on the Beijing wall clock of the resolved UTC instant), NOT by iztro's own yearDivide:'exact' (which only divides by calendar date, not the exact 立春 moment — see project spec §5 "Z1"). Lunar year ${feedYear} was then fed to iztro purely because it reproduces the correct ganzhi "${yearGanZhi}" under config.yearDivide:'normal'; it is not necessarily the birth year's own lunar year number (that is reported separately in \`lunar.year\`).`,
    feedYear,
    lunar: {
      frame: lunarFrame,
      solarDate: fmtDate(localWall),
      beijingSameDay: fmtDate(beijingWallOfInstant),
    },
    timeIndex,
    shichenAmbiguity,
    convention: {
      yearDivide: opts.yearDivide,
      horoscopeDivide: opts.horoscopeDivide,
      ageDivide: opts.ageDivide,
      dayDivide: opts.dayDivide,
      algorithm: opts.algorithm,
      astroType: opts.astroType,
      fixLeap: opts.fixLeap,
      trueSolar: opts.trueSolar,
    },
    locationSource: loc.locationSource,
    warnings,
    engineInfo: {
      iztro: iztroPkg.version,
      lunarLite: lunarLitePkg.version,
      baziEngine: baziEnginePkg.version,
      trueSolarTimeEngine: trueSolarTimePkg.version,
      schemaVersion: '1.0.0',
    },
  };

  return {
    ...trimmed,
    lunar: {
      year: lunarConv.lunarYear,
      month: lunarConv.lunarMonth,
      day: lunarConv.lunarDay,
      isLeapMonth: lunarConv.isLeap,
      shichen: timeIndexToShichen(timeIndex),
      timeIndex,
    },
    diagnostics,
  };
}
