import { describe, it, expect } from 'bun:test';
import { z } from 'zod';
import { createZiweiMcpServer, formatZodError } from '../src/mcp/server';
import { ZiweiHoroscopeInputSchema } from '../src/schemas/horoscope';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const listHandler = () => {
  const server = createZiweiMcpServer();
  // @ts-ignore — reaching into the SDK's handler registry, same as bazi-mcp's suite
  return server._requestHandlers.get(ListToolsRequestSchema.shape.method.value)!;
};
const callHandler = () => {
  const server = createZiweiMcpServer();
  // @ts-ignore
  return server._requestHandlers.get(CallToolRequestSchema.shape.method.value)!;
};
const call = (name: string, args: unknown) =>
  callHandler()({ method: 'tools/call', params: { name, arguments: args } }, {});

describe('MCP tools/list', () => {
  it('lists all tools with object input schemas', async () => {
    const res = await listHandler()({ method: 'tools/list' }, {});
    expect(res.tools.map((t: any) => t.name).sort()).toEqual(['calculate_ziwei', 'calculate_ziwei_horoscope', 'lookup_location']);
    for (const tool of res.tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(typeof tool.description).toBe('string');
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
  });

  it('advertises gender as the only required field, and does NOT advertise timeUnknown', async () => {
    const res = await listHandler()({ method: 'tools/list' }, {});
    const ziwei = res.tools.find((t: any) => t.name === 'calculate_ziwei')!;
    expect(ziwei.inputSchema.required).toEqual(['gender']);
    expect(Object.keys(ziwei.inputSchema.properties)).not.toContain('timeUnknown');
    expect(Object.keys(ziwei.inputSchema.properties)).not.toContain('latitude');
    // The advertised schema must not drift from the zod schema it is hand-mirrored from.
    expect(Object.keys(ziwei.inputSchema.properties).sort()).toEqual([
      'algorithm', 'ageDivide', 'astroType', 'brightness', 'clockTime', 'dayDivide', 'dstFold', 'fixLeap',
      'gender', 'horoscopeDivide', 'longitude', 'lunarDate', 'lunarDateFrame', 'mutagens', 'place',
      'shichen', 'solarDate', 'timezone', 'trueSolar', 'yearDivide',
    ].sort());
  });

  it('advertises calculate_ziwei_horoscope with the same birth-input contract plus target', async () => {
    const res = await listHandler()({ method: 'tools/list' }, {});
    const horoscope = res.tools.find((t: any) => t.name === 'calculate_ziwei_horoscope')!;
    expect(horoscope.inputSchema.required).toEqual(['gender']);
    // Same birth-input contract as calculate_ziwei (project brief: "takes the same
    // birth-input contract as calculate_ziwei plus a target") plus `target`.
    expect(Object.keys(horoscope.inputSchema.properties).sort()).toEqual([
      'algorithm', 'ageDivide', 'astroType', 'brightness', 'clockTime', 'dayDivide', 'dstFold', 'fixLeap',
      'gender', 'horoscopeDivide', 'longitude', 'lunarDate', 'lunarDateFrame', 'mutagens', 'place',
      'shichen', 'solarDate', 'target', 'timezone', 'trueSolar', 'yearDivide',
    ].sort());
    expect(horoscope.inputSchema.properties.target.required).toEqual(['solarDate', 'clockTime']);
  });
});

describe('MCP tools/call happy paths', () => {
  it('calculates a chart from a solarDate', async () => {
    // This fixture straddles 立春 2024 (same birth as golden.test.ts's G2) —
    // pinned to yearDivide:'lichun' explicitly so this MCP-wire smoke test keeps
    // its expected values (0.2.0 default is 'lunar_new_year').
    const res = await call('calculate_ziwei', {
      place: 'Tacoma, WA',
      solarDate: { year: 2024, month: 2, day: 4 },
      clockTime: { hour: 8, minute: 0 },
      yearDivide: 'lichun',
      gender: 'male',
    });
    expect(res.isError).toBeFalsy();
    const chart = JSON.parse(res.content[0].text);
    expect(chart.diagnostics.wallClock).toContain('America/Los_Angeles');
    expect(chart.diagnostics.yearGanZhi).toBe('甲辰');
    expect(chart.soulPalace).toEqual({ branch: '酉', stem: '癸', name: '命宫' });
    expect(chart.palaces).toHaveLength(12);
  });

  it('calculates a chart from a lunarDate with an explicit frame', async () => {
    const res = await call('calculate_ziwei', {
      timezone: 'Asia/Shanghai',
      longitude: 116.4074,
      lunarDate: { year: 1988, month: 5, day: 18 },
      lunarDateFrame: 'beijing',
      clockTime: { hour: 7, minute: 20 },
      gender: 'male',
    });
    expect(res.isError).toBeFalsy();
    const chart = JSON.parse(res.content[0].text);
    expect(chart.diagnostics.lunar.frame).toBe('beijing');
    expect(chart.diagnostics.utcInstant).toBe('1988-06-30T22:20:00.000Z');
    expect(chart.diagnostics.yearGanZhi).toBe('戊辰');
  });

  it('applies the documented defaults when the caller omits the convention switches', async () => {
    const res = await call('calculate_ziwei', {
      place: 'Beijing', solarDate: { year: 2000, month: 8, day: 16 },
      clockTime: { hour: 4, minute: 0 }, gender: 'male',
    });
    const chart = JSON.parse(res.content[0].text);
    expect(chart.diagnostics.convention).toEqual({
      yearDivide: 'lunar_new_year', horoscopeDivide: 'lunar_new_year', ageDivide: 'normal', dayDivide: 'forward',
      algorithm: 'default', astroType: 'heaven', fixLeap: true, trueSolar: true,
    });
  });

  it('looks up a location', async () => {
    const res = await call('lookup_location', { query: 'Urumqi' });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(res.content[0].text);
    expect(payload.count).toBeGreaterThan(0);
    expect(payload.results[0].name).toBe('Urumqi');
    expect(payload.results[0].timezone).toBe('Asia/Shanghai');
    expect(payload.results[0].alternateTimezones).toEqual(['Asia/Urumqi']);
  });
});

describe('MCP error paths', () => {
  it('returns isError with a prefixed message for missing required input', async () => {
    const res = await call('calculate_ziwei', { gender: 'male' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('[Ziwei Calculation Error]');
  });

  it('flattens ZodError issues into readable text rather than leaking raw issue JSON', async () => {
    const res = await call('calculate_ziwei', {
      timezone: 'Asia/Shanghai', longitude: 116.4074,
      solarDate: { year: 1988, month: 7, day: 1 },
      lunarDate: { year: 1988, month: 5, day: 18 },
      clockTime: { hour: 7, minute: 20 },
      gender: 'male',
    });
    expect(res.isError).toBe(true);
    const text = res.content[0].text;
    expect(text).toContain('[Ziwei Calculation Error]');
    expect(text).toContain('Cannot provide both solarDate');
    expect(text).not.toContain('"code"');
    expect(text).not.toContain('"path"');
    // Hand-written .refine() messages attach to the whole object (empty path) and must
    // stay exactly as authored — no stray ": " prefix from the (absent) path.
    expect(text).not.toContain(': Cannot provide both solarDate');
  });

  /**
   * Finding #2: zod issue paths were being dropped (`i.message` only), so a caller
   * saw a bare "Expected number, received string" with no indication of which field —
   * even though the path (e.g. ["solarDate", "day"]) was right there on the issue.
   */
  it('prefixes field-level ZodError messages with their path', async () => {
    const res = await call('calculate_ziwei', {
      place: 'Beijing', solarDate: { year: 2000, month: 1, day: 'thirty-one' },
      clockTime: { hour: 12, minute: 0 }, gender: 'male',
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('solarDate.day:');
  });

  it('explains WHY timeUnknown is unsupported instead of a bare strict-mode rejection', async () => {
    const res = await call('calculate_ziwei', {
      place: 'Beijing', solarDate: { year: 2000, month: 1, day: 1 }, timeUnknown: true, gender: 'male',
    });
    expect(res.isError).toBe(true);
    const text = res.content[0].text;
    expect(text).toContain('timeUnknown is not supported');
    expect(text).toContain('soul palace');
    expect(text).not.toContain('Unrecognized key');
  });

  it('surfaces domain errors (DST gap, ambiguous place) as tool errors, not crashes', async () => {
    const gap = await call('calculate_ziwei', {
      timezone: 'America/Los_Angeles', longitude: -122.4443,
      solarDate: { year: 1990, month: 4, day: 1 }, clockTime: { hour: 2, minute: 30 }, gender: 'male',
    });
    expect(gap.isError).toBe(true);
    expect(gap.content[0].text).toContain('spring-forward gap');

    const ambiguous = await call('calculate_ziwei', {
      place: 'Los Angeles', solarDate: { year: 2000, month: 1, day: 1 },
      clockTime: { hour: 12, minute: 0 }, gender: 'male',
    });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.content[0].text).toContain('matched multiple candidate cities');
  });

  it('rejects an oversized lookup_location query before it reaches the city scan (finding #5)', async () => {
    const res = await call('lookup_location', { query: 'a'.repeat(1_000_000) });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('characters or fewer');
  });

  it('rejects an unknown tool name', async () => {
    const res = await call('non_existent_tool', {});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Unknown MCP tool');
  });
});

/**
 * calculate_ziwei_horoscope at the MCP boundary. The tool's own arithmetic and wrapper
 * behaviour live in tests/horoscope-wrapper.test.ts; what is only observable here is
 * that the advertised schema matches the zod one, that the six scopes survive JSON
 * serialization intact, and that each of the wrapper's refusals reaches the caller as a
 * readable tool error rather than a crash or raw validation JSON.
 */
describe('MCP calculate_ziwei_horoscope', () => {
  const birth = {
    timezone: 'Etc/GMT-8', longitude: 120, trueSolar: false,
    solarDate: { year: 1990, month: 6, day: 15 }, clockTime: { hour: 10, minute: 0 }, gender: 'male',
  };
  const target = { solarDate: { year: 2025, month: 6, day: 15 }, clockTime: { hour: 13, minute: 0 } };

  it('advertises exactly the fields the zod schema accepts, derived from the schema rather than restated', async () => {
    // The advertised JSON Schema and ZiweiHoroscopeInputSchema are authored separately
    // (src/mcp/server.ts vs src/schemas/horoscope.ts); since the zod object is
    // `.strict()`, an advertised-but-unaccepted field is a caller-visible lie and an
    // accepted-but-unadvertised one is invisible. Read the zod shape through its
    // `.refine()` wrappers so this can never drift the way a hand-copied list does.
    let node: any = ZiweiHoroscopeInputSchema;
    while (node?._def?.schema) node = node._def.schema;
    const zodFields = Object.keys(node.shape).sort();

    const res = await listHandler()({ method: 'tools/list' }, {});
    const tool = res.tools.find((t: any) => t.name === 'calculate_ziwei_horoscope')!;
    expect(Object.keys(tool.inputSchema.properties).sort()).toEqual(zodFields);
    expect(tool.inputSchema.additionalProperties).toBe(false);
    expect(tool.inputSchema.required).toEqual(['gender']);
    expect(Object.keys(tool.inputSchema.properties.target.properties).sort()).toEqual(['clockTime', 'dstFold', 'solarDate']);
    expect(tool.inputSchema.properties.target.required).toEqual(['solarDate', 'clockTime']);
    expect(tool.inputSchema.properties.target.properties.dstFold.enum).toEqual([0, 1]);
    // The description must send callers to the natal tool for the chart itself, since
    // this response deliberately omits it.
    expect(tool.description).toContain('calculate_ziwei');
  });

  it('returns the six scopes and diagnostics, and no natal chart', async () => {
    const res = await call('calculate_ziwei_horoscope', { ...birth, target });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(res.content[0].text);
    expect(Object.keys(payload).sort()).toEqual(['age', 'daily', 'decadal', 'diagnostics', 'hourly', 'monthly', 'yearly']);
    expect(payload.age.nominalAge).toBe(36);
    expect(payload.yearly.stem + payload.yearly.branch).toBe('乙巳');
    // Birth/target are both deep mid-year (no 立春/正月初一 boundary sensitivity) —
    // this assertion is purely an echo check of the 0.2.0 default.
    expect(payload.diagnostics.convention.horoscopeDivide).toBe('lunar_new_year');
    expect(payload.diagnostics.engineInfo.iztro).toBe('2.6.0');
  });

  it('defaults to "now" when target is omitted, rather than erroring', async () => {
    const before = Date.now();
    const res = await call('calculate_ziwei_horoscope', birth);
    const after = Date.now();
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(res.content[0].text);
    const chosen = Date.parse(payload.diagnostics.targetUtcInstant);
    expect(chosen).toBeGreaterThanOrEqual(before - 1000);
    expect(chosen).toBeLessThanOrEqual(after + 1000);
  });

  it('reports each wrapper refusal as a readable tool error, not raw validation JSON', async () => {
    const cases: Array<[string, unknown, string]> = [
      ['pre-birth target', { ...birth, target: { solarDate: { year: 1980, month: 1, day: 1 }, clockTime: { hour: 12, minute: 0 } } }, 'before the birth lunar year'],
      ['ageDivide birthday', { ...birth, target, ageDivide: 'birthday' }, '以生日为界'],
      ['partial target', { ...birth, target: { solarDate: { year: 2025, month: 6, day: 15 } } }, 'clockTime'],
      ['unknown target key', { ...birth, target: { ...target, timezone: 'UTC' } }, 'Unrecognized key'],
      ['out-of-range target year', { ...birth, target: { solarDate: { year: 2101, month: 1, day: 1 }, clockTime: { hour: 0, minute: 0 } } }, '1900 and 2100'],
      ['timeUnknown', { ...birth, target, timeUnknown: true }, 'timeUnknown is not supported'],
    ];
    for (const [label, args, expected] of cases) {
      const res = await call('calculate_ziwei_horoscope', args);
      expect(`${label}: ${res.isError}`).toBe(`${label}: true`);
      const text = res.content[0].text;
      expect(`${label}: ${text}`).toContain(expected);
      expect(text).toContain('[Ziwei Calculation Error]');
      expect(text).not.toContain('"code"');
      expect(text).not.toContain('"path"');
    }
  });

  it('keeps a bad star-name override small and actionable here too, not a 162-name dump', async () => {
    const res = await call('calculate_ziwei_horoscope', { ...birth, target, mutagens: { 甲: ['紫薇', '破军', '武曲', '太阳'] } });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('did you mean "紫微"');
    expect(res.content[0].text.length).toBeLessThan(1000);
  });
});

describe('formatZodError bounding (context-bomb fix)', () => {
  const makeIssues = (n: number): z.ZodIssue[] =>
    Array.from({ length: n }, (_, i) => ({
      code: z.ZodIssueCode.custom,
      path: ['brightness', `bogus${i}`],
      message: `"bogus${i}" is not a recognized star name (zh-CN).`,
    }));

  it('leaves a single-issue error exactly as before', () => {
    const err = new z.ZodError(makeIssues(1));
    expect(formatZodError(err)).toBe('brightness.bogus0: "bogus0" is not a recognized star name (zh-CN).');
  });

  it('leaves a two-issue error exactly as before', () => {
    const err = new z.ZodError(makeIssues(2));
    expect(formatZodError(err)).toBe(
      'brightness.bogus0: "bogus0" is not a recognized star name (zh-CN).; brightness.bogus1: "bogus1" is not a recognized star name (zh-CN).'
    );
  });

  it('bounds a many-issue error to the first few offenders plus an omitted-count', () => {
    const err = new z.ZodError(makeIssues(50_000));
    const msg = formatZodError(err);
    // Names the first few offenders.
    expect(msg).toContain('brightness.bogus0:');
    expect(msg).toContain('brightness.bogus1:');
    // Reports how many were omitted (50,000 issues minus however many are actually shown).
    expect(msg).toContain('…and 49992 more validation errors');
    // And the whole thing stays small — nowhere near the 3.22MB an unbounded join produces.
    expect(msg.length).toBeLessThan(4100);
  });

  it('backstops the total length even when a single issue message is itself huge', () => {
    const err = new z.ZodError([
      { code: z.ZodIssueCode.custom, path: [], message: 'x'.repeat(1_000_000) },
    ]);
    const msg = formatZodError(err);
    expect(msg.length).toBeLessThan(4100);
    expect(msg).toContain('(truncated)');
  });

  it('produces a bounded end-to-end message for a real many-key brightness payload', async () => {
    // Real (valid-shaped) 12-entry brightness array so only the *keys* are bad —
    // isolates the key-count blowup this fix targets, one issue per bogus key.
    const validEntries: string[] = ['庙', '旺', '得', '利', '平', '不', '陷', '', '庙', '旺', '得', '利'];
    const brightness: Record<string, string[]> = {};
    for (let i = 0; i < 2000; i++) brightness[`notAStar${i}`] = validEntries;

    const res = await call('calculate_ziwei', {
      place: 'Beijing', solarDate: { year: 2000, month: 1, day: 1 },
      clockTime: { hour: 12, minute: 0 }, gender: 'male',
      brightness,
    });
    expect(res.isError).toBe(true);
    const text: string = res.content[0].text;
    expect(text).toContain('[Ziwei Calculation Error]');
    expect(text).toContain('…and 1992 more validation errors');
    expect(text.length).toBeLessThan(4200);
  });
});
