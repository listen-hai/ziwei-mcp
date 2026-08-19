import { describe, it, expect } from 'bun:test';
import { astro } from 'iztro';
import { solar2lunar } from 'lunar-lite';
import { daysInLunarMonth, makeRandom } from './ziwei-rules';
// The 运限 oracle is an independent classical implementation; see the header of that file.
// It is imported rather than transplanted because it is pure and has no `src/` coupling.
import { expectHoroscope } from '../docs/horoscope-parity-reference.mjs';

/**
 * §12 运限 parity gate — 大限/童限/小限/流年/流月/流日/流时, their 干支, 十二宫名 rotation,
 * 运四化, the ten 运曜, plus 年解 / 岁前十二神 / 将前十二神.
 *
 * Baseline: 800 charts x 10 targets = 303,582 assertions, 0 mismatches (iztro 2.6.0).
 * Full sweep: `bun run docs/horoscope-parity-reference.mjs 800 10`
 *
 * Scope guards deliberately excluded here because iztro is *known wrong* there
 * (documented, with reproducers, in `bun run docs/horoscope-parity-reference.mjs edges`):
 *   - target lunar year < natal lunar year  → index -1 and untranslated i18n keys
 *   - target timeIndex 12 (晚子时)           → 日干支 advances, 流日宫位 does not
 */
describe('12 Horoscope (运限) parity gate (independent classical rules vs iztro)', () => {
  it('matches the classical 运限 rules across 200 seeded charts x 4 target dates', () => {
    const rnd = makeRandom(20260819);
    const fails: string[] = [];
    let checks = 0;
    const ser = (v: unknown) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? JSON.stringify(Object.keys(v as object).sort().map(k => [k, (v as any)[k]]))
        : JSON.stringify(v);
    const eq = (got: unknown, want: unknown, msg: string) => {
      checks++;
      if (ser(got) !== ser(want)) fails.push(`${msg}: got ${ser(got)}, want ${ser(want)}`);
    };

    for (let k = 0; k < 200; k++) {
      const ly = 1930 + Math.floor(rnd() * 90);
      const lm = 1 + Math.floor(rnd() * 12);
      const ld = 1 + Math.floor(rnd() * daysInLunarMonth(ly, lm));
      const ti = Math.floor(rnd() * 12);
      const gender = rnd() < 0.5 ? 'male' : 'female';

      const chart = astro.withOptions({
        type: 'lunar', dateStr: `${ly}-${lm}-${ld}`, timeIndex: ti, gender,
        isLeapMonth: false, fixLeap: false, language: 'zh-CN',
        config: { yearDivide: 'normal', horoscopeDivide: 'normal', ageDivide: 'normal', dayDivide: 'current' },
      } as any);

      for (let j = 0; j < 4; j++) {
        const target = `${ly + Math.floor(rnd() * 95)}-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`;
        if (solar2lunar(target).lunarYear < ly) continue; // pre-birth: iztro returns garbage, see edges()
        const tTi = Math.floor(rnd() * 12);
        const tag = `[${ly}-${lm}-${ld} ti${ti} ${gender} → ${target} ti${tTi}]`;

        const h: any = chart.horoscope(target, tTi);
        const want: any = expectHoroscope({ lunarYear: ly, lunarMonth: lm, lunarDay: ld, timeIndex: ti, gender }, target, tTi);

        for (const s of ['decadal', 'age', 'yearly', 'monthly', 'daily', 'hourly'] as const) {
          eq(h[s].index, want[s].index, `${tag} ${s}.index`);
          eq(h[s].heavenlyStem, want[s].stem, `${tag} ${s}.stem`);
          eq(h[s].earthlyBranch, want[s].branch, `${tag} ${s}.branch`);
          eq(h[s].palaceNames, want[s].palaceNames, `${tag} ${s}.palaceNames`);
          eq(h[s].mutagen, want[s].mutagen, `${tag} ${s}.mutagen`);
          if (s === 'age') { eq(h.age.nominalAge, want.age.nominalAge, `${tag} age.nominalAge`); continue; }
          const got: Record<string, number> = {};
          (h[s].stars ?? []).forEach((arr: any[], i: number) => arr.forEach(x => { got[x.name] = i; }));
          eq(got, want[s].stars, `${tag} ${s}.stars`);
        }
        eq(h.yearly.yearlyDecStar?.suiqian12, want.yearly.suiqian12, `${tag} yearly.suiqian12`);
        eq(h.yearly.yearlyDecStar?.jiangqian12, want.yearly.jiangqian12, `${tag} yearly.jiangqian12`);
      }
    }

    if (fails.length) throw new Error(`${fails.length}/${checks} mismatches:\n  ${fails.slice(0, 20).join('\n  ')}`);
    expect(checks).toBeGreaterThan(20000);
  });
});
