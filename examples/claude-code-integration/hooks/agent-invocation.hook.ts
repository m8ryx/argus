#!/usr/bin/env bun
/**
 * agent-invocation.hook.ts — mirrors subagent (Task/Agent tool) lifecycle into Argus.
 *
 * Wire as BOTH a PreToolUse and a PostToolUse hook, matcher "Agent" (or
 * whatever your agent calls its subagent-dispatch tool). Correlates start/stop
 * by session_id + description so duration can be computed on stop.
 *
 * Needs a small sidecar file to bridge Pre -> Post; swap STARTS_FILE for
 * whatever key-value store your environment already has if you don't want a
 * bare JSON file on disk.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { pushToArgus } from './push-to-argus';

const STARTS_FILE = '/tmp/agent-invocation-starts.json';

interface AgentToolInput {
  subagent_type?: string;
  description?: string;
  prompt?: string;
}

interface ToolHookInput {
  session_id?: string;
  hook_event_name?: string; // "PreToolUse" | "PostToolUse"
  tool_name?: string;
  tool_input?: AgentToolInput;
  error?: string;
}

function readStarts(): Record<string, number> {
  try {
    if (existsSync(STARTS_FILE)) return JSON.parse(readFileSync(STARTS_FILE, 'utf-8'));
  } catch { /* corrupted — reset */ }
  return {};
}

function writeStarts(starts: Record<string, number>) {
  writeFileSync(STARTS_FILE, JSON.stringify(starts), 'utf-8');
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

    const data: ToolHookInput = JSON.parse(raw);
    if (data.tool_name !== 'Agent') process.exit(0);

    const sessionId = data.session_id || 'unknown';
    const input = data.tool_input || {};
    const subagentType = input.subagent_type || 'general-purpose';
    const description = input.description || '(no description)';
    const isPost = data.hook_event_name === 'PostToolUse';
    const key = `${sessionId}::${description}`;

    if (!isPost) {
      const starts = readStarts();
      starts[key] = Date.now();
      writeStarts(starts);

      await pushToArgus('agent', `${subagentType} started: ${description.slice(0, 80)}`, sessionId, {
        subagent_type: subagentType,
        description,
      }, { status: 'activated', hook: 'SubagentActivated' });
    } else {
      const starts = readStarts();
      const startedAt = starts[key];
      const duration = startedAt ? Math.round((Date.now() - startedAt) / 1000) : null;
      if (startedAt) { delete starts[key]; writeStarts(starts); }

      await pushToArgus('agent', `${subagentType} stopped: ${description.slice(0, 80)} (${duration ?? '?'}s)`, sessionId, {
        subagent_type: subagentType,
        description,
        duration_seconds: duration,
      }, { status: data.error ? 'failure' : 'success', hook: 'PostToolUse' });
    }
  } catch (e) {
    console.error('[agent-invocation]', e instanceof Error ? e.message : String(e));
  }
  process.exit(0);
}

main();
