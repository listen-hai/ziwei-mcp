/**
 * 运限（horoscope）独立古籍对拍脚本 —— tests/parity-reference.mjs 的姊妹篇。
 *
 * 覆盖：大限 / 童限 / 小限 / 流年 / 流月 / 流日 / 流时，各自的宫位、干支、
 * 十二宫名旋转、运四化、十条运曜（禄羊陀魁钺昌曲马鸾喜），以及流年专属的
 * 年解 / 岁前十二神 / 将前十二神。
 *
 * 独立性：安星常数原样抄自 tests/parity-reference.mjs（已验证 50,104 断言 0 不符）；
 * 新增的表（流昌流曲、小限起宫、童限、岁前/将前十二神）来自古籍口诀，未读 iztro 源码。
 * 日柱干支用 JDN + 49 (mod 60)，与 @openfate/bazi-engine（lunar-javascript）在
 * 1800–2100 抽样完全一致，且 1949-10-01 = 甲子日、1900-01-01 = 甲戌日 校验通过 ——
 * 与 iztro 无共享代码路径。
 *
 * 用法：bun run tests/horoscope-parity-reference.mjs [charts=300] [targetsPerChart=6]
 */
import { astro } from 'iztro';
import { getTotalDaysOfLunarMonth, lunar2solar, solar2lunar } from 'lunar-lite';

const daysInLunarMonth = (y, m) => {
  const s = lunar2solar(`${y}-${m}-1`, false);
  return getTotalDaysOfLunarMonth(`${s.solarYear}-${String(s.solarMonth).padStart(2, '0')}-${String(s.solarDay).padStart(2, '0')}`);
};

// ─────────────────────────── 已验证常数（原样抄自 parity-reference.mjs）
const Z = '子丑寅卯辰巳午未申酉戌亥'.split('');
const G = '甲乙丙丁戊己庚辛壬癸'.split('');
const M = n => ((n % 12) + 12) % 12;
const M10 = n => ((n % 10) + 10) % 10;
const idx = b => Z.indexOf(b);
const WUHUDUN = { 甲: 2, 己: 2, 乙: 4, 庚: 4, 丙: 6, 辛: 6, 丁: 8, 壬: 8, 戊: 0, 癸: 0 };
const NAYIN60 = ['海中金','炉中火','大林木','路旁土','剑锋金','山头火','涧下水','城头土','白蜡金','杨柳木',
  '泉中水','屋上土','霹雳火','松柏木','长流水','沙中金','山下火','平地木','壁上土','金箔金','覆灯火','天河水',
  '大驿土','钗钏金','桑柘木','大溪水','沙中土','天上火','石榴木','大海水'];
const CLASS = { 水: 2, 木: 3, 金: 4, 土: 5, 火: 6 };
const gzIndex = (g, z) => { let n = 0; while (n < 60 && !(n % 10 === g && n % 12 === z)) n++; return n; };
const soulPalace = (m, t) => M(2 + (m - 1) - t);
const palaceStem = (ys, br) => (WUHUDUN[ys] + M(br - 2)) % 10;
function fiveClass(ys, soulBr) {
  const ny = NAYIN60[Math.floor(gzIndex(palaceStem(ys, soulBr), soulBr) / 2)];
  return CLASS[ny[ny.length - 1]];
}
const LU  = { 甲: 2, 乙: 3, 丙: 5, 戊: 5, 丁: 6, 己: 6, 庚: 8, 辛: 9, 壬: 11, 癸: 0 };
const KUI = { 甲: 1, 戊: 1, 庚: 1, 乙: 0, 己: 0, 丙: 11, 丁: 11, 壬: 3, 癸: 3, 辛: 6 };
const YUE = { 甲: 7, 戊: 7, 庚: 7, 乙: 8, 己: 8, 丙: 9, 丁: 9, 壬: 5, 癸: 5, 辛: 2 };
const MA  = { 寅: 8, 午: 8, 戌: 8, 申: 2, 子: 2, 辰: 2, 巳: 11, 酉: 11, 丑: 11, 亥: 5, 卯: 5, 未: 5 };
const MUT = {
  甲: ['廉贞','破军','武曲','太阳'], 乙: ['天机','天梁','紫微','太阴'], 丙: ['天同','天机','文昌','廉贞'],
  丁: ['太阴','天同','天机','巨门'], 戊: ['贪狼','太阴','右弼','天机'], 己: ['武曲','贪狼','天梁','文曲'],
  辛: ['巨门','太阳','文曲','文昌'], 壬: ['天梁','紫微','左辅','武曲'], 癸: ['破军','巨门','太阴','贪狼'],
};
/** 庚干四化历来有争议，古籍无共识。这是 iztro 2.6.0 的版本快照，不是古籍结论。 */
const MUT_GENG_IZTRO_SNAPSHOT = ['太阳','武曲','太阴','天同'];
const PALACES = ['命宫','兄弟','夫妻','子女','财帛','疾厄','迁移','仆役','官禄','田宅','福德','父母'];

