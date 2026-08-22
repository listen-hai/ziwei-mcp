export type {
  ShichenBranch,
  SolarDateInput,
  LunarDateInput,
  ClockTimeInput,
  ZiweiInput,
  ValidatedZiweiInput,
  LookupLocationInput,
} from './schemas/input';

export type {
  HoroscopeTargetInput,
  ZiweiHoroscopeInput,
  ValidatedZiweiHoroscopeInput,
} from './schemas/horoscope';

export interface WallDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export interface CityEntry {
  name: string;
  country: string;
  province?: string;
  longitude: number;
  latitude: number;
  /** Municipal population, used only to break same-name ties. */
  population?: number;
  timezone: string;
  alternateTimezones?: string[];
}

export interface StarOutput {
  name: string;
  brightness: string;
  mutagen: string;
}

export interface DecadalOutput {
  ageRange: [number, number];
  stem: string;
  branch: string;
}

export interface PalaceOutput {
  index: number;
  name: string;
  branch: string;
  stem: string;
  isBodyPalace: boolean;
  majorStars: StarOutput[];
  minorStars: StarOutput[];
  adjectiveStars: string[];
  decadal: DecadalOutput;
}

export interface LunarOutput {
  year: number;
  month: number;
  day: number;
  isLeapMonth: boolean;
  shichen: string;
  timeIndex: number;
}

export interface ZiweiDiagnostics {
  wallClock: string;
  utcOffset: string;
  utcInstant: string;
  axisA_instant_forYearPillar: string;
  /** The local solar time actually fed to Axis B's timeIndex/lunar-date computation —
   * NOT always full True Solar Time. Renamed from `axisB_localTrueSolarTime` (0.3.0):
   * that name asserted a true-solar basis that 'mean' and 'off' don't use. Reflects
   * longitude+equation-of-time under solarTime:'true', longitude only under 'mean', and
   * the plain DST-stripped wall clock under 'off' — see `convention.solarTime`. */
  axisB_localSolarTime: string;
  longitudeCorrectionMinutes: number;
  equationOfTimeMinutes: number;
  yearGanZhi: string;
  yearDivideApplied: 'lichun' | 'lunar_new_year';
  yearDivideNote: string;
  feedYear: number;
  lunar: {
    frame: 'local' | 'beijing';
    solarDate: string;
    beijingSameDay: string;
  };
  timeIndex: number;
  /** Only present when dayDivide:'forward' AND timeIndex 12 (晚子时) — the one
   * combination where iztro's star placement (location.js: `lunarDay + 1`) actually
   * uses a different lunar day than `lunar.day` reports. See `dayDivideNote`. */
  starPlacementLunarDay?: number;
  /** The day-axis counterpart of `yearDivideNote` — spec §5 "Z2": iztro shifts star
   * placement (紫微 and everything derived from it) forward one lunar day for a
   * 晚子时 birth under dayDivide:'forward', but its own `lunarDate` display field
   * does NOT follow (which is exactly why this project never passes that field
   * through — see trimChart). `lunar.day` here reports the birth's true lunar day;
   * this note says plainly that star placement used the day after it, and why.
   * Absent for every other combination of dayDivide/timeIndex, where the two never
   * diverge. */
  dayDivideNote?: string;
  /** Solar-time disclosure (project owner's ruling, spec item 4; adapted for the 0.3.0
   * three-way `solarTime` mode): present only when the correction actually APPLIED under
   * this mode moved this birth across a 时辰 (timeIndex) boundary relative to the
   * uncorrected civil clock — the one case where this chart can disagree with a tool
   * that uses the plain civil clock (e.g. a Beijing-time cross-check). Under 'true' this
   * is the full True Solar Time correction (longitude + equation of time), worded
   * exactly as before 0.3.0. Under 'mean' only the longitude correction is applied — the
   * wording says so explicitly and does NOT call it "True Solar Time" or break the
   * correction into "longitude + equation of time" components, since only the longitude
   * component was actually used. Absent under 'off' (the applied and uncorrected
   * timeIndex are identical there by construction) — deliberately not boilerplate that
   * fires on every chart. Carries the classical caution 「不准但用三时断，时有差误不可凭」
   * per the project owner. */
  trueSolarNote?: string;
  shichenAmbiguity?: {
    isAmbiguous: boolean;
    candidateTimeIndexes: number[];
  };
  convention: {
    yearDivide: 'lichun' | 'lunar_new_year';
    horoscopeDivide: 'lichun' | 'lunar_new_year';
    ageDivide: 'normal' | 'birthday';
    dayDivide: 'current' | 'forward';
    algorithm: 'default' | 'zhongzhou';
    astroType: 'heaven' | 'earth' | 'human';
    fixLeap: boolean;
    /** Resolved solar time correction mode: 'true' (longitude + equation of time, the
     * default), 'mean' (longitude only, 地方平太阳时), or 'off' (neither). 0.3.0
     * successor to the boolean `trueSolar` field (which could not express 'mean'); see
     * `ZiweiInput.solarTime`. */
    solarTime: 'true' | 'mean' | 'off';
  };
  locationSource: 'resolved' | 'caller_supplied' | 'mixed';
  warnings: string[];
  engineInfo: {
    iztro: string;
    lunarLite: string;
    baziEngine: string;
    trueSolarTimeEngine: string;
    schemaVersion: string;
  };
}

