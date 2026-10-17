// Mirrors OpenCode 2 activity into a local Argus server,
// matching what the Claude Code integration example sends: tool calls (PreToolUse /
// PostToolUse), a session row per top-level session, and child sessions (task
// subagents) as agents. Best effort: if Argus is down or no API key is configured,
// nothing happens. Set ARGUS_OPENCODE_DEBUG=1 to log raw payloads to
// $TMPDIR/argus-opencode-debug.jsonl. ARGUS_URL and ARGUS_API_KEY override the
// defaults (127.0.0.1:8765, first key in ~/.config/argus/config.toml).

import { existsSync, readFileSync, appendFileSync } from "node:fs"
import { basename, join } from "node:path"
import { homedir, tmpdir } from "node:os"

const ARGUS_URL = process.env.ARGUS_URL ?? "http://127.0.0.1:8765"
const SOURCE = "opencode"
const DEBUG = process.env.ARGUS_OPENCODE_DEBUG === "1"
const DEBUG_PATH = join(tmpdir(), "argus-opencode-debug.jsonl")
const MAX_STR = 2000

function apiKey() {
  if (process.env.ARGUS_API_KEY) return process.env.ARGUS_API_KEY
  try {
    const path = join(homedir(), ".config", "argus", "config.toml")
    if (!existsSync(path)) return ""
    return readFileSync(path, "utf-8").match(/api_keys\s*=\s*\[\s*"([^"]+)"/)?.[1] ?? ""
  } catch {
    return ""
  }
}

const clip = (_k, v) => (typeof v === "string" && v.length > MAX_STR ? v.slice(0, MAX_STR) + "…" : v)

function debug(kind, value) {
  if (!DEBUG) return
  try {
    appendFileSync(DEBUG_PATH, JSON.stringify({ kind, value }, clip) + "\n")
  } catch {}
}

async function push(key, body) {
  try {
    await fetch(`${ARGUS_URL}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": key },
      body: JSON.stringify({ source: SOURCE, ...body }, clip),
      signal: AbortSignal.timeout(2000),
    })
  } catch {}
}

function summarize(tool, input) {
  if (!input || typeof input !== "object") return tool
  const v = input.command ?? input.filePath ?? input.path ?? input.pattern ?? input.url ?? input.query ?? input.description
  return typeof v === "string" && v ? `${tool}: ${v.slice(0, 200)}` : tool
}

export default {
  id: "argus",
  async setup(ctx) {
    const key = apiKey()
    if (!key) return
    const fallbackProject = basename(ctx.location?.project?.canonical ?? ctx.location?.directory ?? process.cwd())

    // sessionID -> Promise<{ parentID?, root, project }>; resolved once per session.
    const sessions = new Map()
    const resolve = (sessionID) => {
      if (!sessionID) return Promise.resolve(undefined)
      if (sessions.has(sessionID)) return sessions.get(sessionID)
      const p = (async () => {
        let info
        try {
          info = await ctx.session.get({ sessionID })
          info = info?.data ?? info
        } catch {}
        const dir = info?.location?.directory
        const project = dir ? basename(dir) : fallbackProject
        const parentID = info?.parentID
        if (parentID) {
          const parent = await resolve(parentID)
          const root = parent?.root ?? parentID
          void push(key, {
            event_type: "agent",
            hook: "SubagentStart",
            message: `${info?.agent ?? "subagent"} running${info?.title ? `: ${info.title}` : ""}`,
            session_id: root,
            agent_id: sessionID,
            data: { project, subagent_type: info?.agent, title: info?.title },
          })
          return { parentID, root, project }
        }
        void push(key, {
          event_type: "session",
          hook: "SessionStart",
          message: `Session started${info?.title ? `: ${info.title}` : ""}`,
          session_id: sessionID,
          data: { project, title: info?.title, agent: info?.agent },
        })
        return { root: sessionID, project }
      })()
      sessions.set(sessionID, p)
      return p
    }

    const toolEvent = async (event, phase) => {
      debug(`tool.${phase}`, event)
      const s = await resolve(event.sessionID)
      const failed = event.status === "error"
      void push(key, {
        event_type: "tool",
        hook: phase === "before" ? "PreToolUse" : "PostToolUse",
        message: summarize(event.tool, event.input) + (failed ? ` (failed: ${event.error?.message ?? "error"})` : ""),
        session_id: s?.root ?? event.sessionID,
        tool_name: event.tool,
        tool_use_id: event.id,
        status: phase === "before" ? "pending" : failed ? "failure" : "success",
        ...(s?.parentID ? { agent_id: event.sessionID } : {}),
        data: { project: s?.project ?? fallbackProject, agent: event.agent, input: event.input },
      })
    }

    await ctx.tool.hook("execute.before", (event) => {
      void toolEvent(event, "before")
    })
    await ctx.tool.hook("execute.after", (event) => {
      void toolEvent(event, "after")
    })

    const controller = new AbortController()
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          const sessionID = event?.data?.sessionID
          if (!sessionID) continue
          if (event.type === "session.execution.started") {
            void resolve(sessionID)
          } else if (event.type === "session.execution.succeeded" || event.type === "session.execution.failed") {
            const s = await resolve(sessionID)
            if (s?.parentID) {
              void push(key, {
                event_type: "agent",
                hook: "SubagentStop",
                message: `subagent ${event.type.endsWith("failed") ? "failed" : "stopped"}`,
                session_id: s.root,
                agent_id: sessionID,
                data: { project: s.project, status: event.type.endsWith("failed") ? "failed" : "completed" },
              })
            }
          }
        }
      } catch {}
    })()
    return () => controller.abort()
  },
}
