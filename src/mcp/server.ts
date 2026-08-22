import { z } from 'zod';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { parseZiweiInput, LookupLocationSchema, ZiweiInputObjectSchema } from '../schemas/input';
import { parseZiweiHoroscopeInput, HoroscopeTargetSchema } from '../schemas/horoscope';
import { calculateZiweiChart } from '../core/chart';
import { calculateZiweiHoroscope } from '../core/horoscope';
import { lookupCity, lookupCityWithCount } from '../geo/resolver';
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

// The tool-schema/zod-schema drift this project's own philosophy refuses elsewhere
// (assertLeapMonthExists, the ageDivide:'birthday' rejection, StarNameEnum — see
// their own comments in src/schemas/*.ts): 0.2.0 changed four `ZIWEI_DEFAULTS`
// values but the hand-written JSON Schema below was never updated, so an LLM
// caller reading this tool's advertised schema was told the PRE-0.2.0 defaults —
// actively wrong, not just stale. And six numeric bounds zod enforces (longitude
// ±180, the four date/time sub-fields) were never advertised at all. Both classes
// are re-typed values, so both can silently drift again the same way — instead,
// derive `default`/`minimum`/`maximum` straight off the zod schema below and merge
// them onto the hand-written `type`/`enum`/`description` (prose zod has no
// equivalent for). tests/schema_parity.test.ts independently re-derives the same
// two things straight from zod (not from this code) and compares, so a future
// change to either schema without updating the other still gets caught — this
// derivation just makes today's two misses impossible to reintroduce by hand-typing.

/** Strips ZodOptional/ZodDefault/ZodEffects wrappers down to the base type — mirrors
 * tests/schema_parity.test.ts's own independent `unwrap` (same zod internals, written
 * separately) rather than importing it, so the test stays a check ON this code, not a
 * shared dependency of it. */
function unwrapZod(schema: any): any {
  let current = schema;
  while (current?._def?.innerType || current?._def?.schema) {
    current = current._def.innerType ?? current._def.schema;
  }
  return current;
}

/** zod's own numeric min/max checks (z.number().min()/.max()), in JSON Schema vocabulary. */
function zodNumberBounds(schema: any): { minimum?: number; maximum?: number } {
  const base = unwrapZod(schema);
  if (base?._def?.typeName !== 'ZodNumber') return {};
  const bounds: { minimum?: number; maximum?: number } = {};
  for (const check of base._def.checks ?? []) {
    if (check.kind === 'min') bounds.minimum = check.value;
    if (check.kind === 'max') bounds.maximum = check.value;
  }
  return bounds;
}

/** zod's own `.default(...)` value for a field, or undefined if it has none. */
function zodDefaultValue(schema: any): unknown {
  let node: any = schema;
  while (node?._def?.innerType && node._def.typeName !== 'ZodDefault') node = node._def.innerType;
  return node?._def?.typeName === 'ZodDefault' ? node._def.defaultValue() : undefined;
}

/**
 * Merges a zod field's derived `default`/`minimum`/`maximum` onto a hand-written JSON
 * Schema property, recursing one level into nested object properties (solarDate.year,
 * clockTime.hour, etc.) using the zod field's own `.shape`. `type`/`enum`/`description`
 * are left exactly as hand-written — only the two things that actually drifted
 * (defaults, numeric bounds) are ever overwritten here.
 */
function withZodConstraints(zodField: any, prop: any): any {
  if (!zodField) return prop;
  const merged: any = { ...prop, ...zodNumberBounds(zodField) };
  const def = zodDefaultValue(zodField);
  if (def !== undefined) merged.default = def;

  const base = unwrapZod(zodField);
  if (merged.properties && base?._def?.typeName === 'ZodObject') {
    const nestedShape = base.shape as Record<string, any>;
    merged.properties = Object.fromEntries(
      Object.entries(merged.properties).map(([nested, nestedProp]) => [
        nested,
        withZodConstraints(nestedShape[nested], nestedProp),
      ])
    );
  }
  return merged;
}

