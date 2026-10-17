# OpenCode -> Argus integration

An [OpenCode](https://opencode.ai) 2.x plugin that mirrors live agent activity
into Argus, the counterpart of `../claude-code-integration` for OpenCode.

It uses the OpenCode 2 plugin API (`setup(ctx)`, `ctx.tool.hook`,
`ctx.event.subscribe`). OpenCode 1.x plugins use a different API and will not
load this file.

## What it sends

All events use `source: "opencode"` and carry `data.project` (the basename of
the session's directory).

| OpenCode signal | Argus event |
|---|---|
| Tool about to run (`tool` hook `execute.before`) | `event_type: tool`, `hook: PreToolUse`, `status: pending`, `tool_use_id` |
| Tool finished (`execute.after`) | `event_type: tool`, `hook: PostToolUse`, `status: success` / `failure` |
| First activity in a top-level session | `event_type: session`, `hook: SessionStart` (creates the Session Tree row) |
| First activity in a child session (task subagent) | `event_type: agent`, `hook: SubagentStart`, `agent_id` = child session id, `session_id` = root session |
| Child session execution finished | `event_type: agent`, `hook: SubagentStop` |

Tool calls made inside a subagent carry its `agent_id`, so they land in that
agent's swimlane.

OpenCode 2 has no session-ended event, so OpenCode sessions are never sent a
`SessionEnd` and stay active in Argus.

## Install

```sh
cp argus.js ~/.config/opencode/plugins/argus.js
```

Files in `~/.config/opencode/plugins/` (or a project's `.opencode/plugins/`)
load automatically; the shared OpenCode service picks up a new plugin without
a restart.

## Configuration

| Variable | Default |
|---|---|
| `ARGUS_URL` | `http://127.0.0.1:8765` |
| `ARGUS_API_KEY` | first entry of `api_keys` in `~/.config/argus/config.toml` |
| `ARGUS_OPENCODE_DEBUG=1` | logs raw hook and event payloads to `$TMPDIR/argus-opencode-debug.jsonl` |

With no API key found the plugin does nothing. Every POST is fire-and-forget
with a 2 s timeout, so Argus being down never slows OpenCode.

## Verify

```sh
opencode run --auto "Run the shell command: echo hello-argus"
curl -s -H "X-API-Key: $KEY" 'http://127.0.0.1:8765/events?source=opencode&limit=5'
```
