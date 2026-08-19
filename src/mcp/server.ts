import { z } from 'zod';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { parseZiweiInput, LookupLocationSchema } from '../schemas/input';
import { parseZiweiHoroscopeInput } from '../schemas/horoscope';
import { calculateZiweiChart } from '../core/chart';
import { calculateZiweiHoroscope } from '../core/horoscope';
import { lookupCity } from '../geo/resolver';
import rootPkg from '../../package.json';

// A record schema keyed by an enum (StarNameEnum) rejects every invalid key as its own
// zod issue, and nothing bounds how many invalid keys a caller can put in one JS object
// (measured: 50,000 bogus `brightness` keys -> 50,000 issues -> a 3.22MB error string).
// The schema correctly rejects the payload fast; without these caps, the *reporting*
// layer then hands that win back by writing a multi-MB string to stdout for the LLM
// caller to choke on. Cap how many issues get named, and backstop the total length in
// case a single issue's own message is huge (e.g. a long echoed value).
const MAX_REPORTED_ISSUES = 8;
const MAX_ERROR_MESSAGE_LENGTH = 4000;

// Zod issue paths are dropped here in the old code, so the LLM caller sees a bare
// "Required" or "Expected number, received string" with no field name — even
// though the path (e.g. ["solarDate", "day"]) is right there on the issue. Prefix
// it when present. The hand-written `.strict().refine(...)` messages in
// schemas/input.ts (e.g. "Must provide either solarDate or lunarDate.") attach to
// the whole object and carry an empty path — leave those bare rather than
// prefixing a stray ": " separator onto an already-readable sentence.
export function formatZodError(err: z.ZodError): string {
  const formatted = err.issues.map(i =>
    i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message
  );
  const shown = formatted.slice(0, MAX_REPORTED_ISSUES);
  const omitted = formatted.length - shown.length;
  let msg = shown.join('; ');
  if (omitted > 0) msg += `; …and ${omitted} more validation errors`;
  if (msg.length > MAX_ERROR_MESSAGE_LENGTH) {
    msg = `${msg.slice(0, MAX_ERROR_MESSAGE_LENGTH)}… (truncated)`;
  }
  return msg;
}

