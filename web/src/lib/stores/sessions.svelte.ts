/**
 * Sessions and Agents store for Argus dashboard
 *
 * Manages session/agent state with hierarchy building and real-time updates.
 */

import websocket, { type ServerMessage } from "./websocket.svelte";

// Session interface
export interface Session {
  id: string;
  project?: string;
  status: "active" | "ended";
  created_at?: string;
  completed_at?: string;
  last_event_time?: string; // Track last activity for staleness detection
  is_idle?: boolean; // Active session with no events for 10+ minutes
}

// Agent interface
export interface Agent {
  id: string;
  session_id: string;
  parent_agent_id?: string;
  name?: string;
  type?: string;
  status: "pending" | "running" | "completed" | "failed" | "abandoned";
  event_count: number;
  created_at: string;
  completed_at?: string;
}

// Agent hierarchy structure
export interface AgentHierarchy {
  rootAgents: Agent[];
  childrenMap: Record<string, Agent[]>;
}

// Module-level state using Svelte 5 runes
let sessions: Map<string, Session> = $state(new Map());
let agents: Map<string, Agent> = $state(new Map());
let selectedSessionId: string | null = $state(null);
let selectedAgentId: string | null = $state(null);

// Add or update session
function addSession(session: Session): void {
  sessions = new Map(sessions).set(session.id, session);
  console.log(
    `[sessions] Added session ${session.id} (${session.project || "no project"})`,
  );
}

// Update session (e.g., when ended)
function updateSession(id: string, updates: Partial<Session>): void {
  const existing = sessions.get(id);
  if (existing) {
    sessions = new Map(sessions).set(id, { ...existing, ...updates });
    console.log(`[sessions] Updated session ${id}: status=${updates.status}`);
  }
}

// Add or update agent
function addAgent(agent: Agent): void {
  agents = new Map(agents).set(agent.id, agent);
  console.log(
    `[sessions] Added agent ${agent.id} (${agent.type || agent.name || "unnamed"})`,
  );
}

// Update agent
function updateAgent(id: string, updates: Partial<Agent>): void {
  const existing = agents.get(id);
  if (existing) {
    agents = new Map(agents).set(id, { ...existing, ...updates });
    console.log(`[sessions] Updated agent ${id}: status=${updates.status}`);
  }
}

// Handle agent activation (old_id -> new_id swap)
function activateAgent(
  oldId: string,
  newId: string,
  updates: Partial<Agent>,
): void {
  const existing = agents.get(oldId);
  if (existing) {
    // Remove old entry
    const newAgents = new Map(agents);
    newAgents.delete(oldId);
    // Add with new ID
    newAgents.set(newId, { ...existing, id: newId, ...updates });
    agents = newAgents;

    // Update selection if needed
    if (selectedAgentId === oldId) {
      selectedAgentId = newId;
    }
    console.log(`[sessions] Activated agent ${oldId} -> ${newId}`);
  }
}

// Build agent hierarchy from flat agent list
function buildAgentHierarchy(sessionId?: string): AgentHierarchy {
  const agentList = sessionId
    ? Array.from(agents.values()).filter((a) => a.session_id === sessionId)
    : Array.from(agents.values());

  const rootAgents: Agent[] = [];
  const childrenMap: Record<string, Agent[]> = {};
  const agentIds = new Set(agentList.map((a) => a.id));

  agentList.forEach((agent) => {
    const parentId = agent.parent_agent_id;

    if (parentId && agentIds.has(parentId)) {
      // Valid parent exists - add to children map
      if (!childrenMap[parentId]) {
        childrenMap[parentId] = [];
      }
      childrenMap[parentId].push(agent);
    } else {
      // No parent or parent not found - treat as root
      rootAgents.push(agent);
    }
  });

  return { rootAgents, childrenMap };
}

