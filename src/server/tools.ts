import { Type, type FunctionDeclaration } from '@google/genai';
import type { DatabaseSync } from 'node:sqlite';
import { retrieveRelevantMemories } from './memory.ts';

/**
 * Safe recursive-descent arithmetic expression evaluator.
 * Never uses eval() or Function() so arbitrary code execution is impossible.
 */
export function evaluateSafeMath(expr: string): number {
  const cleaned = expr.replace(/\s+/g, '');
  if (!/^[0-9+\-*/().%^]+$/.test(cleaned)) {
    throw new Error('Invalid characters in math expression');
  }
  let pos = 0;

  function peek(): string {
    return cleaned[pos] ?? '';
  }
  function consume(): string {
    return cleaned[pos++] ?? '';
  }

  function parseExpression(): number {
    let val = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = consume();
      const right = parseTerm();
      val = op === '+' ? val + right : val - right;
    }
    return val;
  }

  function parseTerm(): number {
    let val = parsePower();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = consume();
      const right = parsePower();
      if (op === '*') val *= right;
      else if (op === '/') {
        if (right === 0) throw new Error('Division by zero');
        val /= right;
      } else {
        if (right === 0) throw new Error('Modulo by zero');
        val %= right;
      }
    }
    return val;
  }

  function parsePower(): number {
    const base = parseUnary();
    if (peek() === '^') {
      consume();
      return Math.pow(base, parsePower());
    }
    return base;
  }

  function parseUnary(): number {
    if (peek() === '-') {
      consume();
      return -parseUnary();
    }
    if (peek() === '+') {
      consume();
      return parseUnary();
    }
    return parsePrimary();
  }

  function parsePrimary(): number {
    if (peek() === '(') {
      consume();
      const inner = parseExpression();
      if (consume() !== ')') throw new Error('Mismatched parenthesis');
      return inner;
    }
    const start = pos;
    while (/[0-9.]/.test(peek())) {
      consume();
    }
    const numStr = cleaned.slice(start, pos);
    if (!numStr || Number.isNaN(Number(numStr))) {
      throw new Error(`Expected number at position ${start}`);
    }
    return Number(numStr);
  }

  const result = parseExpression();
  if (pos !== cleaned.length) {
    throw new Error(`Unexpected token at position ${pos}`);
  }
  if (!Number.isFinite(result)) {
    throw new Error('Non-finite math result');
  }
  return result;
}

export const TOOL_DECLARATIONS: Record<string, FunctionDeclaration> = {
  calculator: {
    name: 'calculator',
    description: 'Evaluates safe arithmetic expressions (+, -, *, /, %, ^, parentheses).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        expression: { type: Type.STRING, description: 'Arithmetic expression e.g. (1250 * 1.09) / 2' },
      },
      required: ['expression'],
    },
  },
  datetime: {
    name: 'datetime',
    description: 'Returns current date and time in Gregorian ISO and Persian Jalali calendar.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        timezone: { type: Type.STRING, description: 'IANA timezone e.g. Asia/Tehran or UTC' },
      },
    },
  },
  memory_search: {
    name: 'memory_search',
    description: 'Searches long-term memory records belonging strictly to the current user.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Semantic search query' },
      },
      required: ['query'],
    },
  },
  user_profile: {
    name: 'user_profile',
    description: 'Reads the current user language, active personality, and memory mode.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
};

export function getEnabledToolDeclarations(db: DatabaseSync): {
  functionDeclarations: FunctionDeclaration[];
  webSearchEnabled: boolean;
} {
  const rows = db.prepare('SELECT tool_name, is_enabled FROM tool_permissions').all() as Array<{
    tool_name: string;
    is_enabled: number;
  }>;
  const enabledMap = new Map(rows.map((r) => [r.tool_name, r.is_enabled === 1]));
  const functionDeclarations: FunctionDeclaration[] = [];

  for (const [name, decl] of Object.entries(TOOL_DECLARATIONS)) {
    if (enabledMap.get(name)) {
      functionDeclarations.push(decl);
    }
  }

  const webSearchSetting = db
    .prepare("SELECT value FROM system_settings WHERE key = 'web_search_enabled'")
    .get() as { value: string } | undefined;
  const webSearchEnabled =
    Boolean(enabledMap.get('web_search')) && webSearchSetting?.value !== 'false' && Boolean(process.env.GEMINI_API_KEY);

  return { functionDeclarations, webSearchEnabled };
}