// ─────────────────────────── 运限专属表（古籍口诀，本轮新增）
/**
 * 流昌（流年文昌）：「甲乙巳午报君知，丙戊申宫丁己酉，庚猪辛鼠壬逢虎，癸人见卯入云梯」
 * 流曲（流年文曲）与流昌以丑未轴对称：流曲 = (2 − 流昌) mod 12。
 * 注意：这【不是】本命昌曲的时辰公式（昌 = 10 − 时，曲 = 4 + 时）——本命昌曲按时辰，
 * 运昌运曲按运干，两套规则完全不同。
 */
const CHANG = { 甲: 5, 乙: 6, 丙: 8, 戊: 8, 丁: 9, 己: 9, 庚: 11, 辛: 0, 壬: 2, 癸: 3 };
const QU = st => M(2 - CHANG[st]);

/** 小限起宫：年支三合局。寅午戌起辰、申子辰起戌、巳酉丑起未、亥卯未起丑。 */
const XIAO_START = { 寅: 4, 午: 4, 戌: 4, 申: 10, 子: 10, 辰: 10, 巳: 7, 酉: 7, 丑: 7, 亥: 1, 卯: 1, 未: 1 };

/** 童限（起大限之前的虚岁）：一命二财三疾厄四妻五福六官禄。值为宫名在 PALACES 中的序号。 */
const TONGXIAN = [0, 4, 5, 2, 10, 8];

/** 岁前十二神，自流年支起顺行。 */
const SUIQIAN12 = ['岁建','晦气','丧门','贯索','官符','小耗','大耗','龙德','白虎','天德','吊客','病符'];
/** 将前十二神，将星按年支三合（寅午戌→午、申子辰→子、巳酉丑→酉、亥卯未→卯）起，顺行。 */
const JIANGQIAN12 = ['将星','攀鞍','岁驿','息神','华盖','劫煞','灾煞','天煞','指背','咸池','月煞','亡神'];
const JIANG_START = { 寅: 6, 午: 6, 戌: 6, 申: 0, 子: 0, 辰: 0, 巳: 9, 酉: 9, 丑: 9, 亥: 3, 卯: 3, 未: 3 };

// 宫序 index（0 = 寅）↔ 地支序 branch（0 = 子）
const pi2bi = i => M(i + 2);
const bi2pi = b => M(b - 2);

// ─────────────────────────── 日柱：JDN + 49 (mod 60)，与 iztro 无共享代码
function jdn(y, m, d) {
  const a = Math.floor((14 - m) / 12), yy = y + 4800 - a, mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}
const dayGzIndex = (y, m, d) => ((jdn(y, m, d) + 49) % 60 + 60) % 60;

const stemOfYear = y => G[M10(y - 1984)];
const branchOfYear = y => Z[M(y - 1984)];

