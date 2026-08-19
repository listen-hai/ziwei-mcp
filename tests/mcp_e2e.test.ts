import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { existsSync } from 'fs';
import { resolve } from 'path';

/**
 * End-to-end MCP tests, ported from bazi-mcp.
 *
 * tests/mcp.test.ts calls the request handlers directly, which skips everything that
 * only breaks at the process boundary: the shebang, the bundle's ability to resolve
 * geo-tz (deliberately left external by scripts/build.ts), the initialize handshake,
 * JSON-RPC framing, and stdout cleanliness. Those are exactly the failures a client
 * experiences as "the server doesn't work" while every unit test stays green, so these
 * drive the built binary the way a real MCP client does.
 */

const ROOT = resolve(import.meta.dir, '..');
const ENTRY = resolve(ROOT, 'dist/index.js');
const PROTOCOL_VERSION = '2025-06-18';

interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number;
  result?: any;
  error?: { code: number; message: string };
}

/** One MCP session over stdio against the built binary. */
class McpSession {
  private proc: Bun.Subprocess<'pipe', 'pipe', 'pipe'>;
  private pending = new Map<number, (msg: JsonRpcMessage) => void>();
  private buffer = '';
  private nextId = 1;
  rawStdout = '';
  nonJsonLines: string[] = [];

  constructor() {
    const runtime = Bun.which('node') || process.execPath;
    this.proc = Bun.spawn([runtime, ENTRY], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
    this.readLoop();
  }

  private async readLoop(): Promise<void> {
    const decoder = new TextDecoder();
    for await (const chunk of this.proc.stdout as ReadableStream<Uint8Array>) {
      const text = decoder.decode(chunk);
      this.rawStdout += text;
      this.buffer += text;

      let newline: number;
      while ((newline = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (!line) continue;

        let msg: JsonRpcMessage;
        try {
          msg = JSON.parse(line);
        } catch {
          // Anything unparseable on stdout corrupts the stream for every client.
          this.nonJsonLines.push(line);
          continue;
        }
        if (msg.id !== undefined) {
          this.pending.get(msg.id)?.(msg);
          this.pending.delete(msg.id);
        }
      }
    }
  }

  send(method: string, params?: unknown, timeoutMs = 20000): Promise<JsonRpcMessage> {
    const id = this.nextId++;
    const promise = new Promise<JsonRpcMessage>((res, rej) => {
      const timer = setTimeout(() => rej(new Error(`Timed out after ${timeoutMs}ms waiting for "${method}"`)), timeoutMs);
      this.pending.set(id, msg => { clearTimeout(timer); res(msg); });
    });
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return promise;
  }

  notify(method: string, params?: unknown): void {
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  async handshake(): Promise<JsonRpcMessage> {
    const res = await this.send('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'ziwei-e2e-test', version: '1.0.0' },
    });
    this.notify('notifications/initialized');
    return res;
  }

  async callTool(name: string, args: unknown): Promise<any> {
    const res = await this.send('tools/call', { name, arguments: args });
    return res.result;
  }

  close(): void {
    this.proc.stdin.end();
    this.proc.kill();
  }
}

const parseToolPayload = (result: any) => JSON.parse(result.content[0].text);

describe('MCP end-to-end over stdio (built binary)', () => {
  let session: McpSession;

  beforeAll(async () => {
    if (!existsSync(ENTRY)) {
      const build = Bun.spawnSync(['bun', 'run', 'build'], { cwd: ROOT });
      if (!build.success) throw new Error(`bun run build failed:\n${build.stderr.toString()}`);
    }
    session = new McpSession();
    await session.handshake();
  });

  afterAll(() => session?.close());

  it('completes the initialize handshake and reports its package version', async () => {
    const local = new McpSession();
    const res = await local.handshake();
    local.close();

    expect(res.error).toBeUndefined();
    expect(typeof res.result.protocolVersion).toBe('string');
    expect(res.result.serverInfo.name).toBe('ziwei-mcp');
    const pkg = await Bun.file(resolve(ROOT, 'package.json')).json();
    expect(res.result.serverInfo.version).toBe(pkg.version);
  });

  it('lists both tools with their input schemas', async () => {
    const res = await session.send('tools/list');
    expect(res.error).toBeUndefined();
    expect(res.result.tools.map((t: any) => t.name).sort()).toEqual(['calculate_ziwei', 'lookup_location']);
    for (const tool of res.result.tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(typeof tool.description).toBe('string');
    }
  });

  it('calculates a chart through the real transport', async () => {
    const result = await session.callTool('calculate_ziwei', {
      place: 'Beijing',
      solarDate: { year: 1990, month: 6, day: 15 },
      clockTime: { hour: 8, minute: 0 },
      gender: 'male',
    });

    expect(result.isError).toBeFalsy();
    const chart = parseToolPayload(result);
    // June 1990 falls in China's 1986-1991 DST years, so 08:00 wall clock is UTC+9 and
    // the true solar time lands at ~06:45 (卯, timeIndex 3), not ~07:45 (辰, timeIndex 4).
    // Dropping the historical DST rule would silently change the whole chart here.
    expect(chart.diagnostics.utcOffset).toContain('+09:00');
    expect(chart.diagnostics.wallClock).toContain('Asia/Shanghai');
    expect(chart.diagnostics.yearGanZhi).toBe('庚午');
    expect(chart.lunar.timeIndex).toBe(3);
    expect(chart.lunar.shichen).toBe('卯');
    expect(chart.palaces).toHaveLength(12);
  });

  it('resolves geo-tz at runtime, which the bundle deliberately leaves external', async () => {
    // A bundling or dependency-resolution failure surfaces here as a module error
    // rather than a result, and nowhere else in the suite.
    const result = await session.callTool('lookup_location', { query: 'Urumqi' });
    expect(result.isError).toBeFalsy();
    const payload = parseToolPayload(result);
    expect(payload.results[0].name).toBe('Urumqi');
    expect(payload.results[0].timezone).toBe('Asia/Shanghai');
    expect(payload.results[0].alternateTimezones).toEqual(['Asia/Urumqi']);
  });

  it('reports input conflicts as a readable message, not raw validation JSON', async () => {
    const result = await session.callTool('calculate_ziwei', {
      place: 'Beijing',
      solarDate: { year: 1988, month: 7, day: 1 },
      lunarDate: { year: 1988, month: 5, day: 18 },
      clockTime: { hour: 7, minute: 20 },
      gender: 'male',
    });
    expect(result.isError).toBe(true);
    const text = result.content[0].text;
    expect(text).toContain('[Ziwei Calculation Error]');
    expect(text).toContain('solarDate');
    expect(text).not.toContain('"code"');
    expect(text).not.toContain('"path"');
  });

  it('returns a tool error for an unknown tool instead of crashing the session', async () => {
    const result = await session.callTool('no_such_tool', {});
    expect(result.isError).toBe(true);

    // The session must still be usable afterwards.
    const after = await session.send('tools/list');
    expect(after.result.tools.length).toBe(2);
  });

  it('keeps stdout free of anything but JSON-RPC', async () => {
    // MCP over stdio multiplexes nothing: a stray console.log from our code or any
    // dependency corrupts the stream and breaks every client silently.
    await session.callTool('calculate_ziwei', {
      place: 'Urumqi',
      solarDate: { year: 2000, month: 6, day: 15 },
      clockTime: { hour: 8, minute: 0 },
      gender: 'male',
    });

    expect(session.nonJsonLines).toEqual([]);
    for (const line of session.rawStdout.split('\n').filter(l => l.trim())) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});
