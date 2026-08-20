import { describe, it, expect } from 'bun:test';
import { createZiweiMcpServer } from '../src/mcp/server';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ZiweiInputObjectSchema, ZiweiInputSchema } from '../src/schemas/input';

/**
 * The MCP tools advertise a hand-written JSON Schema that mirrors the zod schema
 * in src/schemas/input.ts. Nothing makes the two agree, so they can drift: a new
 * field reaches only one of them, zod tightens a bound the tool never
 * advertises, or a default changes on one side only. Every one of those lands on
 * the caller, which is a model — it cannot see the zod schema, so whatever the
 * JSON Schema omits or misstates it has to discover by guessing and reading
 * validation errors.
 *
 * tests/mcp.test.ts already pins the *field list*, but for calculate_ziwei it
 * does so against a hand-written array, which passes by luck rather than by
 * construction. Here both sides are derived, and the numeric bounds and defaults
 * are compared as well.
 *
 * Ported from bazi-mcp's tests/schema_parity.test.ts (commit 3fd4969).
 */

/** Strips ZodOptional / ZodDefault / ZodEffects wrappers down to the base type. */
function unwrap(schema: any): any {
  let current = schema;
  while (current?._def?.innerType || current?._def?.schema) {
    current = current._def.innerType ?? current._def.schema;
  }
  return current;
}

/**
 * ZiweiInputSchema is ZiweiInputObjectSchema under a chain of .refine() calls;
 * the object schema is exported directly, so no unwrapping walk is needed here.
 */
const rootShape = (): Record<string, any> => ZiweiInputObjectSchema.shape as Record<string, any>;

/** zod's numeric bounds for a field, in JSON Schema vocabulary. */
function zodBounds(schema: any): { minimum?: number; maximum?: number } {
  const base = unwrap(schema);
  if (base?._def?.typeName !== 'ZodNumber') return {};
  const bounds: { minimum?: number; maximum?: number } = {};
  for (const check of base._def.checks ?? []) {
    if (check.kind === 'min') bounds.minimum = check.value;
    if (check.kind === 'max') bounds.maximum = check.value;
  }
  return bounds;
}

async function advertisedProperties(tool: string): Promise<Record<string, any>> {
  const server = createZiweiMcpServer() as any;
  const handler = server._requestHandlers.get(ListToolsRequestSchema.shape.method.value);
  const { tools } = await handler({ method: 'tools/list' }, {});
  return tools.find((t: any) => t.name === tool).inputSchema.properties;
}

describe('MCP input schema parity with the zod schema', () => {
  it('advertises exactly the fields zod accepts', async () => {
    const advertised = Object.keys(await advertisedProperties('calculate_ziwei')).sort();
    expect(advertised).toEqual(Object.keys(rootShape()).sort());
  });

  it('advertises every numeric bound zod enforces, at the top level and nested', async () => {
    const properties = await advertisedProperties('calculate_ziwei');

    // Collected rather than thrown on first miss: when this fails, the message
    // must enumerate every missing bound, not just the alphabetically first one.
    const missing: string[] = [];
    const check = (path: string, zodField: any, advertised: any) => {
      const bounds = zodBounds(zodField);
      for (const [key, value] of Object.entries(bounds)) {
        if (advertised?.[key] !== value) {
          missing.push(`${path}: expected ${key}=${value}, advertised ${JSON.stringify(advertised?.[key])}`);
        }
      }
    };

    // Walk both schemas together so a nested field cannot be missed.
    for (const [field, zodField] of Object.entries(rootShape())) {
      const advertised = properties[field];
      const base = unwrap(zodField);

      if (base?._def?.typeName === 'ZodNumber') {
        check(field, zodField, advertised);
        continue;
      }
      if (base?._def?.typeName === 'ZodObject') {
        for (const [nested, zodNested] of Object.entries<any>(base.shape)) {
          check(`${field}.${nested}`, zodNested, advertised?.properties?.[nested]);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('advertises the same defaults zod applies', async () => {
    const properties = await advertisedProperties('calculate_ziwei');

    const wrong: string[] = [];
    for (const [field, zodField] of Object.entries(rootShape())) {
      let node: any = zodField;
      while (node?._def?.innerType && node._def.typeName !== 'ZodDefault') node = node._def.innerType;
      if (node?._def?.typeName !== 'ZodDefault') continue;
      const expected = node._def.defaultValue();
      if (properties[field]?.default !== expected) {
        wrong.push(`${field}: zod defaults to ${JSON.stringify(expected)}, advertised ${JSON.stringify(properties[field]?.default)}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('rejects out-of-range values that the advertised bounds forbid', () => {
    // The bounds above are only worth advertising if zod actually enforces them.
    const base = { place: 'Beijing', clockTime: { hour: 8, minute: 0 }, gender: 'male' };
    const outOfRange = [
      { ...base, solarDate: { year: 1500, month: 1, day: 1 } },
      { ...base, solarDate: { year: 1990, month: 13, day: 1 } },
      { ...base, solarDate: { year: 1990, month: 1, day: 1 }, longitude: 999, timezone: 'Asia/Shanghai' },
      { ...base, solarDate: { year: 1990, month: 1, day: 1 }, clockTime: { hour: 8, minute: 99 } },
      { ...base, lunarDate: { year: 1990, month: 1, day: 31 } },
    ];
    for (const input of outOfRange) {
      expect(ZiweiInputSchema.safeParse(input).success).toBe(false);
    }
  });
});
