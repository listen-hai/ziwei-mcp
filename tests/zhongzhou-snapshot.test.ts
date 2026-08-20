import { describe, it, expect, afterAll } from 'bun:test';
import { astro } from 'iztro';
import {
  G, idx, daysInLunarMonth, MUT, MUT_TAGS, FIVE_CLASS_LABEL, starMutagen, makeRandom,
} from './ziwei-rules';

/**
 * 中州派 switches — behavioural lock, NOT a doctrine gate.
 *
 * READ docs/zhongzhou-findings.md BEFORE trusting anything here.
 *
 * Two very different things are asserted below, and conflating them is exactly the
 * mistake this suite exists to prevent:
 *
 *   1. Rules with independent documentary support (中州派 天伤天使 阴男阳女互换;
 *      地盘/人盘 = 身宫/福德宫作命宫 + 该宫干支纳音起五行局). Sources are secondary
 *      web transcriptions, not 王亭之's printed books — "supported", never "verified".
 *
 *   2. An iztro-2.6.0 BEHAVIOUR SNAPSHOT of the highest-value finding: turning on
 *      `algorithm:'zhongzhou'` does NOT change 四化 at all, even though the documented
 *      中州派 positions for 庚/壬 (天府化科) differ from the 通行版 iztro keeps using.
 *      This test passing means "iztro still has that gap", not "iztro is correct".
 *      If it ever FAILS, that is good news — iztro changed — and the findings doc's
 *      grading table must be re-run, not the assertion loosened.
 */

const cfg = (algorithm: 'default' | 'zhongzhou') => ({
  yearDivide: 'normal' as const, horoscopeDivide: 'normal' as const,
  ageDivide: 'normal' as const, dayDivide: 'current' as const, algorithm,
});
const build = (
  p: { ly: number; lm: number; ld: number; ti: number; gender: 'male' | 'female' },
  algorithm: 'default' | 'zhongzhou',
  astroType: 'heaven' | 'earth' | 'human',
) => astro.withOptions({
  type: 'lunar', dateStr: `${p.ly}-${p.lm}-${p.ld}`, timeIndex: p.ti, gender: p.gender,
  isLeapMonth: false, fixLeap: false, language: 'zh-CN', astroType, config: cfg(algorithm),
});

function seededCharts(n: number, seed: number) {
  const rnd = makeRandom(seed);
  const out: Array<{ ly: number; lm: number; ld: number; ti: number; gender: 'male' | 'female' }> = [];
  for (let k = 0; k < n; k++) {
    const ly = 1930 + Math.floor(rnd() * 90);
    const lm = 1 + Math.floor(rnd() * 12);
    out.push({
      ly, lm,
      ld: 1 + Math.floor(rnd() * daysInLunarMonth(ly, lm)),
      ti: Math.floor(rnd() * 12),
      gender: rnd() < 0.5 ? 'male' : 'female',
    });
  }
  return out;
}

/** Branch of the palace holding `name`, searching adjectiveStars only. */
const adjBranch = (chart: any, name: string): string | undefined =>
  chart.palaces.find((p: any) => p.adjectiveStars.some((s: any) => s.name === name))?.earthlyBranch;