export function createZiweiMcpServer(): Server {
  const server = new Server(
    {
      name: 'ziwei-mcp',
      version: rootPkg.version,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Shared by both calculate_ziwei and calculate_ziwei_horoscope — spec: the horoscope
  // tool "takes the same birth-input contract as calculate_ziwei plus a target". A
  // single source object (rather than hand-copying ~30 lines into a second tool
  // definition) is what keeps the two tools' advertised schemas from drifting apart —
  // exactly the discipline tests/mcp.test.ts's "advertised schema must not drift from
  // the zod schema" check already enforces for calculate_ziwei alone.
  const birthInputProperties: Record<string, object> = {
          place: {
            type: 'string',
            description: 'Birth city name in ENGLISH (e.g. "Beijing", "New York", "Lagos", "Tacoma, WA"). Translate from other languages before passing.',
          },
          longitude: {
            type: 'number',
            description: 'Birth location longitude (positive = East, negative = West, e.g. 116.4074 or -122.4443)',
          },
          timezone: {
            type: 'string',
            description: 'Birth location IANA timezone (e.g. "Asia/Shanghai", "America/Los_Angeles")',
          },
          solarDate: {
            type: 'object',
            description: 'Solar (Gregorian) birth date (mutually exclusive with lunarDate)',
            additionalProperties: false,
            properties: {
              year: { type: 'integer', description: 'Solar year (1900-2100, e.g. 1990)' },
              month: { type: 'integer', description: 'Month (1-12)' },
              day: { type: 'integer', description: 'Day (1-31)' },
            },
            required: ['year', 'month', 'day'],
          },
          lunarDate: {
            type: 'object',
            description: 'Lunar (Chinese calendar) birth date (mutually exclusive with solarDate)',
            additionalProperties: false,
            properties: {
              year: { type: 'integer', description: 'Lunar year (1900-2100, e.g. 1990)' },
              month: { type: 'integer', description: 'Lunar month (1-12)' },
              day: { type: 'integer', description: 'Lunar day (1-30)' },
              isLeapMonth: { type: 'boolean', description: 'Whether this is a leap month' },
            },
            required: ['year', 'month', 'day'],
          },
          lunarDateFrame: {
            type: 'string',
            enum: ['local', 'beijing'],
            description: 'Lunar date reference frame: "local" (default, based on local Gregorian date) or "beijing" (based on China Gregorian date)',
          },
          clockTime: {
            type: 'object',
            description: 'Clock time of birth (mutually exclusive with shichen)',
            additionalProperties: false,
            properties: {
              hour: { type: 'integer', description: 'Hour (0-23)' },
              minute: { type: 'integer', description: 'Minute (0-59)' },
            },
            required: ['hour', 'minute'],
          },
          shichen: {
            type: 'string',
            enum: ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'],
            description: 'Traditional Chinese double-hour (use when exact minute is unknown). The chart is computed at the shichen midpoint; check `diagnostics.shichenAmbiguity` in the response for the candidate timeIndex values if correction pushes the window across a boundary (common — do not treat the returned chart as certain when this is set).',
          },
          dstFold: {
            type: 'integer',
            enum: [0, 1],
            description: 'DST fall-back disambiguation: 0 = first occurrence (DST), 1 = second occurrence (Standard)',
          },
          gender: {
            type: 'string',
            enum: ['male', 'female'],
            description: 'Gender: "male" (男/乾造) or "female" (女/坤造)',
          },
          yearDivide: {
            type: 'string',
            enum: ['lichun', 'lunar_new_year'],
            default: 'lichun',
            description: 'Year-ganzhi boundary: lichun (default, 立春, determined on the true UTC instant — matches bazi-mcp) or lunar_new_year (正月初一)',
          },
          horoscopeDivide: {
            type: 'string',
            enum: ['lichun', 'lunar_new_year'],
            default: 'lichun',
            description: 'Same convention as yearDivide, for horoscope (运限) year rollover. Used by the calculate_ziwei_horoscope tool to determine 流年; has no effect on this tool\'s own output.',
          },
          ageDivide: {
            type: 'string',
            enum: ['normal', 'birthday'],
            default: 'normal',
            description: 'Small-limit (小限) boundary: normal (natural year) or birthday. Note: calculate_ziwei_horoscope rejects "birthday" outright (see that tool\'s own docs) — 小限 has no effect on this tool\'s own output, so the option is inert here.',
          },
          dayDivide: {
            type: 'string',
            enum: ['current', 'forward'],
            default: 'current',
            description: 'Late-Zi-hour (晚子时, 23:00-24:00) convention: current (default, same day) or forward (next day)',
          },
          algorithm: {
            type: 'string',
            enum: ['default', 'zhongzhou'],
            default: 'default',
            description: 'Star-placement algorithm: default (通行版) or zhongzhou (中州派, unverified against an independent source)',
          },
          astroType: {
            type: 'string',
            enum: ['heaven', 'earth', 'human'],
            default: 'heaven',
            description: 'Zhongzhou-school chart type (天盘/地盘/人盘); only meaningful with algorithm: "zhongzhou"',
          },
          fixLeap: {
            type: 'boolean',
            default: false,
            description: 'Whether to fix leap-month boundaries at the 15th day (闰月十五日为界修正)',
          },
          trueSolar: {
            type: 'boolean',
            description: 'Whether to apply True Solar Time correction (default: true)',
          },
          mutagens: {
            type: 'object',
            description: 'School/convention override for 四化 (Four Transformations): maps a heavenly stem (甲-癸) to its own [禄,权,科,忌] star names (exactly 4, in that order), overriding iztro\'s built-in table for that stem only. Optional passthrough to iztro\'s config.mutagens; omit for the default table.',
            additionalProperties: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 },
          },
          brightness: {
            type: 'object',
            description: 'School/convention override for star brightness (庙旺得利平不陷): maps a star name to its own 12-entry brightness array (one per palace, iztro\'s internal 寅卯辰...丑 order), overriding iztro\'s built-in table for that star only. Optional passthrough to iztro\'s config.brightness; omit for the default table.',
            additionalProperties: { type: 'array', items: { type: 'string' }, minItems: 12, maxItems: 12 },
          },
  };

  const tools: Tool[] = [
    {
      name: 'calculate_ziwei',
      description:
        'Precise Zi Wei Dou Shu (紫微斗数) chart calculation tool. Uses iztro as the star-placement engine, wrapped with True Solar Time, full IANA/DST handling, and an independently-determined year ganzhi (bypassing a known bug in iztro\'s own yearDivide:\'exact\' — see the engineInfo/yearDivideNote in the response). Supports any birth location worldwide. IMPORTANT: The `place` field requires an ENGLISH city name; translate from other languages first (e.g. 北京 → "Beijing", 東京 → "Tokyo"). Pass exactly ONE of `solarDate`/`lunarDate` and ONE of `clockTime`/`shichen`. There is no "unknown birth time" mode — the soul palace, body palace, and several star placements all depend on the birth hour, so a request without a usable time is rejected rather than returning a partial chart. If `shichen` is used instead of an exact `clockTime`, check `diagnostics.shichenAmbiguity` in the response — because a shichen is a ~2-hour window and True Solar Time correction is typically tens of minutes, most shichen inputs land near enough to a boundary that the soul palace and several star placements could plausibly belong to the neighboring double-hour instead; the chart returned uses the shichen midpoint. `mutagens`/`brightness` are optional school/convention overrides passed through verbatim to iztro (see their own descriptions below); omit both to use iztro\'s built-in tables. Four Pillars / Bazi are out of scope — call bazi-mcp for those (its time layer is shared with this tool, so results align). This tool returns ONLY the natal chart; for 大限/小限/流年/流月/流日/流时 (运限), call calculate_ziwei_horoscope instead — folding both into one response would blow up context for no benefit to most callers.',
      inputSchema: {
        type: 'object',
        properties: { ...birthInputProperties },
        required: ['gender'],
        additionalProperties: false,
      },
    },
    {
      name: 'calculate_ziwei_horoscope',
      description:
        'Zi Wei Dou Shu (紫微斗数) horoscope (运限) calculation tool: 大限/童限 (decadal/childhood limit), 小限 (age limit), 流年 (yearly), 流月 (monthly), 流日 (daily), and 流时 (hourly) — their palace, ganzhi, rotated palace names, own 四化, and 运曜 (dynamic stars) by palace. Returns ONLY these six scopes, NOT the natal chart (call calculate_ziwei separately for that — a Zi Wei chart is already an order of magnitude bigger than a Bazi one, and folding six scopes worth of 运曜 on top would blow up context). Takes the exact same birth-input contract as calculate_ziwei (place/date/time/gender/school conventions — see that tool\'s own field docs) plus an optional `target`: the instant to compute the horoscope for. Omit `target` entirely to default to the current instant ("now"); if provided, both `target.solarDate` and `target.clockTime` are required together (a date-only target is ambiguous for 流时, which needs an exact hour). Wraps several interface defects in iztro\'s own horoscope() (documented in `diagnostics`, not reimplemented arithmetic): a target before the birth date is rejected (iztro returns nonsensical values instead); `ageDivide:\'birthday\'` is rejected outright (iztro\'s implementation of it does not actually divide by the birth day, despite its name — see the ageDivide field\'s own description); the 流年 boundary is independently determined by this service (see `diagnostics.yearlyGanZhi`/`yearlyGanZhiNote`) rather than iztro\'s own self-contradictory exact-boundary mode; and 虚岁/大限/小限 are compensated for an internal iztro workaround (`diagnostics.feedYearCompensation`) that would otherwise silently corrupt them for some birth dates. Check `diagnostics.warnings` for anything that needs the caller\'s attention (e.g. a target that falls in the narrow 立春↔正月初一 window, where 流年 and 流月\'s own internal year anchor briefly disagree).',
      inputSchema: {
        type: 'object',
        properties: {
          ...birthInputProperties,
          target: {
            type: 'object',
            description: 'The instant to compute 运限 for. Omit entirely to default to "now". If provided, both solarDate and clockTime are required (no partial target).',
            additionalProperties: false,
            properties: {
              solarDate: {
                type: 'object',
                description: 'Solar (Gregorian) target date',
                additionalProperties: false,
                properties: {
                  year: { type: 'integer', description: 'Solar year (1900-2100)' },
                  month: { type: 'integer', description: 'Month (1-12)' },
                  day: { type: 'integer', description: 'Day (1-31)' },
                },
                required: ['year', 'month', 'day'],
              },
              clockTime: {
                type: 'object',
                description: 'Clock time of the target instant',
                additionalProperties: false,
                properties: {
                  hour: { type: 'integer', description: 'Hour (0-23)' },
                  minute: { type: 'integer', description: 'Minute (0-59)' },
                },
                required: ['hour', 'minute'],
              },
              dstFold: {
                type: 'integer',
                enum: [0, 1],
                description: 'DST fall-back disambiguation for the target instant: 0 = first occurrence (DST), 1 = second occurrence (Standard)',
              },
            },
            required: ['solarDate', 'clockTime'],
          },
        },
        required: ['gender'],
        additionalProperties: false,
      },
    },
    {
      name: 'lookup_location',
      description: 'Look up a city\'s geographic coordinates (latitude, longitude) and official IANA timezone. IMPORTANT: Use ENGLISH city names only. If the user provides a name in another language, translate it to English first (e.g. 东京 → "Tokyo", 巴黎 → "Paris"). Covers 7,329 cities across 227 countries.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'City name in ENGLISH (e.g. "Beijing", "Tokyo", "Lagos", "São Paulo", "Portland, OR").',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  ];

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      if (name === 'calculate_ziwei') {
        const validatedInput = parseZiweiInput(args);
        const result = calculateZiweiChart(validatedInput);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      if (name === 'calculate_ziwei_horoscope') {
        const validatedInput = parseZiweiHoroscopeInput(args);
        const result = calculateZiweiHoroscope(validatedInput);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      if (name === 'lookup_location') {
        const { query } = LookupLocationSchema.parse(args);
        const cities = lookupCity(query);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  query,
                  count: cities.length,
                  results: cities,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      throw new Error(`Unknown MCP tool: ${name}`);
    } catch (err: unknown) {
      const errMsg = err instanceof z.ZodError
        ? formatZodError(err)
        : err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `[Ziwei Calculation Error] ${errMsg}`,
          },
        ],
      };
    }
  });

  return server;
}

export async function runServer(): Promise<void> {
  const server = createZiweiMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Ziwei MCP Server running on stdio transport.');
}
