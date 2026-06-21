/**
 * Timeline bucket store for Argus dashboard
 *
 * Aggregates events into 5-second buckets over a 10-minute rolling window
 * for visualization in the event density timeline.
 */

import eventsStore, { type Event } from "./events.svelte";

// Event types for bucketing
export type EventType = "tool" | "agent" | "session" | "response" | "prompt";

// Single time bucket
export interface TimeBucket {
  startTime: number; // Unix timestamp (ms)
  tool: number;
  agent: number;
  session: number;
  response: number;
  prompt: number;
  errors: number;
}

// Timeline configuration
const BUCKET_SIZE_MS = 5_000; // 5 seconds
const WINDOW_SIZE_MS = 10 * 60 * 1000; // 10 minutes
const MAX_BUCKETS = WINDOW_SIZE_MS / BUCKET_SIZE_MS; // 120 buckets

// Module-level state using Svelte 5 runes
let buckets: TimeBucket[] = $state([]);

// Create empty bucket for a given start time
function createEmptyBucket(startTime: number): TimeBucket {
  return {
    startTime,
    tool: 0,
    agent: 0,
    session: 0,
    response: 0,
    prompt: 0,
    errors: 0,
  };
}

// Check if event has error status
function isErrorEvent(event: Event): boolean {
  const status = event.status?.toLowerCase() || "";
  return status === "error" || status === "failed" || status === "failure";
}

// Calculate buckets from events within rolling window
function calculateBuckets(): TimeBucket[] {
  const events = eventsStore.getEvents();
  const now = Date.now();
  const windowStart = now - WINDOW_SIZE_MS;

  // Filter events within rolling window
  const windowEvents = events.filter((event) => {
    const eventTime = new Date(event.timestamp).getTime();
    return eventTime >= windowStart && eventTime <= now;
  });

  // If no events, return empty array
  if (windowEvents.length === 0) {
    return [];
  }

  // Create bucket map keyed by bucket start time
  const bucketMap = new Map<number, TimeBucket>();

  // Initialize buckets for entire window (ensures continuous timeline)
  const firstBucketStart =
    Math.floor(windowStart / BUCKET_SIZE_MS) * BUCKET_SIZE_MS;
  for (let time = firstBucketStart; time <= now; time += BUCKET_SIZE_MS) {
    bucketMap.set(time, createEmptyBucket(time));
  }

  // Distribute events into buckets
  for (const event of windowEvents) {
    const eventTime = new Date(event.timestamp).getTime();
    const bucketStart = Math.floor(eventTime / BUCKET_SIZE_MS) * BUCKET_SIZE_MS;

    let bucket = bucketMap.get(bucketStart);
    if (!bucket) {
      bucket = createEmptyBucket(bucketStart);
      bucketMap.set(bucketStart, bucket);
    }

    // Increment type count
    const eventType = event.event_type as EventType;
    if (eventType in bucket) {
      bucket[eventType]++;
    }

    // Track errors
    if (isErrorEvent(event)) {
      bucket.errors++;
    }
  }

  // Convert to sorted array (oldest first)
  const sortedBuckets = Array.from(bucketMap.values()).sort(
    (a, b) => a.startTime - b.startTime,
  );

  // Limit to max buckets (trim oldest if needed)
  if (sortedBuckets.length > MAX_BUCKETS) {
    return sortedBuckets.slice(-MAX_BUCKETS);
  }

  return sortedBuckets;
}

// Update buckets from events store
function updateBuckets(): void {
  buckets = calculateBuckets();
}

// Get current buckets (reactive getter)
function getBuckets(): TimeBucket[] {
  return buckets;
}

// Get max event count across all buckets (for scaling)
function getMaxCount(): number {
  if (buckets.length === 0) return 0;

  return Math.max(
    ...buckets.map((b) => b.tool + b.agent + b.session + b.response + b.prompt),
  );
}

// Get total events in current window
function getTotalEvents(): number {
  return buckets.reduce(
    (sum, b) => sum + b.tool + b.agent + b.session + b.response + b.prompt,
    0,
  );
}

// Get total errors in current window
function getTotalErrors(): number {
  return buckets.reduce((sum, b) => sum + b.errors, 0);
}

// Export store interface
export const timelineStore = {
  getBuckets,
  getMaxCount,
  getTotalEvents,
  getTotalErrors,
  updateBuckets,
};

export default timelineStore;
