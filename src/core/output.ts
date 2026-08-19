import type FunctionalAstrolabe from 'iztro/lib/astro/FunctionalAstrolabe';
import { PalaceOutput, StarOutput } from '../types';

interface RawStar {
  name: string;
  brightness?: string;
  mutagen?: string;
}

function mapStar(s: RawStar): StarOutput {
  return { name: s.name, brightness: s.brightness ?? '', mutagen: s.mutagen ?? '' };
}

/**
 * Trims iztro's full astrolabe object down to the spec §7 shape. Deliberately
 * never touches `solarDate` / `lunarDate` / `chineseDate` / `rawDates` / `sign`
 * (spec §5, probe-findings P2): those are computed by this project's own
 * lunar/axis-A logic instead, since the calendar-shift trick used to bypass
 * iztro's yearDivide bug (Z1) pollutes those particular fields on the raw
 * astrolabe object.
 */
export function trimChart(chart: FunctionalAstrolabe): {
  soulPalace: { branch: string; stem: string; name: string };
  bodyPalace: { branch: string };
  soul: string;
  body: string;
  fiveElementsClass: string;
  palaces: PalaceOutput[];
} {
  const soulPalaceObj = chart.palaces.find(p => p.earthlyBranch === chart.earthlyBranchOfSoulPalace);
  if (!soulPalaceObj) {
    throw new Error('Internal error: iztro astrolabe has no palace matching earthlyBranchOfSoulPalace.');
  }

  const palaces: PalaceOutput[] = chart.palaces.map(p => ({
    index: p.index,
    name: p.name,
    branch: p.earthlyBranch,
    stem: p.heavenlyStem,
    isBodyPalace: p.isBodyPalace,
    majorStars: p.majorStars.map(mapStar),
    minorStars: p.minorStars.map(mapStar),
    adjectiveStars: p.adjectiveStars.map(s => s.name),
    decadal: {
      ageRange: p.decadal.range,
      stem: p.decadal.heavenlyStem,
      branch: p.decadal.earthlyBranch,
    },
  }));

  return {
    soulPalace: { branch: chart.earthlyBranchOfSoulPalace, stem: soulPalaceObj.heavenlyStem, name: '命宫' },
    bodyPalace: { branch: chart.earthlyBranchOfBodyPalace },
    soul: chart.soul,
    body: chart.body,
    fiveElementsClass: chart.fiveElementsClass,
    palaces,
  };
}
