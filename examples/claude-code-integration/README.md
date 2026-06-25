# Claude Code -> Argus integration

Wires [Claude Code](https://docs.claude.com/claude-code) hooks to mirror live
agent activity (tool calls, subagent lifecycle, automated git commits) into
Argus, so the dashboard shows what an agent is actually doing in real time
instead of sitting empty.

This is a drop-in example for Claude Code specifically, but the event
contract below is the part worth reading even if you're wiring up a
different agent harness (Cursor, Kiro, Aider, a custom framework, etc.) —
the hook *names* won't match, but the shape Argus expects is the same.

## Files

| File | Wire as | What it captures |
|---|---|---|
| `hooks/push-to-argus.ts` | (shared helper, not a hook itself) | POSTs a single event to Argus, fire-and-forget |
| `hooks/tool-activity.hook.ts` | `PostToolUse`, no matcher (all tools) | Every tool call, with derived success/failure |
| `hooks/agent-invocation.hook.ts` | `PreToolUse` + `PostToolUse`, matcher `Agent` | Subagent dispatch start/stop, with duration |
| `hooks/checkpoint-commit.example.ts` | (snippet, not a hook) | Reports an automated git commit your own tooling makes |

### Wiring (`settings.json`)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Agent",
        "hooks": [
          { "type": "command", "command": "$HOME/.claude/hooks/agent-invocation.hook.ts", "timeout": 5, "async": true }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Agent",
        "hooks": [
          { "type": "command", "command": "$HOME/.claude/hooks/agent-invocation.hook.ts", "timeout": 5, "async": true }
        ]
      },
      {
        "hooks": [
          { "type": "command", "command": "$HOME/.claude/hooks/tool-activity.hook.ts", "timeout": 5, "async": true }
        ]
      }
    ]
  }
}
```

`async: true` matters — these hooks should never block the agent's turn on
Argus being reachable.

## The event contract (for porting to other agents)

Argus's dashboard (`EventTable.svelte`) only renders what you actually send.
These are the fields worth setting and why:

| Field | Where | Purpose |
|---|---|---|
| `source` | top-level | Which agent/tool produced this (`pai`, `kiro`, `aider`, ...) |
| `event_type` | top-level | Coarse category: `tool`, `agent`, `command` |
| `session_id` | top-level | Groups events into a session in the Session Tree |
| `data.project` | nested | Powers the Project filter/column — basename of cwd or repo is a reasonable default |
| `status` | top-level | One of `success`/`failure`/`pending`/`activated` — coarse outcome, NOT an exit code |
| `hook` | top-level | **Required for the status badge to render at all.** Must be one of `PreToolUse` / `PostToolUse` / `SubagentActivated` — anything else (or absent) and the dashboard silently shows `—` regardless of `status`. This was a real gap we hit: setting `status` alone did nothing visible until `hook` was also set. |
| `is_background` | top-level | Distinguishes "kicked off a long-running thing" from "this finished" — don't conflate with `status`, which still describes only the launch you observed, not a later completion you can't see |

If you're porting this to a different agent harness, the porting work is
just: find your harness's equivalent of "a tool finished" and "a sub-task
started/stopped," and call something like `pushToArgus()` from those points
with the fields above. The harness-specific hook *files* in this directory
are illustrative, not load-bearing — the table above is the part that
transfers.

## Known limitations (carried over honestly, not fixed here)

- `source` is self-reported and unverified — anything holding the API key
  can claim to be any source. Fine for a single-developer dashboard, not a
  basis for treating this as an audit trail.
- Session status updates are mutable (`PATCH /sessions/{id}`) rather than
  append-only events, so a session's prior states aren't recoverable once
  changed.
- Don't reach for this as a forensics/incident-reconstruction tool — it's
  debugging telemetry, not a tamper-evident ledger.