const birthInputZodShape = ZiweiInputObjectSchema.shape as Record<string, any>;

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
  const birthInputPropertiesRaw: Record<string, object> = {
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
            description: 'Year-ganzhi boundary: lunar_new_year (default, 正月初一 — the mainstream 紫微斗数 convention) or lichun (立春, determined on the true UTC instant, matching bazi-mcp — 八字/子平术\'s own boundary; still the only *correct* 立春 implementation in the ecosystem, just not this system\'s default).',
          },
          horoscopeDivide: {
            type: 'string',
            enum: ['lichun', 'lunar_new_year'],
            description: 'Same boundary convention as yearDivide (lunar_new_year is the default), for horoscope (运限) year rollover. Used by the calculate_ziwei_horoscope tool to determine 流年; has no effect on this tool\'s own output.',
          },
          ageDivide: {
            type: 'string',
            enum: ['normal', 'birthday'],
            description: 'Small-limit (小限) boundary: normal (default, natural year) or birthday. Note: calculate_ziwei_horoscope rejects "birthday" outright (see that tool\'s own docs) — 小限 has no effect on this tool\'s own output, so the option is inert here.',
          },
          dayDivide: {
            type: 'string',
            enum: ['current', 'forward'],
            description: 'Late-Zi-hour (晚子时, 23:00-24:00) convention: forward (default, counts as the next day — iztro\'s own factory default) or current (counts as the same day)',
          },
          algorithm: {
            type: 'string',
            enum: ['default', 'zhongzhou'],
            description: 'Star-placement algorithm: default (通行版) or zhongzhou (中州派). Verified exhaustively: zhongzhou does NOT change 四化 — e.g. 庚 stays 禄:太阳 权:武曲 科:太阴 忌:天同 and 壬 stays 禄:天梁 权:紫微 科:左辅 忌:武曲, not the documented 中州派 阳武府同 / 梁紫府武 (天府化科; 中州派 also holds 左辅/右弼 take no 四化 at all, which iztro\'s 壬科:左辅 contradicts). zhongzhou only changes 杂曜 (drops 截路/空亡, adds 截空/劫杀/大耗/龙德, swaps 天伤/天使 for 阴年男/阳年女) and how 命主 is derived (年支 instead of 命宫支). If you need 中州派 四化, supply your own table via `config.mutagens`.',
          },
          astroType: {
            type: 'string',
            enum: ['heaven', 'earth', 'human'],
            description: 'Zhongzhou-school chart type (天盘/地盘/人盘). Effective under either `algorithm` value — verified identical whether `algorithm` is \'default\' or \'zhongzhou\'; NOT limited to zhongzhou despite the name. \'earth\'/\'human\' re-seat 命宫 (to 身宫 / 福德宫) and, with it, 五行局, the twelve palace names, the 14 major stars, 长生十二神, and the decadal (大限) sequence. `earthlyBranchOfBodyPalace`, 天寿, and 命主/身主 keep their 天盘 values — they are NOT re-seated. Under algorithm:\'default\' this would leave 命主 contradicting the returned 命宫, so calculate_ziwei rejects astroType:\'earth\'/\'human\' combined with algorithm:\'default\'; calculate_ziwei_horoscope still accepts it since 命主/身主 never appear in its output.',
          },
          fixLeap: {
            type: 'boolean',
            description: 'Whether to fix leap-month boundaries at the 15th day (闰月十五日为界修正). Default true (iztro\'s own factory default).',
          },
          solarTime: {
            type: 'string',
            enum: ['true', 'mean', 'off'],
            description: 'Solar time correction mode (default "true"): "true" applies both the longitude correction and the equation of time (full True Solar Time); "mean" applies only the longitude correction, no equation of time (地方平太阳时); "off" applies neither, using the wall clock as given.',
          },
          trueSolar: {
            type: 'boolean',
            description: 'Deprecated: use `solarTime` instead (true -> "true", false -> "off"). Whether to apply True Solar Time correction (default: true).',
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

  // Derived, not hand-copied — see withZodConstraints's own comment above.
  const birthInputProperties: Record<string, object> = Object.fromEntries(
    Object.entries(birthInputPropertiesRaw).map(([field, prop]) => [
      field,
      withZodConstraints(birthInputZodShape[field], prop),
    ])
  );

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
          target: withZodConstraints(HoroscopeTargetSchema, {
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
          }),
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
        const { matched, results: cities } = lookupCityWithCount(query);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  query,
                  // TRUE match count, not the post-cap length: a capped list
                  // reporting its own size tells the caller the search was
                  // exhaustive when it was not ("Santa" matches 37, returns 10).
                  matched,
                  shown: cities.length,
                  ...(matched > cities.length
                    ? { note: `Showing the ${cities.length} most populous of ${matched} matches. Narrow the query if none is right -- do not assume the intended city is in this list.` }
                    : {}),
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
