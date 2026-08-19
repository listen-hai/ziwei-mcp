import { describe, it, expect } from 'bun:test';
import { createZiweiMcpServer } from '../src/mcp/server';
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
  it('lists both tools with object input schemas', async () => {
    const res = await listHandler()({ method: 'tools/list' }, {});
    expect(res.tools.map((t: any) => t.name).sort()).toEqual(['calculate_ziwei', 'lookup_location']);
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
});

describe('MCP tools/call happy paths', () => {
  it('calculates a chart from a solarDate', async () => {
    const res = await call('calculate_ziwei', {
      place: 'Tacoma, WA',
      solarDate: { year: 2024, month: 2, day: 4 },
      clockTime: { hour: 8, minute: 0 },
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
      yearDivide: 'lichun', horoscopeDivide: 'lichun', ageDivide: 'normal', dayDivide: 'current',
      algorithm: 'default', astroType: 'heaven', fixLeap: false, trueSolar: true,
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
