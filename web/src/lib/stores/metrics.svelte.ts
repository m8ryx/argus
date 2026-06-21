/**
 * Metrics store for Argus dashboard
 *
 * Derives metrics from events and sessions stores with rolling window calculations.
 */

import eventsStore from "./events.svelte";
import sessionsStore from "./sessions.svelte";

// Metrics state interface
export interface Metrics {
  activeSessions: number;
  eventsPerMin: number;
  errorCount: number;
  avgLatency: string;
}

// Module-level state using Svelte 5 runes
let metrics: Metrics = $state({
  activeSessions: 0,
  eventsPerMin: 0,
  errorCount: 0,
  avgLatency: "—",
});

// Calculate events per minute using 60-second rolling window
function calculateEventsPerMin(): number {
  const events = eventsStore.getEvents();
  const now = Date.now();
  const oneMinuteAgo = now - 60_000;

  const recentEvents = events.filter((event) => {
    const eventTime = new Date(event.timestamp).getTime();
    return eventTime >= oneMinuteAgo;
  });

  return recentEvents.length;
}

// Count error events
function calculateErrorCount(): number {
  const events = eventsStore.getEvents();

  return events.filter((event) => {
    const status = event.status?.toLowerCase() || "";
    return status === "error" || status === "failed" || status === "failure";
  }).length;
}

// Count active sessions - prefer sessions store, fall back to unique session_ids from events
function calculateActiveSessions(): number {
  const sessions = sessionsStore.getSessions();
  const activeSessions = sessions.filter((s) => s.status === "active");

  // If sessions store has data, use it
  if (activeSessions.length > 0) {
    return activeSessions.length;
  }

  // Fall back: count unique session_ids from events
  const events = eventsStore.getEvents();
  const uniqueSessionIds = new Set<string>();
  for (const event of events) {
    if (event.session_id) {
      uniqueSessionIds.add(event.session_id);
    }
  }
  return uniqueSessionIds.size;
}

// Update all metrics from source stores
function updateMetrics(): void {
  metrics = {
    activeSessions: calculateActiveSessions(),
    eventsPerMin: calculateEventsPerMin(),
    errorCount: calculateErrorCount(),
    avgLatency: "—", // Placeholder - no latency data in current schema
  };
}

// Get current metrics (reactive getter)
function getMetrics(): Metrics {
  return metrics;
}

// Get individual metric values
function getActiveSessions(): number {
  return metrics.activeSessions;
}

function getEventsPerMin(): number {
  return metrics.eventsPerMin;
}

function getErrorCount(): number {
  return metrics.errorCount;
}

function getAvgLatency(): string {
  return metrics.avgLatency;
}

// Export store interface
export const metricsStore = {
  getMetrics,
  getActiveSessions,
  getEventsPerMin,
  getErrorCount,
  getAvgLatency,
  updateMetrics,
};

export default metricsStore;
