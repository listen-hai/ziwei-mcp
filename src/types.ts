export type {
  ShichenBranch,
  SolarDateInput,
  LunarDateInput,
  ClockTimeInput,
  ZiweiInput,
  ValidatedZiweiInput,
  LookupLocationInput,
} from './schemas/input';

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
  axisB_localTrueSolarTime: string;
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
    trueSolar: boolean;
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
