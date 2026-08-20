import { astro } from 'iztro';
import { getTotalDaysOfLunarMonth, lunar2solar } from 'lunar-lite';
const daysInLunarMonth=(y,m)=>{const s=lunar2solar(`${y}-${m}-1`,false);
  return getTotalDaysOfLunarMonth(`${s.solarYear}-${String(s.solarMonth).padStart(2,'0')}-${String(s.solarDay).padStart(2,'0')}`);};

const Z='子丑寅卯辰巳午未申酉戌亥'.split(''), G='甲乙丙丁戊己庚辛壬癸'.split('');
const M=n=>((n%12)+12)%12, idx=b=>Z.indexOf(b);
const WUHUDUN={甲:2,己:2,乙:4,庚:4,丙:6,辛:6,丁:8,壬:8,戊:0,癸:0};
const NAYIN60=['海中金','炉中火','大林木','路旁土','剑锋金','山头火','涧下水','城头土','白蜡金','杨柳木',
'泉中水','屋上土','霹雳火','松柏木','长流水','沙中金','山下火','平地木','壁上土','金箔金','覆灯火','天河水',
'大驿土','钗钏金','桑柘木','大溪水','沙中土','天上火','石榴木','大海水'];
const CLASS={水:2,木:3,金:4,土:5,火:6};
const gzIndex=(g,z)=>{let n=0;while(n<60&&!(n%10===g&&n%12===z))n++;return n;};
const soulPalace=(m,t)=>M(2+(m-1)-t);
const bodyPalace=(m,t)=>M(2+(m-1)+t);
const palaceStem=(ys,br)=>(WUHUDUN[ys]+M(br-2))%10;
function fiveClass(ys,soulBr){
  const ny=NAYIN60[Math.floor(gzIndex(palaceStem(ys,soulBr),soulBr)/2)];
  return {n:CLASS[ny[ny.length-1]],ny};
}
function ziwei(j,d){let n=0;while((d+n)%j!==0)n++;const q=(d+n)/j;return M(2+q-1+(n%2===0?n:-n));}
const LU={甲:2,乙:3,丙:5,戊:5,丁:6,己:6,庚:8,辛:9,壬:11,癸:0};
const KUI={甲:1,戊:1,庚:1,乙:0,己:0,丙:11,丁:11,壬:3,癸:3,辛:6};
const YUE={甲:7,戊:7,庚:7,乙:8,己:8,丙:9,丁:9,壬:5,癸:5,辛:2};
const HUO={寅:1,午:1,戌:1,申:2,子:2,辰:2,巳:3,酉:3,丑:3,亥:9,卯:9,未:9};
const LING={寅:3,午:3,戌:3,申:10,子:10,辰:10,巳:10,酉:10,丑:10,亥:10,卯:10,未:10};
const MA={寅:8,午:8,戌:8,申:2,子:2,辰:2,巳:11,酉:11,丑:11,亥:5,卯:5,未:5};
const MUT={甲:['廉贞','破军','武曲','太阳'],乙:['天机','天梁','紫微','太阴'],丙:['天同','天机','文昌','廉贞'],
丁:['太阴','天同','天机','巨门'],戊:['贪狼','太阴','右弼','天机'],己:['武曲','贪狼','天梁','文曲'],
辛:['巨门','太阳','文曲','文昌'],壬:['天梁','紫微','左辅','武曲'],癸:['破军','巨门','太阴','贪狼']};
const PALACES=['命宫','兄弟','夫妻','子女','财帛','疾厄','迁移','仆役','官禄','田宅','福德','父母'];
const ZIWEI_SERIES={紫微:0,天机:-1,太阳:-3,武曲:-4,天同:-5,廉贞:-8};
const TIANFU_SERIES={天府:0,太阴:1,贪狼:2,巨门:3,天相:4,天梁:5,七杀:6,破军:10};
const MUT_TAGS=['禄','权','科','忌'];

// palace index (0=寅) -> branch index (0=子)
const pi2bi = i => M(i+2), bi2pi = b => M(b-2);

let checks=0, fails=[];
const fail=(msg)=>fails.push(msg);
const eq=(a,b,msg)=>{checks++; if(a!==b) fail(`${msg}: got ${a}, want ${b}`);};

// where is star X? returns branch index or -1
function findStar(chart,name){
  for(const p of chart.palaces){
    for(const s of [...p.majorStars,...p.minorStars,...p.adjectiveStars]){
      if(s.name===name) return idx(p.earthlyBranch);
    }
  }
  return -1;
}
function starMutagen(chart,name){
  for(const p of chart.palaces)
    for(const s of [...p.majorStars,...p.minorStars,...p.adjectiveStars])
      if(s.name===name) return s.mutagen||'';
  return null;
}

const N = Number(process.argv[2]||800);
let seed=20260818;
const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
const pick=a=>a[Math.floor(rnd()*a.length)];