// Get sessions as array (newest first)
function getSessions(): Session[] {
  return Array.from(sessions.values()).sort((a, b) => {
    const aTime = a.created_at || "";
    const bTime = b.created_at || "";
    return bTime.localeCompare(aTime);
  });
}

// Get agents for a session
function getAgentsForSession(sessionId: string): Agent[] {
  return Array.from(agents.values()).filter((a) => a.session_id === sessionId);
}

// Get all agents (for swimlanes view)
function getAgents(): Agent[] {
  return Array.from(agents.values());
}

// Selection management
function selectSession(id: string | null): void {
  selectedSessionId = id;
  selectedAgentId = null; // Clear agent selection when session changes
}

function selectAgent(id: string | null): void {
  selectedAgentId = id;
}

function getSelectedSessionId(): string | null {
  return selectedSessionId;
}

function getSelectedAgentId(): string | null {
  return selectedAgentId;
}

// Update last event time for a session (called when events loaded)
function updateSessionLastEventTime(
  sessionId: string,
  timestamp: string,
): void {
  const existing = sessions.get(sessionId);
  if (existing) {
    const current = existing.last_event_time;
    // Only update if newer
    if (!current || timestamp > current) {
      sessions = new Map(sessions).set(sessionId, {
        ...existing,
        last_event_time: timestamp,
      });
    }
  }
}

// Check if session is stale (active but no recent events)
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

function isSessionStale(session: Session): boolean {
  if (session.status !== "active") return false;
  if (!session.last_event_time) return true; // No events = stale

  const lastEvent = new Date(session.last_event_time).getTime();
  const now = Date.now();
  return now - lastEvent > STALE_THRESHOLD_MS;
}

// Clear all (for refresh)
function clearAll(): void {
  sessions = new Map();
  agents = new Map();
  selectedSessionId = null;
  selectedAgentId = null;
}

// Close session via API (WebSocket broadcast will update state)
async function closeSession(sessionId: string): Promise<boolean> {
  const apiKey = import.meta.env.VITE_ARGUS_API_KEY;
  try {
    const res = await fetch(`/sessions/${sessionId}`, {
      method: "PATCH",
      headers: apiKey ? { "X-API-Key": apiKey } : {},
    });
    if (!res.ok) {
      console.error(
        `[sessions] Failed to close session ${sessionId}: ${res.status}`,
      );
      return false;
    }
    console.log(`[sessions] Closed session ${sessionId}`);
    return true;
  } catch (err) {
    console.error(`[sessions] Error closing session ${sessionId}:`, err);
    return false;
  }
}

// API response types (differ slightly from store interfaces)
interface SessionResponse {
  id: string;
  project?: string;
  started_at: string;
  ended_at?: string;
  status: "active" | "ended";
  agent_count?: number;
  is_idle?: boolean;
}

interface AgentResponse {
  id: string;
  session_id: string;
  parent_agent_id?: string;
  name?: string;
  type?: string;
  status: "pending" | "running" | "completed" | "failed" | "abandoned";
  event_count: number;
  created_at: string;
  completed_at?: string;
}

// Load initial data from REST API
async function loadInitialData(): Promise<void> {
  console.log("[sessions] Loading initial data from REST API...");

  try {
    // Fetch sessions and agents in parallel
    const [sessionsRes, agentsRes] = await Promise.all([
      fetch("/sessions"),
      fetch("/agents"),
    ]);

    if (!sessionsRes.ok) {
      console.warn(
        `[sessions] Failed to fetch sessions: ${sessionsRes.status}`,
      );
      return;
    }
    if (!agentsRes.ok) {
      console.warn(`[sessions] Failed to fetch agents: ${agentsRes.status}`);
      return;
    }

    const sessionsData = await sessionsRes.json();
    const agentsData = await agentsRes.json();

    // Map and add sessions (API uses started_at/ended_at, store uses created_at/completed_at)
    const sessionList: SessionResponse[] = sessionsData.sessions || [];
    for (const s of sessionList) {
      addSession({
        id: s.id,
        project: s.project,
        status: s.status,
        created_at: s.started_at,
        completed_at: s.ended_at,
        is_idle: s.is_idle,
      });
    }

    // Add agents (fields match directly)
    const agentList: AgentResponse[] = agentsData.agents || [];
    for (const a of agentList) {
      addAgent({
        id: a.id,
        session_id: a.session_id,
        parent_agent_id: a.parent_agent_id,
        name: a.name,
        type: a.type,
        status: a.status,
        event_count: a.event_count || 0,
        created_at: a.created_at,
        completed_at: a.completed_at,
      });
    }

    console.log(
      `[sessions] Loaded ${sessionList.length} sessions, ${agentList.length} agents`,
    );
  } catch (err) {
    console.error("[sessions] Error loading initial data:", err);
    // Graceful degradation - WebSocket will still work
  }
}

