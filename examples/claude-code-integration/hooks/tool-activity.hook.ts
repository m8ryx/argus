#!/usr/bin/env bun
/**
 * tool-activity.hook.ts — mirrors every Claude Code tool call into Argus.
 *
 * Wire as a PostToolUse hook with no matcher (fires on every tool).
 * Derives `status` from a Bash exit code / explicit error field when
 * present; defaults to success otherwise.
 */

import { pushToArgus } from './push-to-argus';

interface ToolUseInput {
  session_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: { exit_code?: number; exitCode?: number } & Record<string, unknown>;
  error?: string;
}

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    const timer = setTimeout(() => resolve(data), 2000);
    process.stdin.on('data', (c) => { data += c.toString(); });
    process.stdin.on('end', () => { clearTimeout(timer); resolve(data); });
    process.stdin.on('error', () => { clearTimeout(timer); resolve(data); });
  });
}

async function main() {
  try {
    const raw = await readStdin();
    if (!raw.trim()) process.exit(0);

    const data: ToolUseInput = JSON.parse(raw);
    const toolName = data.tool_name || 'unknown';
    const exitCode = data.tool_response?.exit_code ?? data.tool_response?.exitCode;
    const failed = Boolean(data.error) || (exitCode !== undefined && Number(exitCode) !== 0);
    const isBackground = toolName === 'Bash' && data.tool_input?.run_in_background === true;

    await pushToArgus('tool', toolName, data.session_id, {
      tool_input_preview: JSON.stringify(data.tool_input || {}).slice(0, 300),
    }, {
      status: failed ? 'failure' : 'success',
      isBackground,
      hook: 'PostToolUse',
    });
  } catch (e) {
    console.error('[tool-activity]', e instanceof Error ? e.message : String(e));
  }
  process.exit(0);
}

main();
