/**
 * Events store for Argus dashboard
 *
 * Manages event state with deduplication and real-time updates via WebSocket.
 */

import websocket, { type ServerMessage } from "./websocket.svelte";
import sessionsStore from "./sessions.svelte";

// Event type matching backend schema
export interface Event {
  id: number;
  source: string;
  event_type: "tool" | "session" | "agent" | "response" | "prompt";
  timestamp: string;
  message?: string;
  session_id?: string;
  agent_id?: string;
  data?: Record<string, unknown>;
  // Additional fields from backend
  hook?: string;
  tool_name?: string;
  tool_use_id?: string;
  status?: string;
  is_background?: boolean;
}

// Module-level state using Svelte 5 runes
let events: Event[] = $state([]);
let knownEventIds: Set<number> = new Set();
let eventCount: number = $state(0);
let selectedEventId: number | null = $state(null);

// Add event with deduplication
function addEvent(event: Event): boolean {
  if (knownEventIds.has(event.id)) {
    return false; // Duplicate, skip
  }

  knownEventIds.add(event.id);
  events = [event, ...events]; // Newest first
  eventCount = events.length;
  return true;
}

// Add multiple events (for historical fetch)
function addEvents(newEvents: Event[]): void {
  // Filter to only new events BEFORE adding to known set
  const uniqueEvents = newEvents.filter((e) => !knownEventIds.has(e.id));

  // Now add to known set
  for (const event of uniqueEvents) {
    knownEventIds.add(event.id);
  }

  // Append new events (API returns newest first, so prepend)
  events = [...uniqueEvents, ...events];
  eventCount = events.length;
}

// Clear all events (for refresh)
function clearEvents(): void {
  events = [];
  knownEventIds.clear();
  eventCount = 0;
}

// Get events (reactive getter)
function getEvents(): Event[] {
  return events;
}

// Get event count
function getEventCount(): number {
  return eventCount;
}

// Selection management
function selectEvent(id: number | null): void {
  selectedEventId = id;
}

function getSelectedEventId(): number | null {
  return selectedEventId;
}

function getSelectedEvent(): Event | null {
  if (selectedEventId === null) return null;
  return events.find((e) => e.id === selectedEventId) || null;
}

// Handle incoming event message from WebSocket
function handleEventMessage(message: ServerMessage): void {
  const event = message.event as Event;
  if (event) {
    const added = addEvent(event);
    if (added) {
      console.log(
        `[events] Added event ${event.id}: ${event.event_type} - ${event.message?.slice(0, 50)}`,
      );
      // Update session last event time for staleness tracking
      if (event.session_id) {
        sessionsStore.updateSessionLastEventTime(
          event.session_id,
          event.timestamp,
        );
      }
    }
  }
}

// Load events for a specific session (on-demand when session selected)
async function loadEventsForSession(sessionId: string): Promise<void> {
  console.log(
    `[events] Loading events for session ${sessionId.slice(0, 8)}...`,
  );

  try {
    const response = await fetch(`/events?session_id=${sessionId}`);

    if (!response.ok) {
      console.warn(
        `[events] Failed to fetch session events: ${response.status}`,
      );
      return;
    }

    const data = await response.json();
    const eventList: Event[] = data.events || [];

    // Add events with deduplication
    const reversed = [...eventList].reverse();
    for (const event of reversed) {
      if (!knownEventIds.has(event.id)) {
        knownEventIds.add(event.id);
        events = [event, ...events];
      }
    }
    eventCount = events.length;

    // Update session's last event time from newest event
    if (eventList.length > 0) {
      const newest = eventList[0]; // API returns newest first
      sessionsStore.updateSessionLastEventTime(sessionId, newest.timestamp);
    }

    console.log(
      `[events] Loaded ${eventList.length} events for session ${sessionId.slice(0, 8)}`,
    );
  } catch (err) {
    console.error("[events] Error loading session events:", err);
  }
}

// Load events for a specific agent (on-demand when agent selected)
async function loadEventsForAgent(agentId: string): Promise<void> {
  console.log(`[events] Loading events for agent ${agentId.slice(0, 7)}...`);

  try {
    const response = await fetch(`/events?agent_id=${agentId}&limit=500`);

    if (!response.ok) {
      console.warn(`[events] Failed to fetch agent events: ${response.status}`);
      return;
    }

    const data = await response.json();
    const eventList: Event[] = data.events || [];

    // Add events with deduplication
    const reversed = [...eventList].reverse();
    for (const event of reversed) {
      if (!knownEventIds.has(event.id)) {
        knownEventIds.add(event.id);
        events = [event, ...events];
      }
    }
    eventCount = events.length;

    console.log(
      `[events] Loaded ${eventList.length} events for agent ${agentId.slice(0, 7)}`,
    );
  } catch (err) {
    console.error("[events] Error loading agent events:", err);
  }
}

// Load initial events from REST API (last hour by default)
async function loadInitialEvents(): Promise<void> {
  console.log("[events] Loading initial events from REST API...");

  try {
    // Fetch recent events (last hour)
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const response = await fetch(`/events?since=${since}&limit=500`);

    if (!response.ok) {
      console.warn(`[events] Failed to fetch events: ${response.status}`);
      return;
    }

    const data = await response.json();
    const eventList: Event[] = data.events || [];

    // Add events (oldest first so newest ends up at top)
    // Track latest event per session for staleness detection
    const latestBySession: Record<string, string> = {};
    const reversed = [...eventList].reverse();
    for (const event of reversed) {
      if (!knownEventIds.has(event.id)) {
        knownEventIds.add(event.id);
        events = [event, ...events];
      }
      // Track newest event per session
      if (event.session_id) {
        if (
          !latestBySession[event.session_id] ||
          event.timestamp > latestBySession[event.session_id]
        ) {
          latestBySession[event.session_id] = event.timestamp;
        }
      }
    }
    eventCount = events.length;

    // Update session last event times
    for (const [sessionId, timestamp] of Object.entries(latestBySession)) {
      sessionsStore.updateSessionLastEventTime(sessionId, timestamp);
    }

    console.log(`[events] Loaded ${eventList.length} events from last hour`);
  } catch (err) {
    console.error("[events] Error loading initial events:", err);
  }
}

// Initialize WebSocket handler registration
function initializeHandlers(): () => void {
  const unsubscribe = websocket.onMessage("event", handleEventMessage);
  console.log("[events] Registered WebSocket handler for 'event' messages");
  return unsubscribe;
}

// Export store interface
export const eventsStore = {
  getEvents,
  getEventCount,
  addEvent,
  addEvents,
  clearEvents,
  selectEvent,
  getSelectedEventId,
  getSelectedEvent,
  initializeHandlers,
  loadInitialEvents,
  loadEventsForSession,
  loadEventsForAgent,
};

export default eventsStore;
