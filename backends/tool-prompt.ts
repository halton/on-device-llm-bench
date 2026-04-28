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

If the request needs no tool (pure conversation), respond with:
{"tool": "none", "args": {}}

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
