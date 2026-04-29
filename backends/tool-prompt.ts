// Shared system prompt + tool-call parser for both backends.
// Tool schema mirrors the extension's actual tools so eval results transfer.

export const TOOLS = [
  { name: 'get_open_tabs', desc: 'List all currently open browser tabs.', args: {} },
  { name: 'go_to_tab',     desc: 'Switch focus to a specific tab.', args: { tabId: 'number' } },
  { name: 'open_url',      desc: 'Open a URL.', args: { url: 'string', background: 'boolean?' } },
  { name: 'close_tab',     desc: 'Close a tab.', args: { tabId: 'number' } },
  { name: 'ask_website',   desc: 'Search current page for content matching a query.', args: { query: 'string' } },
  { name: 'highlight_website_element', desc: 'Highlight a section on the current page.', args: { query: 'string' } },
  { name: 'find_history',  desc: 'Semantic search of browsing history.', args: { query: 'string', sinceDays: 'number?' } },
];

export const TOOL_SYSTEM_PROMPT = `You are a browser assistant. When a user request maps to one of these tools, respond with EXACTLY one JSON object on a single line and nothing else:

{"tool": "<tool_name>", "args": { ... }}

Tools:
${TOOLS.map((t) => `- ${t.name}: ${t.desc} args=${JSON.stringify(t.args)}`).join('\n')}

Rules:
- Argument types MUST match the schema exactly. \`tabId\` and \`sinceDays\` are numbers (e.g., 47, not "47"). \`background\` is a boolean.
- For \`query\` arguments, extract the MINIMAL keyword or noun phrase from the user's request. Do NOT paraphrase or add context. Examples:
  - User: "find the pricing on this page" → {"tool":"ask_website","args":{"query":"pricing"}}
  - User: "highlight the pricing table" → {"tool":"highlight_website_element","args":{"query":"pricing table"}}
  - User: "find that WebGPU article" → {"tool":"find_history","args":{"query":"WebGPU"}}
- Disambiguation: use \`find_history\` for past/previous/earlier browsing ("the article I read", "last week"). Use \`ask_website\` only for the CURRENT page ("on this page", "here").
- In a multi-turn conversation, if the latest user message supplies the missing detail for a previously-clarified action, emit the tool call NOW. Do not ask another question.
- If the request needs no tool (pure conversation, greetings, meta-questions about you), respond with: {"tool": "none", "args": {}}

Never wrap the JSON in code fences. Never add commentary.`;

export const TOOL_JSON_SCHEMA = {
  type: 'object',
  required: ['tool', 'args'],
  additionalProperties: false,
  properties: {
    tool: {
      type: 'string',
      enum: [...TOOLS.map((t) => t.name), 'none'],
    },
    args: { type: 'object' },
  },
};

export interface ParsedToolCall {
  tool: string;
  args: Record<string, unknown>;
}

// Optional post-parse coercion: turn string-numbers ("12") into numbers (12).
// Used by the runner to compute a *separate* coerced pass-rate alongside raw.
export function coerceArgs(args: Record<string, unknown>, schema: Record<string, string>): Record<string, unknown> {
  const out = { ...args };
  for (const [k, t] of Object.entries(schema)) {
    const want = t.replace(/\?$/, '');
    if (want === 'number' && typeof out[k] === 'string' && /^-?\d+(\.\d+)?$/.test(out[k] as string)) {
      out[k] = Number(out[k]);
    } else if (want === 'boolean' && typeof out[k] === 'string') {
      const v = (out[k] as string).toLowerCase();
      if (v === 'true' || v === 'false') out[k] = v === 'true';
    }
  }
  return out;
}

export function toolSchema(name: string): Record<string, string> | null {
  const t = TOOLS.find((x) => x.name === name);
  return t ? (t.args as Record<string, string>) : null;
}

export function parseToolCall(raw: string): ParsedToolCall {
  // Strip code fences if model added them despite instructions.
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  // Find first {...} block (greedy from first { to last }).
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) throw new Error('no json object');
  const json = s.slice(first, last + 1);
  const obj = JSON.parse(json);
  if (typeof obj.tool !== 'string') throw new Error('missing tool');
  return { tool: obj.tool, args: obj.args ?? {} };
}