export async function executeRegisteredTool(
  db: DatabaseSync,
  userId: number,
  toolName: string,
  args: Record<string, unknown>
): Promise<{ result: unknown; status: 'success' | 'denied' | 'error'; durationMs: number }> {
  const start = Date.now();
  const perm = db
    .prepare('SELECT is_enabled, timeout_ms FROM tool_permissions WHERE tool_name = ?')
    .get(toolName) as { is_enabled: number; timeout_ms: number } | undefined;

  if (!perm || perm.is_enabled !== 1) {
    const durationMs = Date.now() - start;
    db.prepare(
      `INSERT INTO tool_executions (user_id, tool_name, arguments_json, status, duration_ms, error_message)
       VALUES (?, ?, ?, 'denied', ?, 'Tool disabled or unregistered')`
    ).run(userId, toolName, JSON.stringify(args), durationMs);
    return { result: { error: 'Tool is disabled or unavailable' }, status: 'denied', durationMs };
  }

  try {
    let output: unknown;
    if (toolName === 'calculator') {
      const expr = String(args.expression ?? '');
      output = { expression: expr, value: evaluateSafeMath(expr) };
    } else if (toolName === 'datetime') {
      const tz = typeof args.timezone === 'string' && args.timezone.trim() ? args.timezone.trim() : 'Asia/Tehran';
      const now = new Date();
      let persianDate = '';
      let gregorianLocal = '';
      try {
        persianDate = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
          dateStyle: 'full',
          timeStyle: 'medium',
          timeZone: tz,
        }).format(now);
        gregorianLocal = new Intl.DateTimeFormat('en-US', {
          dateStyle: 'full',
          timeStyle: 'medium',
          timeZone: tz,
        }).format(now);
      } catch {
        persianDate = now.toISOString();
        gregorianLocal = now.toISOString();
      }
      output = { iso: now.toISOString(), timezone: tz, persianDate, gregorianLocal };
    } else if (toolName === 'memory_search') {
      const query = String(args.query ?? '');
      const memories = retrieveRelevantMemories(db, userId, query, 5);
      output = {
        count: memories.length,
        memories: memories.map((m) => ({
          category: m.category,
          topic: m.topic_key,
          content: m.content,
          importance: m.importance,
        })),
      };
    } else if (toolName === 'user_profile') {
      const user = db
        .prepare(
          `SELECT u.display_name, u.language, u.status, s.active_personality_code, s.memory_mode
           FROM users u
           LEFT JOIN user_settings s ON s.user_id = u.id
           WHERE u.id = ?`
        )
        .get(userId);
      output = user ?? { error: 'User not found' };
    } else {
      throw new Error(`Unsupported local tool execution: ${toolName}`);
    }

    const durationMs = Date.now() - start;
    db.prepare(
      `INSERT INTO tool_executions (user_id, tool_name, arguments_json, status, duration_ms)
       VALUES (?, ?, ?, 'success', ?)`
    ).run(userId, toolName, JSON.stringify(args), durationMs);

    db.prepare(
      `INSERT INTO audit_logs (actor_type, actor_id, action, resource, details, severity)
       VALUES ('user', ?, 'tool.executed', ?, ?, 'info')`
    ).run(String(userId), toolName, `Executed in ${durationMs}ms`);

    return { result: output, status: 'success', durationMs };
  } catch (err) {
    const durationMs = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    db.prepare(
      `INSERT INTO tool_executions (user_id, tool_name, arguments_json, status, duration_ms, error_message)
       VALUES (?, ?, ?, 'error', ?, ?)`
    ).run(userId, toolName, JSON.stringify(args), durationMs, msg);
    return { result: { error: msg }, status: 'error', durationMs };
  }
}