describe('中州派 switches (docs/zhongzhou-findings.md)', () => {
  // iztro's config is module-level, global and sticky (findings doc 结论 E). Every build()
  // here sets algorithm:'zhongzhou'; other suites pass a config WITHOUT an `algorithm` key,
  // and astro.config() merges — so leaving it set would silently contaminate them. Do not
  // rely on this file sorting last.
  afterAll(() => { astro.config({ algorithm: 'default' }); });

  it('SNAPSHOT: algorithm:"zhongzhou" leaves 四化 completely untouched (documented 中州派 庚/壬 差异 NOT implemented)', () => {
    // 庚 is absent from ziwei-rules' MUT on purpose (disputed); assert it as an
    // explicit iztro snapshot alongside the nine consensus stems.
    const MUT_GENG_IZTRO = ['太阳', '武曲', '太阴', '天同'];
    const fails: string[] = [];
    for (const p of seededCharts(200, 20260819)) {
      const ys = G[((p.ly - 1984) % 10 + 10) % 10];
      const table = MUT[ys] ?? MUT_GENG_IZTRO;
      const chart = build(p, 'zhongzhou', 'heaven');
      table.forEach((star, i) => {
        const got = starMutagen(chart, star);
        if (got !== MUT_TAGS[i]) fails.push(`[${p.ly} ${ys}] ${star}: got ${got}, want ${MUT_TAGS[i]}`);
      });
    }
    expect(fails).toEqual([]);
  });

  it('SNAPSHOT: 庚 stays 太阴化科 under zhongzhou — the documented 中州派 rule is 天府化科', () => {
    // 1930 = 庚午. If this ever reads 天府, iztro adopted the 中州派 table: re-read the findings doc.
    const chart = build({ ly: 1930, lm: 5, ld: 12, ti: 3, gender: 'male' }, 'zhongzhou', 'heaven');
    expect(starMutagen(chart, '太阴')).toBe('科');
    expect(starMutagen(chart, '天府')).toBe('');
  });

  it('SUPPORTED: 天伤/天使 sit in 仆役/疾厄, swapping for 阴男阳女', () => {
    // 《中州派紫微斗数深造讲义·杂曜总论》: 阳男阴女顺行，安天伤于交友宫，天使于疾厄宫；
    // 阴男阳女逆行，则安天伤于疾厄宫，天使于交友宫。
    const fails: string[] = [];
    for (const p of seededCharts(200, 777001)) {
      const chart = build(p, 'zhongzhou', 'heaven');
      const nu = chart.palaces.find((x: any) => x.name === '仆役')!.earthlyBranch;
      const ji = chart.palaces.find((x: any) => x.name === '疾厄')!.earthlyBranch;
      const yearBranchIsYang = ((p.ly - 1984) % 12 + 12) % 12 % 2 === 0;
      const yangManYinWoman = yearBranchIsYang === (p.gender === 'male');
      const wantShang = yangManYinWoman ? nu : ji;
      const wantShi = yangManYinWoman ? ji : nu;
      if (adjBranch(chart, '天伤') !== wantShang || adjBranch(chart, '天使') !== wantShi) {
        fails.push(`[${p.ly}-${p.lm}-${p.ld} ti${p.ti} ${p.gender}] 天伤=${adjBranch(chart, '天伤')} 天使=${adjBranch(chart, '天使')}, want ${wantShang}/${wantShi}`);
      }
    }
    expect(fails).toEqual([]);
  });

  it('SUPPORTED: 地盘/人盘 re-seat 命宫 on 身宫/福德宫 and re-derive 五行局 from that palace 干支纳音', () => {
    const fails: string[] = [];
    for (const p of seededCharts(150, 424242)) {
      const heaven = build(p, 'default', 'heaven');
      const wantEarth = heaven.palaces.find((x: any) => x.isBodyPalace)!;
      const wantHuman = heaven.palaces.find((x: any) => x.name === '福德')!;
      for (const [type, want] of [['earth', wantEarth], ['human', wantHuman]] as const) {
        const chart = build(p, 'default', type);
        if (chart.earthlyBranchOfSoulPalace !== want.earthlyBranch) {
          fails.push(`[${p.ly}-${p.lm}-${p.ld} ti${p.ti}] ${type} 命宫: ${chart.earthlyBranchOfSoulPalace} != ${want.earthlyBranch}`);
        }
        // ziwei-rules' fiveClass takes a YEAR stem and applies 五虎遁; 地盘/人盘 instead use the
        // palace's own 干支 directly, so derive the 纳音 from that pillar (helper at the bottom).
        const nayinN = fiveClassFromPillar(want.heavenlyStem, want.earthlyBranch);
        if (chart.fiveElementsClass !== FIVE_CLASS_LABEL[nayinN]) {
          fails.push(`[${p.ly}-${p.lm}-${p.ld} ti${p.ti}] ${type} 五行局: ${chart.fiveElementsClass} != ${FIVE_CLASS_LABEL[nayinN]} (from ${want.heavenlyStem}${want.earthlyBranch})`);
        }
      }
    }
    expect(fails).toEqual([]);
  });

  it('SNAPSHOT: the two switches are orthogonal — astroType applies under algorithm:"default" too', () => {
    // src/mcp/server.ts and src/schemas/input.ts both claim astroType is "only meaningful
    // with algorithm: zhongzhou". It is not. See findings doc, 结论 A.
    const p = { ly: 1985, lm: 7, ld: 20, ti: 4, gender: 'female' as const };
    const dHeaven = build(p, 'default', 'heaven');
    const dEarth = build(p, 'default', 'earth');
    expect(dEarth.earthlyBranchOfSoulPalace).not.toBe(dHeaven.earthlyBranchOfSoulPalace);
    // and the astroType effect is identical under both algorithms
    const zEarth = build(p, 'zhongzhou', 'earth');
    expect(zEarth.earthlyBranchOfSoulPalace).toBe(dEarth.earthlyBranchOfSoulPalace);
    expect(zEarth.fiveElementsClass).toBe(dEarth.fiveElementsClass);
  });
});

/** 纳音五行局 straight from a 干支 pillar (地盘/人盘 use the palace's own 干支, not the year stem). */
function fiveClassFromPillar(stem: string, branch: string): number {
  const NAYIN60 = ['海中金', '炉中火', '大林木', '路旁土', '剑锋金', '山头火', '涧下水', '城头土', '白蜡金', '杨柳木',
    '泉中水', '屋上土', '霹雳火', '松柏木', '长流水', '沙中金', '山下火', '平地木', '壁上土', '金箔金', '覆灯火', '天河水',
    '大驿土', '钗钏金', '桑柘木', '大溪水', '沙中土', '天上火', '石榴木', '大海水'];
  const CLASS: Record<string, number> = { 水: 2, 木: 3, 金: 4, 土: 5, 火: 6 };
  const g = G.indexOf(stem), z = idx(branch);
  let n = 0;
  while (n < 60 && !(n % 10 === g && n % 12 === z)) n++;
  const ny = NAYIN60[Math.floor(n / 2)];
  return CLASS[ny[ny.length - 1]];
}