// ─────────────────────────── 运曜：本命公式，换成该运的干/支
/** 返回 { 星名后缀 -> 宫序 index }，供各运限共用。 */
function scopeStars(stem, branch) {
  const lu = LU[stem], b = idx(branch), luan = M(3 - b);
  return {
    禄: bi2pi(lu), 羊: bi2pi(M(lu + 1)), 陀: bi2pi(M(lu - 1)),
    魁: bi2pi(KUI[stem]), 钺: bi2pi(YUE[stem]),
    昌: bi2pi(CHANG[stem]), 曲: bi2pi(QU(stem)),
    马: bi2pi(MA[branch]),
    鸾: bi2pi(luan), 喜: bi2pi(M(luan + 6)),
  };
}
const mutagenOf = stem => (stem === '庚' ? MUT_GENG_IZTRO_SNAPSHOT : MUT[stem]);
/** 十二宫名以该运宫为命宫逆时针排布：palaceNames[i] = PALACES[(scope − i) mod 12] */
const palaceNamesOf = scopeIdx => Array.from({ length: 12 }, (_, i) => PALACES[M(scopeIdx - i)]);

// ─────────────────────────── 独立预期：一张本命盘 + 一个目标时刻
/**
 * @param natal {lunarYear,lunarMonth,lunarDay,timeIndex,gender}
 * @param target 'YYYY-MM-DD' 公历
 * @param targetTi 0..11 流时时辰序（古籍无晚子时之说，12 见报告的边界章节）
 */
export function expectHoroscope(natal, target, targetTi = 0) {
  const { lunarYear: ny, lunarMonth: nm, lunarDay: nd, timeIndex: nti, gender } = natal;
  const ys = stemOfYear(ny);
  const soulBr = soulPalace(nm, nti);
  const soulPi = bi2pi(soulBr);
  const ju = fiveClass(ys, soulBr);
  const yangYear = M10(ny - 1984) % 2 === 0;
  const male = gender === 'male';

  const [ty, tm, td] = target.split('-').map(Number);
  const tl = solar2lunar(target);            // 流年以正月初一分界（horoscopeDivide:'normal'）
  const age = tl.lunarYear - ny + 1;         // 虚岁（ageDivide:'normal'）

  const out = {};

  // ── 大限 / 童限
  if (age >= ju) {
    const dir = (male === yangYear) ? 1 : -1;       // 阳男阴女顺，阴男阳女逆
    const k = Math.floor((age - ju) / 10);
    out.decadal = { index: M(soulPi + dir * k), palaceOwnGz: true };
  } else {
    out.decadal = { index: M(soulPi - TONGXIAN[age - 1]), palaceOwnGz: true, tongxian: true };
  }

  // ── 小限：男顺女逆（见报告：这是流派选择，iztro 取通行版）
  {
    const dir = male ? 1 : -1;
    const br = M(XIAO_START[branchOfYear(ny)] + dir * (age - 1));
    out.age = { index: bi2pi(br), nominalAge: age, palaceOwnGz: true };
  }

  // ── 流年
  {
    const b = branchOfYear(tl.lunarYear);
    out.yearly = { index: bi2pi(idx(b)), stem: stemOfYear(tl.lunarYear), branch: b };
    const yb = idx(b);
    out.yearly.年解 = bi2pi(M(10 - yb));                       // 戌上起子年，逆行
    out.yearly.suiqian12 = Array.from({ length: 12 }, (_, i) => SUIQIAN12[M(pi2bi(i) - yb)]);
    const js = JIANG_START[b];
    out.yearly.jiangqian12 = Array.from({ length: 12 }, (_, i) => JIANGQIAN12[M(pi2bi(i) - js)]);
  }

  // ── 流月：斗君 = 流年宫 逆数至生月 再顺数至生时；闰月过十五算下月
  {
    let me = tl.lunarMonth;
    if (tl.isLeap && tl.lunarDay > 15) me += 1;               // 实测分界在十六，不是十五
    const doujun = M(out.yearly.index - (nm - 1) + nti);
    out.monthly = {
      index: M(doujun + (me - 1)),
      stem: G[(WUHUDUN[out.yearly.stem] + (me - 1)) % 10],     // 五虎遁
      branch: Z[M(2 + me - 1)],
      effMonth: me, doujun,
    };
  }

  // ── 流日：流月宫起初一顺行
  {
    const n = dayGzIndex(ty, tm, td);
    out.daily = {
      index: M(out.monthly.index + (tl.lunarDay - 1)),
      stem: G[n % 10], branch: Z[n % 12], gzIndex: n,
    };
  }

  // ── 流时：流日宫起子时顺行；时干用五鼠遁
  {
    const t = M(targetTi);
    const ds = out.daily.gzIndex % 10;
    out.hourly = {
      index: M(out.daily.index + t),
      stem: G[(ds * 2 + t) % 10], branch: Z[t],
    };
  }

  // ── 每运的干支（大限/小限用本宫五虎遁干支）、四化、运曜
  const PREFIX = { decadal: '运', yearly: '流', monthly: '月', daily: '日', hourly: '时' };
  for (const k of ['decadal', 'age', 'yearly', 'monthly', 'daily', 'hourly']) {
    const s = out[k];
    if (s.palaceOwnGz) {
      s.branch = Z[pi2bi(s.index)];
      s.stem = G[palaceStem(ys, pi2bi(s.index))];
    }
    s.mutagen = mutagenOf(s.stem);
    if (k !== 'age') {
      const pfx = PREFIX[k];
      s.stars = {};
      for (const [suffix, i] of Object.entries(scopeStars(s.stem, s.branch))) s.stars[pfx + suffix] = i;
      if (k === 'yearly') s.stars['年解'] = s.年解;
    }
    s.palaceNames = palaceNamesOf(s.index);
  }
  return out;
}

