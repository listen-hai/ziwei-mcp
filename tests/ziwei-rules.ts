/**
 * Independent implementation of the classical Zi Wei Dou Shu 安星诀 (star-placement
 * rules), transplanted from tests/parity-reference.mjs — verified ground truth
 * (50,104 assertions / 800 charts / 0 mismatches against iztro 2.6.0).
 *
 * This is the suite's ORACLE. It must never be derived from iztro or from src/:
 * its whole job is to disagree loudly when either of those drifts.
 */
import { getTotalDaysOfLunarMonth, lunar2solar } from 'lunar-lite';

export const Z = '子丑寅卯辰巳午未申酉戌亥'.split('');
export const G = '甲乙丙丁戊己庚辛壬癸'.split('');
export const M = (n: number) => ((n % 12) + 12) % 12;
export const idx = (b: string) => Z.indexOf(b);

export const daysInLunarMonth = (y: number, m: number) => {
  const s = lunar2solar(`${y}-${m}-1`, false);
  return getTotalDaysOfLunarMonth(
    `${s.solarYear}-${String(s.solarMonth).padStart(2, '0')}-${String(s.solarDay).padStart(2, '0')}`
  );
};

const WUHUDUN: Record<string, number> = { 甲: 2, 己: 2, 乙: 4, 庚: 4, 丙: 6, 辛: 6, 丁: 8, 壬: 8, 戊: 0, 癸: 0 };
const NAYIN60 = ['海中金', '炉中火', '大林木', '路旁土', '剑锋金', '山头火', '涧下水', '城头土', '白蜡金', '杨柳木',
  '泉中水', '屋上土', '霹雳火', '松柏木', '长流水', '沙中金', '山下火', '平地木', '壁上土', '金箔金', '覆灯火', '天河水',
  '大驿土', '钗钏金', '桑柘木', '大溪水', '沙中土', '天上火', '石榴木', '大海水'];
const CLASS: Record<string, number> = { 水: 2, 木: 3, 金: 4, 土: 5, 火: 6 };
const gzIndex = (g: number, z: number) => { let n = 0; while (n < 60 && !(n % 10 === g && n % 12 === z)) n++; return n; };

/** 寅起正月顺数至生月，再起子时逆数至生时 */
export const soulPalace = (m: number, t: number) => M(2 + (m - 1) - t);
export const bodyPalace = (m: number, t: number) => M(2 + (m - 1) + t);
/** 五虎遁: mod 10, not mod 12 */
export const palaceStem = (ys: string, br: number) => (WUHUDUN[ys] + M(br - 2)) % 10;

export function fiveClass(ys: string, soulBr: number) {
  const ny = NAYIN60[Math.floor(gzIndex(palaceStem(ys, soulBr), soulBr) / 2)];
  return { n: CLASS[ny[ny.length - 1]], ny };
}

/** 局数除日数求商，补数奇逆偶顺 */
export function ziweiPalace(j: number, d: number) {
  let n = 0;
  while ((d + n) % j !== 0) n++;
  const q = (d + n) / j;
  return M(2 + q - 1 + (n % 2 === 0 ? n : -n));
}

export const LU: Record<string, number> = { 甲: 2, 乙: 3, 丙: 5, 戊: 5, 丁: 6, 己: 6, 庚: 8, 辛: 9, 壬: 11, 癸: 0 };
export const KUI: Record<string, number> = { 甲: 1, 戊: 1, 庚: 1, 乙: 0, 己: 0, 丙: 11, 丁: 11, 壬: 3, 癸: 3, 辛: 6 };
export const YUE: Record<string, number> = { 甲: 7, 戊: 7, 庚: 7, 乙: 8, 己: 8, 丙: 9, 丁: 9, 壬: 5, 癸: 5, 辛: 2 };
export const HUO: Record<string, number> = { 寅: 1, 午: 1, 戌: 1, 申: 2, 子: 2, 辰: 2, 巳: 3, 酉: 3, 丑: 3, 亥: 9, 卯: 9, 未: 9 };
export const LING: Record<string, number> = { 寅: 3, 午: 3, 戌: 3, 申: 10, 子: 10, 辰: 10, 巳: 10, 酉: 10, 丑: 10, 亥: 10, 卯: 10, 未: 10 };
export const MA: Record<string, number> = { 寅: 8, 午: 8, 戌: 8, 申: 2, 子: 2, 辰: 2, 巳: 11, 酉: 11, 丑: 11, 亥: 5, 卯: 5, 未: 5 };

/**
 * 四化. NOTE: 庚 is deliberately absent — 庚干四化 is historically disputed and the
 * spec's table omits it. The iztro-2.6.0 snapshot for 庚 is asserted separately below.
 */
export const MUT: Record<string, string[]> = {
  甲: ['廉贞', '破军', '武曲', '太阳'], 乙: ['天机', '天梁', '紫微', '太阴'], 丙: ['天同', '天机', '文昌', '廉贞'],
  丁: ['太阴', '天同', '天机', '巨门'], 戊: ['贪狼', '太阴', '右弼', '天机'], 己: ['武曲', '贪狼', '天梁', '文曲'],
  辛: ['巨门', '太阳', '文曲', '文昌'], 壬: ['天梁', '紫微', '左辅', '武曲'], 癸: ['破军', '巨门', '太阴', '贪狼'],
};
export const MUT_TAGS = ['禄', '权', '科', '忌'];

export const PALACE_NAMES = ['命宫', '兄弟', '夫妻', '子女', '财帛', '疾厄', '迁移', '仆役', '官禄', '田宅', '福德', '父母'];
export const ZIWEI_SERIES: Record<string, number> = { 紫微: 0, 天机: -1, 太阳: -3, 武曲: -4, 天同: -5, 廉贞: -8 };
export const TIANFU_SERIES: Record<string, number> = { 天府: 0, 太阴: 1, 贪狼: 2, 巨门: 3, 天相: 4, 天梁: 5, 七杀: 6, 破军: 10 };

export const stemOfLunarYear = (y: number) => G[((y - 1984) % 10 + 10) % 10];
export const branchOfLunarYear = (y: number) => Z[((y - 1984) % 12 + 12) % 12];


/** Branch index of the palace holding star `name` on a raw iztro astrolabe, or -1. */
export function findStar(chart: any, name: string): number {
  for (const p of chart.palaces) {
    for (const s of [...p.majorStars, ...p.minorStars, ...p.adjectiveStars]) {
      if (s.name === name) return idx(p.earthlyBranch);
    }
  }
  return -1;
}

export function starMutagen(chart: any, name: string): string | null {
  for (const p of chart.palaces) {
    for (const s of [...p.majorStars, ...p.minorStars, ...p.adjectiveStars]) {
      if (s.name === name) return s.mutagen || '';
    }
  }
  return null;
}

/** Same, but against this project's *trimmed* output shape (adjectiveStars are plain names). */
export function findStarTrimmed(chart: { palaces: Array<{ branch: string; majorStars: Array<{ name: string }>; minorStars: Array<{ name: string }>; adjectiveStars: string[] }> }, name: string): number {
  for (const p of chart.palaces) {
    if (p.majorStars.some(s => s.name === name) || p.minorStars.some(s => s.name === name) || p.adjectiveStars.includes(name)) {
      return idx(p.branch);
    }
  }
  return -1;
}

export const FIVE_CLASS_LABEL: Record<number, string> = { 2: '水二局', 3: '木三局', 4: '金四局', 5: '土五局', 6: '火六局' };

/** Deterministic LCG — same generator and seed pattern as tests/parity-reference.mjs. */
export function makeRandom(seed: number) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}
