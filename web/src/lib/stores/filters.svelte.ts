/**
 * Filters store for Argus dashboard
 *
 * Manages filter state and provides filtered events derived from eventsStore.
 */

import eventsStore, { type Event } from "./events.svelte";
import sessionsStore from "./sessions.svelte";

// Time range presets in milliseconds
export type TimeRange = "1h" | "24h" | "7d" | "all";

const TIME_RANGES: Record<TimeRange, number | null> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  all: null,
};

// Filter state
let source: string = $state("all");
let project: string = $state("all");
let eventType: string = $state("all");
let search: string = $state("");
let timeRange: TimeRange = $state("1h");

// Setters
function setSource(value: string): void {
  source = value;
}

function setProject(value: string): void {
  project = value;
}

function setEventType(value: string): void {
  eventType = value;
}

function setSearch(value: string): void {
  search = value;
}

function setTimeRange(value: TimeRange): void {
  timeRange = value;
}

// Reset all filters
function resetFilters(): void {
  source = "all";
  project = "all";
  eventType = "all";
  search = "";
  timeRange = "1h";
  // Also clear session/agent selection
  sessionsStore.selectSession(null);
  sessionsStore.selectAgent(null);
}

// Getters
function getSource(): string {
  return source;
}

function getProject(): string {
  return project;
}

function getEventType(): string {
  return eventType;
}

function getSearch(): string {
  return search;
}

function getTimeRange(): TimeRange {
  return timeRange;
}

// Extract unique values from events for dropdown population
function getUniqueValues(): {
  sources: string[];
  projects: string[];
  types: string[];
} {
  const events = eventsStore.getEvents();

  const sourcesSet = new Set<string>();
  const projectsSet = new Set<string>();
  const typesSet = new Set<string>();

  for (const event of events) {
    if (event.source) sourcesSet.add(event.source);
    const proj = (event.data?.project as string) || "";
    if (proj) projectsSet.add(proj);
    if (event.event_type) typesSet.add(event.event_type);
  }

  return {
    sources: Array.from(sourcesSet).sort(),
    projects: Array.from(projectsSet).sort(),
    types: Array.from(typesSet).sort(),
  };
}

// Get filtered events applying all active filters
function getFilteredEvents(): Event[] {
  const allEvents = eventsStore.getEvents();
  const selectedSessionId = sessionsStore.getSelectedSessionId();
  const selectedAgentId = sessionsStore.getSelectedAgentId();

  // Calculate time threshold
  const rangeMs = TIME_RANGES[timeRange];
  const timeThreshold = rangeMs ? Date.now() - rangeMs : null;

  const searchLower = search.toLowerCase().trim();

  return allEvents.filter((event) => {
    // Session/agent filter (from tree selection)
    if (selectedAgentId && event.agent_id !== selectedAgentId) {
      return false;
    }
    if (
      selectedSessionId &&
      !selectedAgentId &&
      event.session_id !== selectedSessionId
    ) {
      return false;
    }

    // Source filter
    if (source !== "all" && event.source !== source) {
      return false;
    }

    // Project filter
    const eventProject = (event.data?.project as string) || "";
    if (project !== "all" && eventProject !== project) {
      return false;
    }

    // Type filter
    if (eventType !== "all" && event.event_type !== eventType) {
      return false;
    }

    // Time range filter
    if (timeThreshold) {
      const eventTime = new Date(event.timestamp).getTime();
      if (eventTime < timeThreshold) {
        return false;
      }
    }

    // Search filter (searches message and source)
    if (searchLower) {
      const message = (event.message || "").toLowerCase();
      const src = (event.source || "").toLowerCase();
      const toolName = (event.tool_name || "").toLowerCase();
      if (
        !message.includes(searchLower) &&
        !src.includes(searchLower) &&
        !toolName.includes(searchLower)
      ) {
        return false;
      }
    }

    return true;
  });
}

// Check if any filter is active (for UI indication)
function hasActiveFilters(): boolean {
  return (
    source !== "all" ||
    project !== "all" ||
    eventType !== "all" ||
    search !== "" ||
    timeRange !== "all" ||
    sessionsStore.getSelectedSessionId() !== null ||
    sessionsStore.getSelectedAgentId() !== null
  );
}

// Export store interface
export const filtersStore = {
  // Getters
  getSource,
  getProject,
  getEventType,
  getSearch,
  getTimeRange,
  getUniqueValues,
  getFilteredEvents,
  hasActiveFilters,
  // Setters
  setSource,
  setProject,
  setEventType,
  setSearch,
  setTimeRange,
  resetFilters,
};

export default filtersStore;