export interface ZiweiCalculationResult {
  soulPalace: { branch: string; stem: string; name: string };
  bodyPalace: { branch: string };
  soul: string;
  body: string;
  fiveElementsClass: string;
  lunar: LunarOutput;
  palaces: PalaceOutput[];
  diagnostics: ZiweiDiagnostics;
}

/**
 * A single 运限 (horoscope) scope — 大限/童限, 流年, 流月, 流日, or 流时. `name` is
 * iztro's own label for this scope (e.g. "大限" vs "童限" — the SAME field
 * distinguishes a decadal-limit scope from a childhood-limit one, so no separate
 * flag is needed). `stars` (the scope's 运曜, by palace index 0-11) is omitted
 * entirely for 小限 (age) — iztro's horoscope() never computes a stars array for
 * it, and the horoscope-parity gate agrees.
 */
export interface HoroscopeScopeOutput {
  name: string;
  index: number;
  stem: string;
  branch: string;
  palaceNames: string[];
  mutagen: string[];
  stars?: string[][];
}

export interface HoroscopeAgeOutput extends HoroscopeScopeOutput {
  /** 虚岁 (nominal age), correctly sourced per defect-1 (see diagnostics.feedYearCompensation). */
  nominalAge: number;
}

export interface HoroscopeYearlyOutput extends HoroscopeScopeOutput {
  /** 岁前十二神 / 将前十二神, by palace index 0-11 — 流年-exclusive, from iztro's own yearlyDecStar. */
  yearlyDecStars: { suiqian12: string[]; jiangqian12: string[] };
}

export interface ZiweiHoroscopeDiagnostics {
  targetWallClock: string;
  targetUtcInstant: string;
  axisA_instant_forYearlyGanZhi: string;
  /** See ZiweiDiagnostics.axisB_localSolarTime's doc comment — same 0.3.0 rename, same
   * meaning, applied to the target instant instead of the birth instant. */
  axisB_localSolarTime: string;
  /** The target's lunar date, computed by this service (never iztro's own `lunarDate`/
   * `solarDate` — spec: "Never pass through iztro's lunarDate/solarDate for the
   * target — compute them"). Reflects the late-Zi-normalized date when
   * lateZiNormalized is true, consistent with targetTimeIndex/axisB below it. */
  targetLunar: { year: number; month: number; day: number; isLeapMonth: boolean };
  targetTimeIndex: number;
  lateZiNormalized: boolean;
  yearlyGanZhi: string;
  horoscopeDivideApplied: 'lichun' | 'lunar_new_year';
  yearlyGanZhiNote: string;
  feedYearCompensation: {
    birthFeedYear: number;
    birthLunarYear: number;
    sixtyYearOffsetApplied: number;
    decadalAgeSource: 'true-target' | 'anchor';
    decadalAgeAnchorLunarYear?: number;
    /** Which mechanism(s) engaged the anchor (F3): the ±60 crash-avoidance
     * compensation, the first-year clamp (a target that hasn't yet reached the
     * birth's own 虚岁-1 epoch), both, or undefined when no anchor was used at all
     * (decadalAgeSource === 'true-target'). See `note` for the case-specific
     * explanation. */
    decadalAgeAnchorReason?: 'sixtyYearOffset' | 'firstYearClamp' | 'sixtyYearOffsetAndFirstYearClamp';
    note: string;
  };
  yearlySource: 'true-target' | 'anchor';
  yearlyAnchorLunarYear?: number;
  monthlyAnchor: {
    ganZhi: string;
    convention: 'lunar_new_year';
    note: string;
  };
  convention: {
    horoscopeDivide: 'lichun' | 'lunar_new_year';
    ageDivide: 'normal';
    dayDivide: 'current' | 'forward';
    algorithm: 'default' | 'zhongzhou';
    astroType: 'heaven' | 'earth' | 'human';
    fixLeap: boolean;
    solarTime: 'true' | 'mean' | 'off';
  };
  locationSource: 'resolved' | 'caller_supplied' | 'mixed';
  warnings: string[];
  engineInfo: {
    iztro: string;
    lunarLite: string;
    baziEngine: string;
    trueSolarTimeEngine: string;
    schemaVersion: string;
  };
}

export interface ZiweiHoroscopeResult {
  decadal: HoroscopeScopeOutput;
  age: HoroscopeAgeOutput;
  yearly: HoroscopeYearlyOutput;
  monthly: HoroscopeScopeOutput;
  daily: HoroscopeScopeOutput;
  hourly: HoroscopeScopeOutput;
  diagnostics: ZiweiHoroscopeDiagnostics;
}
