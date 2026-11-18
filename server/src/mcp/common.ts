/* Helpers shared by the MCP tools: results, refusals with every problem listed, and the call log (spec §6). */
import { TestValidationError, zodIssueList, type ImportIssue } from '@ielts/shared';
import { ZodError } from 'zod';
import { HttpError } from '../http/errors';

export interface ToolResult { [k: string]: unknown; content: Array<{ type: 'text'; text: string }>; isError?: boolean }
export const ok = (data: unknown): ToolResult => ({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 1) }] });
export const fail = (message: string, issues: ImportIssue[] = []): ToolResult => ({
  isError: true,
  content: [{ type: 'text', text: issues.length ? `${message}\n${issues.map(i => `- ${i.path}${i.where ? ` [${i.where}]` : ''}: ${i.message}`).join('\n')}` : message }]
});

/** every tool call is logged (spec §6): name, outcome, time */
export function logged<A>(name: string, fn: (args: A) => Promise<ToolResult>): (args: A) => Promise<ToolResult> {
  return async (args: A) => {
    const t0 = Date.now();
    try {
      const r = await fn(args);
      console.log(`[mcp] ${name} ${r.isError ? 'refused' : 'ok'} (${Date.now() - t0} ms)`);
      return r;
    } catch (e) {
      if (e instanceof TestValidationError) { console.log(`[mcp] ${name} refused (invalid test)`); return fail('The test is not valid. Nothing was saved. Fix every problem below and call the tool again:', e.errors); }
      if (e instanceof ZodError) { console.log(`[mcp] ${name} refused (invalid input)`); return fail('Not valid, so nothing was saved. Fix every problem below and call the tool again:', zodIssueList(e)); }
      if (e instanceof HttpError) { console.log(`[mcp] ${name} refused: ${e.message}`); return fail(e.message); }
      console.error(`[mcp] ${name} failed`, e);
      return fail('The server hit an error. Try again; if it repeats, tell the student to check the site.');
    }
  };
}

