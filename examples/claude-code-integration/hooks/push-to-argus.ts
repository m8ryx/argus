#!/usr/bin/env bun
/**
 * push-to-argus.ts — shared helper for mirroring Claude Code hook events into Argus.
 *
 * Standalone version of the helper used internally by the other hooks in this
 * directory. Reads the Argus API key from ~/.config/argus/config.toml so it
 * never needs to be duplicated into your agent's own config.
 *
 * Best-effort / fire-and-forget: if Argus isn't running, failures are
 * swallowed silently — this should never be able to break the hook that
 * calls it.
 */

import { readFileSync, existsSync } from 'fs';
import { join, basename } from 'path';

const ARGUS_URL = process.env.ARGUS_URL || 'http://127.0.0.1:8765';

function getArgusApiKey(): string {
  try {
    const configPath = join(process.env.HOME || '', '.config', 'argus', 'config.toml');
    if (!existsSync(configPath)) return '';
    const content = readFileSync(configPath, 'utf-8');
    return content.match(/api_keys\s*=\s*\[\s*"([^"]+)"/)?.[1] ?? '';
  } catch {
    return '';
  }
}

export interface PushToArgusOptions {
  /** Defaults to basename(process.cwd()). Pass explicitly when the relevant
   *  project/repo differs from cwd. Populates Argus's project filter. */
  project?: string;
  /** Coarse outcome for badge coloring in the dashboard. Put exit codes /
   *  error detail in `data`, not here. */
  status?: 'success' | 'failure' | 'pending' | 'activated';
  /** Marks a kickoff whose actual completion can't be observed from this
   *  hook (e.g. a backgrounded shell command). */
  isBackground?: boolean;
  /** Argus's dashboard (EventTable) only renders a status badge when `hook`
   *  is one of these three values — `status` alone is otherwise ignored by
   *  the UI. Pick whichever best matches the lifecycle point this push
   *  represents. */
  hook?: 'PreToolUse' | 'PostToolUse' | 'SubagentActivated';
  /** Links this event to the subagent that produced it. Claude Code stamps
   *  `agent_id`/`agent_type` directly on the PostToolUse payload for any tool
   *  call made INSIDE a subagent — this is harness-assigned per-invocation
   *  data, not anything you need to thread through shared/implicit context
   *  yourself, so it's safe under concurrent subagent spawns with zero extra
   *  propagation work. Argus's events table has a native `agent_id` column
   *  for exactly this. */
  agentId?: string;
}

export async function pushToArgus(
  eventType: string,
  message: string,
  sessionId: string | undefined,
  data: Record<string, unknown>,
  opts: PushToArgusOptions = {}
): Promise<void> {
  const apiKey = getArgusApiKey();
  if (!apiKey) return;
  try {
    await fetch(`${ARGUS_URL}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({
        source: process.env.ARGUS_SOURCE || 'agent',
        event_type: eventType,
        message,
        session_id: sessionId,
        data: { project: opts.project || basename(process.cwd()), ...data },
        ...(opts.status ? { status: opts.status } : {}),
        ...(opts.isBackground !== undefined ? { is_background: opts.isBackground } : {}),
        ...(opts.hook ? { hook: opts.hook } : {}),
        ...(opts.agentId ? { agent_id: opts.agentId } : {}),
      }),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // Argus down/unreachable — ignore.
  }
}
