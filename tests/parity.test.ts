import { describe, it, expect } from 'bun:test';
import { astro } from 'iztro';
import {
  G, M, idx, daysInLunarMonth, soulPalace, bodyPalace, palaceStem, fiveClass, ziweiPalace,
  LU, KUI, YUE, HUO, LING, MA, MUT, MUT_TAGS, PALACE_NAMES, ZIWEI_SERIES, TIANFU_SERIES,
  stemOfLunarYear, branchOfLunarYear, findStar, starMutagen, FIVE_CLASS_LABEL, makeRandom,
} from './ziwei-rules';

/**
 * §8.1 star-placement parity gate.
 *
 * Feeds iztro directly via `type:'lunar'` + `yearDivide:'normal'`, deliberately
 * bypassing this project's own time layer, so a failure here is always an
 * upstream-engine failure and never a timezone one. The oracle lives in
 * tests/ziwei-rules.ts.
 */
describe('8.1 Star-placement parity gate (independent 安星诀 vs iztro)', () => {
  it('matches the classical star-placement rules across 300 seeded random charts', () => {
    const N = 300;
    const rnd = makeRandom(20260818);
    const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];

    let checks = 0;
    const fails: string[] = [];
    const eq = (a: unknown, b: unknown, msg: string) => {
      checks++;
      if (a !== b) fails.push(`${msg}: got ${a}, want ${b}`);
    };

    for (let k = 0; k < N; k++) {
      const ly = 1930 + Math.floor(rnd() * 90);
      const lm = 1 + Math.floor(rnd() * 12);
      const maxD = daysInLunarMonth(ly, lm);
      const ld = 1 + Math.floor(rnd() * maxD);
      const ti = Math.floor(rnd() * 12); // 0..11; 12 (晚子时) is covered by the invariant suite
      const gender = pick(['male', 'female'] as const);
      const tag = `[${ly}-${lm}-${ld} ti${ti}]`;

      let chart: any;
      try {
        chart = astro.withOptions({
          type: 'lunar', dateStr: `${ly}-${lm}-${ld}`, timeIndex: ti, gender,
          isLeapMonth: false, fixLeap: false, language: 'zh-CN',
          config: { yearDivide: 'normal', horoscopeDivide: 'normal' },
        } as any);
      } catch (e) {
        fails.push(`chart build ${tag}: ${(e as Error).message}`);
        continue;
      }

      const ys = stemOfLunarYear(ly);
      const yb = branchOfLunarYear(ly);

      // 1. 命宫 / 身宫
      const sp = soulPalace(lm, ti);
      eq(idx(chart.earthlyBranchOfSoulPalace), sp, `${tag} 命宫`);
      eq(idx(chart.earthlyBranchOfBodyPalace), bodyPalace(lm, ti), `${tag} 身宫`);

      // 2. 五行局
      const fc = fiveClass(ys, sp);
      eq(chart.fiveElementsClass, FIVE_CLASS_LABEL[fc.n], `${tag} 五行局`);

      // 3. 十二宫干 (五虎遁)
      for (const p of chart.palaces) {
        eq(p.heavenlyStem, G[palaceStem(ys, idx(p.earthlyBranch))], `${tag} 宫干@${p.earthlyBranch}`);
      }

      // 4. 紫微系 / 天府系
      const zw = ziweiPalace(fc.n, ld);
      for (const [name, off] of Object.entries(ZIWEI_SERIES)) eq(findStar(chart, name), M(zw + off), `${tag} ${name}`);
      const tf = M(4 - zw);
      for (const [name, off] of Object.entries(TIANFU_SERIES)) eq(findStar(chart, name), M(tf + off), `${tag} ${name}`);

      // 5. 辅星 / 煞星
      eq(findStar(chart, '左辅'), M(4 + lm - 1), `${tag} 左辅`);
      eq(findStar(chart, '右弼'), M(10 - (lm - 1)), `${tag} 右弼`);
      eq(findStar(chart, '文昌'), M(10 - ti), `${tag} 文昌`);
      eq(findStar(chart, '文曲'), M(4 + ti), `${tag} 文曲`);
      eq(findStar(chart, '禄存'), LU[ys], `${tag} 禄存`);
      eq(findStar(chart, '擎羊'), M(LU[ys] + 1), `${tag} 擎羊`);
      eq(findStar(chart, '陀罗'), M(LU[ys] - 1), `${tag} 陀罗`);
      eq(findStar(chart, '天魁'), KUI[ys], `${tag} 天魁`);
      eq(findStar(chart, '天钺'), YUE[ys], `${tag} 天钺`);
      eq(findStar(chart, '地劫'), M(11 + ti), `${tag} 地劫`);
      eq(findStar(chart, '地空'), M(11 - ti), `${tag} 地空`);
      eq(findStar(chart, '火星'), M(HUO[yb] + ti), `${tag} 火星`);
      eq(findStar(chart, '铃星'), M(LING[yb] + ti), `${tag} 铃星`);
      eq(findStar(chart, '天马'), MA[yb], `${tag} 天马`);
      eq(findStar(chart, '红鸾'), M(3 - idx(yb)), `${tag} 红鸾`);
      eq(findStar(chart, '天喜'), M(3 - idx(yb) + 6), `${tag} 天喜`);

      // 6. 四化 (庚 omitted — disputed; see the version-snapshot test below)
      if (MUT[ys]) MUT[ys].forEach((star, i) => eq(starMutagen(chart, star), MUT_TAGS[i], `${tag} ${ys}干 ${star}四化`));

      // 7. 十二宫名: (idx(命宫支) - idx(本宫支)) mod 12 — counterclockwise by earthly branch.
      for (const p of chart.palaces) {
        eq(p.name, PALACE_NAMES[M(sp - idx(p.earthlyBranch))], `${tag} 宫名@${p.earthlyBranch}`);
      }

      // 8. 命宫大限起始年龄 === 局数
      const soulP = chart.palaces.find((p: any) => idx(p.earthlyBranch) === sp);
      eq(soulP.decadal.range[0], fc.n, `${tag} 大限起始`);
    }

    expect(fails.slice(0, 25)).toEqual([]);
    expect(checks).toBeGreaterThan(15000);
  });

  /**
   * iztro VERSION SNAPSHOT, not a classical-consensus claim.
   *
   * 庚干四化 is historically disputed and the spec's MUT table deliberately omits it.
   * iztro 2.6.0 uses 太阳禄 / 武曲权 / 太阴科 / 天同忌. This test exists solely to catch an
   * upstream version bump changing that choice — a failure here means "iztro moved", and
   * the correct response is to review and re-baseline, not to assume iztro became wrong.
   */
  it('庚干四化 iztro 2.6.0 version snapshot: 太阳禄 / 武曲权 / 太阴科 / 天同忌', () => {
    expect(stemOfLunarYear(1990)).toBe('庚'); // 1990 is a 庚午 lunar year
    const chart: any = astro.withOptions({
      type: 'lunar', dateStr: '1990-5-23', timeIndex: 6, gender: 'male',
      isLeapMonth: false, fixLeap: false, language: 'zh-CN',
      config: { yearDivide: 'normal', horoscopeDivide: 'normal' },
    } as any);

    expect(starMutagen(chart, '太阳')).toBe('禄');
    expect(starMutagen(chart, '武曲')).toBe('权');
    expect(starMutagen(chart, '太阴')).toBe('科');
    expect(starMutagen(chart, '天同')).toBe('忌');
  });
});