const genderOpts=['male','female'];
for(let k=0;k<N;k++){
  const ly=1930+Math.floor(rnd()*90);
  const lm=1+Math.floor(rnd()*12);
  const maxD=daysInLunarMonth(ly,lm);
  const ld=1+Math.floor(rnd()*maxD);
  const ti=Math.floor(rnd()*12);        // 0..11 only (12 = late zi handled separately)
  const gender=pick(genderOpts);

  let chart;
  try{
    chart=astro.withOptions({type:'lunar',dateStr:`${ly}-${lm}-${ld}`,timeIndex:ti,gender,
      isLeapMonth:false,fixLeap:false,language:'zh-CN',
      config:{yearDivide:'normal',horoscopeDivide:'normal'}});
  }catch(e){ fail(`chart build ${ly}-${lm}-${ld} ti${ti}: ${e.message}`); continue; }

  const yStemIdx = M60stem(ly), yBranchIdx = ((ly-1984)%12+12)%12;
  function M60stem(y){return ((y-1984)%10+10)%10;}
  const ys=G[((ly-1984)%10+10)%10], yb=Z[((ly-1984)%12+12)%12];

  // 1. soul / body palace
  const sp=soulPalace(lm,ti), bp=bodyPalace(lm,ti);
  eq(idx(chart.earthlyBranchOfSoulPalace),sp,`[${ly}-${lm}-${ld} ti${ti}] 命宫`);
  eq(idx(chart.earthlyBranchOfBodyPalace),bp,`[${ly}-${lm}-${ld} ti${ti}] 身宫`);

  // 2. five elements class
  const fc=fiveClass(ys,sp);
  eq(chart.fiveElementsClass.slice(0,-1).length>0,true,'sanity');
  const wantClass=`${{2:'水二',3:'木三',4:'金四',5:'土五',6:'火六'}[fc.n]}局`;
  eq(chart.fiveElementsClass,wantClass,`[${ly}-${lm}-${ld} ti${ti}] 五行局`);

  // 3. palace stems
  for(const p of chart.palaces){
    eq(p.heavenlyStem,G[palaceStem(ys,idx(p.earthlyBranch))],`[${ly}-${lm}-${ld}] 宫干@${p.earthlyBranch}`);
  }

  // 4. ziwei + series
  const zw=ziwei(fc.n,ld);
  for(const [name,off] of Object.entries(ZIWEI_SERIES))
    eq(findStar(chart,name),M(zw+off),`[${ly}-${lm}-${ld} ti${ti}] ${name}`);
  const tf=M(4-zw);
  for(const [name,off] of Object.entries(TIANFU_SERIES))
    eq(findStar(chart,name),M(tf+off),`[${ly}-${lm}-${ld} ti${ti}] ${name}`);

  // 5. 辅星
  eq(findStar(chart,'左辅'),M(4+lm-1),`[${ly}-${lm}-${ld}] 左辅`);
  eq(findStar(chart,'右弼'),M(10-(lm-1)),`[${ly}-${lm}-${ld}] 右弼`);
  eq(findStar(chart,'文昌'),M(10-ti),`[${ly}-${lm}-${ld} ti${ti}] 文昌`);
  eq(findStar(chart,'文曲'),M(4+ti),`[${ly}-${lm}-${ld} ti${ti}] 文曲`);
  eq(findStar(chart,'禄存'),LU[ys],`[${ly}] 禄存`);
  eq(findStar(chart,'擎羊'),M(LU[ys]+1),`[${ly}] 擎羊`);
  eq(findStar(chart,'陀罗'),M(LU[ys]-1),`[${ly}] 陀罗`);
  eq(findStar(chart,'天魁'),KUI[ys],`[${ly}] 天魁`);
  eq(findStar(chart,'天钺'),YUE[ys],`[${ly}] 天钺`);
  eq(findStar(chart,'地劫'),M(11+ti),`[${ly} ti${ti}] 地劫`);
  eq(findStar(chart,'地空'),M(11-ti),`[${ly} ti${ti}] 地空`);
  eq(findStar(chart,'火星'),M(HUO[yb]+ti),`[${ly} ti${ti}] 火星`);
  eq(findStar(chart,'铃星'),M(LING[yb]+ti),`[${ly} ti${ti}] 铃星`);
  eq(findStar(chart,'天马'),MA[yb],`[${ly}] 天马`);
  eq(findStar(chart,'红鸾'),M(3-idx(yb)),`[${ly}] 红鸾`);
  eq(findStar(chart,'天喜'),M(3-idx(yb)+6),`[${ly}] 天喜`);

  // 6. 四化 (庚 omitted from spec table — disputed)
  if(MUT[ys]) MUT[ys].forEach((star,i)=>{
    eq(starMutagen(chart,star),MUT_TAGS[i],`[${ly} ${ys}干] ${star}四化`);
  });

  // 7. 十二宫名
  for(const p of chart.palaces){
    eq(p.name,PALACES[M(idx(sp===undefined?0:Z[sp])-idx(p.earthlyBranch))],`[${ly}-${lm}-${ld} ti${ti}] 宫名@${p.earthlyBranch}`);
  }

  // 8. 命宫大限起始 = 局数
  const soulP=chart.palaces.find(p=>idx(p.earthlyBranch)===sp);
  eq(soulP.decadal.range[0],fc.n,`[${ly}-${lm}-${ld} ti${ti}] 大限起始`);
}

console.log(`checks=${checks}  charts=${N}  mismatches=${fails.length}`);
fails.slice(0,25).forEach(f=>console.log('  ✗',f));
process.exit(fails.length?1:0);