// ─────────────────────────── 对拍
function run(N, TPC) {
  let checks = 0; const fails = [];
  const cover = { preBirthSkipped: 0, leapTarget: 0, leapShifted: 0, tongxian: 0, gengScope: 0, day30: 0, targets: 0 };
  const perItem = {};   // item -> [ok, bad]
  // 稳定序列化：对象按键排序，避免把「键顺序不同」误判为不符
  const ser = v => (v && typeof v === 'object' && !Array.isArray(v))
    ? JSON.stringify(Object.keys(v).sort().map(k => [k, v[k]]))
    : JSON.stringify(v);
  const eq = (got, want, item, ctx) => {
    checks++;
    const p = (perItem[item] ||= [0, 0]);
    if (ser(got) === ser(want)) p[0]++;
    else { p[1]++; if (fails.length < 40) fails.push(`${item} ${ctx}: got ${ser(got)}, want ${ser(want)}`); }
  };

  let seed = 20260819;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

  for (let c = 0; c < N; c++) {
    const ly = 1930 + Math.floor(rnd() * 90);
    const lm = 1 + Math.floor(rnd() * 12);
    const ld = 1 + Math.floor(rnd() * daysInLunarMonth(ly, lm));
    const ti = Math.floor(rnd() * 12);
    const gender = rnd() < 0.5 ? 'male' : 'female';

    let chart;
    try {
      chart = astro.withOptions({ type: 'lunar', dateStr: `${ly}-${lm}-${ld}`, timeIndex: ti, gender,
        isLeapMonth: false, fixLeap: false, language: 'zh-CN',
        config: { yearDivide: 'normal', horoscopeDivide: 'normal', ageDivide: 'normal', dayDivide: 'current' } });
    } catch (e) { fails.push(`build ${ly}-${lm}-${ld}: ${e.message}`); continue; }

    for (let j = 0; j < TPC; j++) {
      // 目标年跨越出生后 1..95 虚岁，日期随机落在全年
      const tYear = ly + Math.floor(rnd() * 95);
      const tMonth = 1 + Math.floor(rnd() * 12);
      const tDay = 1 + Math.floor(rnd() * 28);
      const tTi = Math.floor(rnd() * 12);
      const target = `${tYear}-${String(tMonth).padStart(2, '0')}-${String(tDay).padStart(2, '0')}`;
      // 目标农历年早于本命农历年 → 虚岁 ≤ 0，iztro 返回垃圾（见 edges()），本轮不计入对拍
      if (solar2lunar(target).lunarYear < ly) { cover.preBirthSkipped++; continue; }
      const ctx = `[${ly}-${lm}-${ld} ti${ti} ${gender} → ${target} ti${tTi}]`;

      let h, want;
      try { h = chart.horoscope(target, tTi); } catch (e) { fails.push(`horoscope ${ctx}: ${e.message}`); continue; }
      try { want = expectHoroscope({ lunarYear: ly, lunarMonth: lm, lunarDay: ld, timeIndex: ti, gender }, target, tTi); }
      catch (e) { fails.push(`oracle ${ctx}: ${e.message}`); continue; }

      for (const k of ['decadal', 'age', 'yearly', 'monthly', 'daily', 'hourly']) {
        const g = h[k], w = want[k];
        eq(g.index, w.index, `${k}.index`, ctx);
        eq(g.heavenlyStem, w.stem, `${k}.stem`, ctx);
        eq(g.earthlyBranch, w.branch, `${k}.branch`, ctx);
        eq(g.palaceNames, w.palaceNames, `${k}.palaceNames`, ctx);
        eq(g.mutagen, w.mutagen, `${k}.mutagen`, ctx);
        if (k === 'age') { eq(g.nominalAge, w.nominalAge, 'age.nominalAge', ctx); continue; }
        // 运曜：把 iztro 的 stars[12][] 摊成 名 -> 宫序
        const got = {};
        (g.stars || []).forEach((arr, i) => arr.forEach(s => { got[s.name] = i; }));
        eq(got, w.stars, `${k}.stars`, ctx);
      }
      cover.targets++;
      const tlc = solar2lunar(target);
      if (tlc.isLeap) { cover.leapTarget++; if (tlc.lunarDay > 15) cover.leapShifted++; }
      if (tlc.lunarDay >= 30) cover.day30++;
      if (want.decadal.tongxian) cover.tongxian++;
      for (const k of ['decadal','age','yearly','monthly','daily','hourly']) if (want[k].stem === '庚') cover.gengScope++;
      // 流年专属：岁前 / 将前十二神
      const yds = h.yearly.yearlyDecStar || {};
      eq(yds.suiqian12, want.yearly.suiqian12, 'yearly.suiqian12', ctx);
      eq(yds.jiangqian12, want.yearly.jiangqian12, 'yearly.jiangqian12', ctx);
    }
  }

  const items = Object.keys(perItem).sort();
  const pad = s => s + ' '.repeat(Math.max(0, 26 - s.length));
  console.log(`charts=${N}  targets/chart=${TPC}  checks=${checks}  mismatches=${fails.length}\n`);
  console.log(pad('item') + '     ok    bad');
  for (const it of items) console.log(pad(it) + String(perItem[it][0]).padStart(7) + String(perItem[it][1]).padStart(7));
  console.log('\ncoverage: ' + JSON.stringify(cover));
  if (fails.length) { console.log('\nfirst mismatches:'); fails.slice(0, 40).forEach(f => console.log('  ✗', f)); }
  return fails.length;
}