// WebSocket message handlers
function handleSessionStarted(message: ServerMessage): void {
  const session = message.payload as Session;
  if (session) {
    addSession({ ...session, status: "active" });
  }
}

function handleSessionEnded(message: ServerMessage): void {
  const session = message.payload as { id: string; completed_at?: string };
  if (session) {
    updateSession(session.id, {
      status: "ended",
      completed_at: session.completed_at,
    });
  }
}

function handleSessionActive(message: ServerMessage): void {
  const session = message.payload as { id: string; is_idle?: boolean };
  if (session) {
    updateSession(session.id, { is_idle: false });
  }
}

function handleSessionIdle(message: ServerMessage): void {
  const session = message.payload as { id: string; is_idle?: boolean };
  if (session) {
    updateSession(session.id, { is_idle: true });
  }
}

function handleAgentStarted(message: ServerMessage): void {
  const agent = message.payload as Agent;
  if (agent) {
    addAgent({
      ...agent,
      status: "running",
      event_count: agent.event_count || 0,
    });
  }
}

function handleAgentActivated(message: ServerMessage): void {
  const payload = message.payload as {
    old_id: string;
    id: string;
  } & Partial<Agent>;
  if (payload && payload.old_id && payload.id) {
    activateAgent(payload.old_id, payload.id, payload);
  }
}

function handleAgentCompleted(message: ServerMessage): void {
  const agent = message.payload as {
    id: string;
    status?: string;
    event_count?: number;
    completed_at?: string;
  };
  if (agent) {
    updateAgent(agent.id, {
      status: (agent.status as Agent["status"]) || "completed",
      event_count: agent.event_count,
      completed_at: agent.completed_at,
    });
  }
}

// Initialize WebSocket handler registration
function initializeHandlers(): () => void {
  const unsubscribes = [
    websocket.onMessage("session_started", handleSessionStarted),
    websocket.onMessage("session_ended", handleSessionEnded),
    websocket.onMessage("session_active", handleSessionActive),
    websocket.onMessage("session_idle", handleSessionIdle),
    websocket.onMessage("agent_started", handleAgentStarted),
    websocket.onMessage("agent_activated", handleAgentActivated),
    websocket.onMessage("agent_completed", handleAgentCompleted),
    websocket.onMessage("agent_abandoned", handleAgentCompleted), // Same handler, status comes from payload
  ];
  console.log(
    "[sessions] Registered WebSocket handlers for session/agent messages",
  );

  return () => unsubscribes.forEach((unsub) => unsub());
}

// Export store interface
export const sessionsStore = {
  getSessions,
  getAgents,
  getAgentsForSession,
  buildAgentHierarchy,
  addSession,
  updateSession,
  addAgent,
  updateAgent,
  activateAgent,
  selectSession,
  selectAgent,
  getSelectedSessionId,
  getSelectedAgentId,
  clearAll,
  closeSession,
  initializeHandlers,
  loadInitialData,
  updateSessionLastEventTime,
  isSessionStale,
};

export default sessionsStore;