// ─────────────────────────── 设计问题的可复现探针（bun run … edges）
function edges() {
  const mk = (ly, lm, ld, ti, g, cfg = {}) => astro.withOptions({ type: 'lunar', dateStr: `${ly}-${lm}-${ld}`,
    timeIndex: ti, gender: g, isLeapMonth: false, fixLeap: false, language: 'zh-CN',
    config: { yearDivide: 'normal', horoscopeDivide: 'normal', ageDivide: 'normal', dayDivide: 'current', ...cfg } });
  const J = v => JSON.stringify(v);

  console.log('## Q1 年段解耦：{decadal, age, yearly} 是否只依赖农历年');
  {
    let same = 0, diff = 0, ageDiff = 0;
    let seed = 42; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let k = 0; k < 120; k++) {
      const ly = 1930 + Math.floor(rnd() * 80), lm = 1 + Math.floor(rnd() * 12);
      const ld = 1 + Math.floor(rnd() * daysInLunarMonth(ly, lm)), ti = Math.floor(rnd() * 12);
      const c = mk(ly, lm, ld, ti, rnd() < .5 ? 'male' : 'female');
      const ty = ly + 20 + Math.floor(rnd() * 50);
      // 两个日期必须落在【同一农历年】：取该农历年三月初一 与 十月初一 的公历
      const a = lunar2solar(`${ty}-3-1`, false), b = lunar2solar(`${ty}-10-1`, false);
      const da = `${a.solarYear}-${String(a.solarMonth).padStart(2,'0')}-${String(a.solarDay).padStart(2,'0')}`;
      const db = `${b.solarYear}-${String(b.solarMonth).padStart(2,'0')}-${String(b.solarDay).padStart(2,'0')}`;
      const ha = c.horoscope(da), hb = c.horoscope(db);
      const pick = h => J([h.decadal, h.age, h.yearly]);
      pick(ha) === pick(hb) ? same++ : diff++;
      if (J(ha.monthly) === J(hb.monthly)) ageDiff++;   // 应为 0：流月必须随日期变
    }
    console.log(`  同农历年两日期 {decadal,age,yearly} 完全相同: ${same}/${same + diff}；流月意外相同: ${ageDiff}`);
  }
  {
    // ageDivide:'birthday' 下年段解耦是否仍成立
    const c = mk(1990, 5, 20, 3, 'male', { ageDivide: 'birthday' });
    const a = c.horoscope('2025-03-01'), b = c.horoscope('2025-11-01');
    console.log(`  ageDivide:'birthday' 同年两日期 age 块相同? ${J(a.age) === J(b.age)}  (${a.age.nominalAge} vs ${b.age.nominalAge})`);
  }

  console.log('\n## Q1b 致命：spec §5 的 feedYear 绕过会摧毁大限/小限 —— 虚岁按【喂入】农历年算');
  {
    // 真实生年 1990 庚午（腊月二十 → 公历 1991-02-04）。干支同为庚午：1930 / 1990 / 2050。
    for (const fy of [1990, 1991, 1930, 2050]) {
      const h = mk(fy, 12, 20, 3, 'male').horoscope('2025-06-01');
      console.log(`  feedYear=${fy}: 虚岁=${h.age.nominalAge} 大限=${h.decadal.index}(${h.decadal.heavenlyStem}${h.decadal.earthlyBranch}) 小限=${h.age.index} 流年=${h.yearly.heavenlyStem}${h.yearly.earthlyBranch}`);
    }
    console.log('  → 流年只看目标日期，不受影响；虚岁/大限/小限 = f(目标农历年 − 喂入农历年)，P2b 的 ±60 回退直接把这一层算废。');
  }

  console.log('\n## Q2 目标时刻怎么传：Date / 带时刻的字符串会隐式给出流时时辰');
  {
    const c = mk(1990, 12, 20, 3, 'male');
    for (const [lbl, arg] of [['\'2025-03-15\'', '2025-03-15'],
                              ['\'2025-03-15 13:30:00\'', '2025-03-15 13:30:00'],
                              ['new Date(…T13:30)', new Date('2025-03-15T13:30:00')],
                              ['new Date(…T23:30)', new Date('2025-03-15T23:30:00')]]) {
      const h = c.horoscope(arg);
      console.log(`  ${lbl}: 流日=${h.daily.heavenlyStem}${h.daily.earthlyBranch} daily.index=${h.daily.index} 流时=${h.hourly.heavenlyStem}${h.hourly.earthlyBranch}`);
    }
    console.log('  → 时刻被解析成时辰；但 23:30（晚子）触发上面 Q4a 的日柱/宫位不同步，且这是「传一个瞬时」的自然路径。');
    console.log(`  → horoscope() 不带参数取系统当天：${J(c.horoscope().solarDate)}（无时区概念，包装层必须自己算当地日期）`);
  }

  console.log('\n## Q3 ageDivide 语义：虚岁在哪一天跳');
  for (const [ly, lm, ld] of [[1990, 5, 1], [1990, 5, 20], [1990, 5, 29], [1972, 12, 28]])
    for (const ad of ['normal', 'birthday']) {
      const c = mk(ly, lm, ld, 3, 'male', { ageDivide: ad });
      let prev = null, flip = null;
      for (let t = Date.UTC(2025, 0, 1); t <= Date.UTC(2025, 11, 31); t += 864e5) {
        const s = new Date(t).toISOString().slice(0, 10), a = c.horoscope(s).age.nominalAge;
        if (prev !== null && a !== prev) { const l = solar2lunar(s); flip = `${s} (农历${l.lunarMonth}月${l.lunarDay}日)`; break; }
        prev = a;
      }
      console.log(`  本命农历 ${ly}-${lm}-${ld}  ageDivide=${ad}  跳岁于 ${flip ?? '(2025 年内不跳)'}`);
    }

  console.log('\n## Q4a Z2 型：目标时辰 12（晚子）下 流日宫位 与 日干支 不同步');
  {
    const c = mk(1990, 5, 20, 3, 'male');
    for (const dd of ['current', 'forward']) {
      const c2 = mk(1990, 5, 20, 3, 'male', { dayDivide: dd });
      for (const ti of [11, 12]) {
        const h = c2.horoscope('2025-03-15', ti);
        console.log(`  dayDivide=${dd} ti=${ti}: daily.index=${h.daily.index} 日干支=${h.daily.heavenlyStem}${h.daily.earthlyBranch} hourly.index=${h.hourly.index} 时干支=${h.hourly.heavenlyStem}${h.hourly.earthlyBranch} lunarDate=${h.lunarDate}`);
      }
    }
    console.log('  → ti=12 时日干支进位到次日（癸未→甲申），但 daily.index 与 lunarDate 没跟着走；dayDivide 对 horoscope 完全无效。');
  }

  console.log('\n## Q4b 出生前的目标日期：返回 -1 与未翻译的 i18n key，不报错');
  {
    const c = mk(1954, 8, 5, 3, 'female');
    for (const d of ['1954-01-12', '1900-01-01']) {
      const h = c.horoscope(d);
      console.log(`  ${d}: decadal={i:${h.decadal.index},${h.decadal.heavenlyStem}${h.decadal.earthlyBranch}} age={i:${h.age.index},虚岁${h.age.nominalAge},${h.age.heavenlyStem}${h.age.earthlyBranch}} yearly=${h.yearly.heavenlyStem}${h.yearly.earthlyBranch}`);
    }
  }

  console.log('\n## Q4c config 是全局可变状态：后建的盘会改掉先建的盘的 config');
  {
    const cB = mk(1990, 5, 20, 3, 'male', { ageDivide: 'birthday' });
    console.log('  A) 先建 birthday 盘，立即查 2025-06-13 →', cB.horoscope('2025-06-13').age.nominalAge);
    const cN = mk(1990, 5, 20, 3, 'male', { ageDivide: 'normal' });
    console.log('  B) 再建一张 normal 盘后，重查【同一张 birthday 盘】→', cB.horoscope('2025-06-13').age.nominalAge, '(应仍为 A 的值)');
    mk(1990, 5, 20, 3, 'male', { ageDivide: 'birthday' });
    console.log('  C) 再建 birthday 盘后，查【那张 normal 盘】→', cN.horoscope('2025-06-13').age.nominalAge, '(应为 36)');
  }

  console.log('\n## Q4d Z1 在运限复现：horoscopeDivide:\'exact\' 只按日期分立春');
  {
    const c = mk(1990, 5, 20, 3, 'male', { horoscopeDivide: 'exact' });
    for (const d of ['2025-02-02', '2025-02-03', '2025-02-04']) {
      const h = c.horoscope(d);
      console.log(`  ${d} → 流年 ${h.yearly.heavenlyStem}${h.yearly.earthlyBranch}`);
    }
    console.log('  2025 立春 = 2/3 22:10，故 2/3 当日 22:10 之前应仍为甲辰。iztro 整日算乙巳。');
  }

  console.log('\n## Q4d-2 更严重：exact 下 流年按立春分界，虚岁/大限/小限却按正月初一 —— 同一次调用内部自相矛盾');
  {
    const c = mk(1990, 5, 10, 3, 'male', { horoscopeDivide: 'exact' });
    for (const d of ['2024-02-03', '2024-02-04', '2024-02-09', '2024-02-10']) {
      const h = c.horoscope(d);
      console.log(`  ${d} 流年=${h.yearly.heavenlyStem}${h.yearly.earthlyBranch} 虚岁=${h.age.nominalAge} 大限=${h.decadal.index}(${h.decadal.heavenlyStem}${h.decadal.earthlyBranch}) 小限=${h.age.index}`);
    }
    console.log("  → 2024 立春 2/4、正月初一 2/10：中间 6 天流年已进甲辰，大限/小限仍在癸卯年。'normal' 下无此裂缝。");
  }

  console.log('\n## 边界补充：fixLeap 对流月无效；algorithm/astroType 会改运限（本轮未验证）');
  {
    const S = h => J([h.decadal, h.age, h.yearly, h.monthly, h.daily, h.hourly]);
    for (const fl of [false, true]) {
      const h = astro.withOptions({ type: 'lunar', dateStr: '1990-5-10', timeIndex: 3, gender: 'male', isLeapMonth: false,
        fixLeap: fl, language: 'zh-CN', config: { yearDivide: 'normal', horoscopeDivide: 'normal' } }).horoscope('2025-08-20');
      console.log(`  fixLeap=${fl} 目标闰六月廿七 → monthly.index=${h.monthly.index} ${h.monthly.heavenlyStem}${h.monthly.earthlyBranch}`);
    }
    console.log('  → 闰月「过十六算下月」是硬编码的，fixLeap 关不掉。');
    const base = S(mk(1990, 5, 10, 3, 'male').horoscope('2025-03-15'));
    for (const [k, v] of [['algorithm', 'zhongzhou'], ['astroType', 'earth'], ['astroType', 'human']]) {
      const c = k === 'astroType'
        ? astro.withOptions({ type: 'lunar', dateStr: '1990-5-10', timeIndex: 3, gender: 'male', isLeapMonth: false, fixLeap: false,
            language: 'zh-CN', astroType: v, config: { yearDivide: 'normal', horoscopeDivide: 'normal' } })
        : mk(1990, 5, 10, 3, 'male', { [k]: v });
      console.log(`  ${k}=${v}: 运限与默认相同? ${S(c.horoscope('2025-03-15')) === base}`);
    }
  }

  console.log('\n## Q4e decadalList / yearlyList / monthlyList 与 horoscope() 是否自洽');
  {
    const c = mk(1990, 5, 20, 3, 'male');
    const dl = c.decadalList(), h = c.horoscope('2025-06-01');
    const hit = dl.find(d => 2025 >= d.yearRange[0] && 2025 <= d.yearRange[1]);
    console.log(`  decadalList 命中项 index=${hit.index} ${hit.heavenlyStem}${hit.earthlyBranch} ageRange=${J(hit.ageRange)} vs horoscope decadal index=${h.decadal.index} ${h.decadal.heavenlyStem}${h.decadal.earthlyBranch} → ${hit.index === h.decadal.index && J(hit.stars) === J(h.decadal.stars) ? '一致' : '不一致'}`);
    const yl = c.yearlyList(hit.index === undefined ? 0 : dl.indexOf(hit));
    const y = yl.find(x => x.year === 2025);
    console.log(`  yearlyList 2025 → index=${y?.index} ${y?.heavenlyStem}${y?.earthlyBranch} vs horoscope ${h.yearly.index} ${h.yearly.heavenlyStem}${h.yearly.earthlyBranch} → ${y && y.index === h.yearly.index ? '一致' : '不一致'}`);
    const ml = c.monthlyList(2025);
    console.log(`  monthlyList(2025) 长度=${ml.length} (2025 有闰六月，应为 13 或 14)  首项 index=${ml[0].index} vs 斗君预期 ${expectHoroscope({lunarYear:1990,lunarMonth:5,lunarDay:20,timeIndex:3,gender:'male'},'2025-02-20',0).monthly.doujun}`);
  }
}

if (import.meta.main) {
  if (process.argv[2] === 'edges') { edges(); process.exit(0); }
  process.exit(run(Number(process.argv[2] || 300), Number(process.argv[3] || 6)) ? 1 : 0);
}
