<script lang="ts">
  import eventsStore, { type Event } from '../stores/events.svelte';
  import filtersStore from '../stores/filters.svelte';
  import TypeBadge from './TypeBadge.svelte';
  import StatusBadge from './StatusBadge.svelte';

  // Reactive data from stores
  let allEvents: Event[] = $state([]);
  let events: Event[] = $state([]);
  let selectedEventId: number | null = $state(null);
  let hasActiveFilters: boolean = $state(false);

  // Poll stores for updates - filters store handles all filtering
  $effect(() => {
    const interval = setInterval(() => {
      allEvents = eventsStore.getEvents();
      events = filtersStore.getFilteredEvents();
      selectedEventId = eventsStore.getSelectedEventId();
      hasActiveFilters = filtersStore.hasActiveFilters();
    }, 100);
    return () => clearInterval(interval);
  });

  function formatTime(timestamp: string): string {
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch {
      return '—';
    }
  }

  function truncateMessage(message: string | undefined, maxLength: number = 80): string {
    if (!message) return '—';
    if (message.length <= maxLength) return message;
    return message.slice(0, maxLength) + '...';
  }

  function getProject(event: Event): string {
    return (event.data?.project as string) || '—';
  }

  function handleRowClick(event: Event): void {
    eventsStore.selectEvent(event.id);
  }

  // Derive display status from hook and status fields
  function getEventStatus(event: Event): { status: string; isBackground: boolean } | null {
    const isBackground = event.is_background === true;

    // Agent events
    if (event.event_type === 'agent') {
      if (event.hook === 'PreToolUse') {
        return { status: 'pending', isBackground };
      }
      if (event.hook === 'SubagentActivated') {
        return { status: 'activated', isBackground };
      }
      if (event.hook === 'PostToolUse') {
        const status = event.status?.toLowerCase();
        if (status === 'error' || status === 'failed' || status === 'failure') {
          return { status: 'failed', isBackground };
        }
        return { status: 'completed', isBackground };
      }
      return null;
    }

    // Tool events
    if (event.event_type === 'tool') {
      if (event.hook === 'PreToolUse') {
        return { status: 'started', isBackground };
      }
      if (event.hook === 'PostToolUse') {
        const status = event.status?.toLowerCase();
        if (status === 'error' || status === 'failed' || status === 'failure') {
          return { status: 'failed', isBackground };
        }
        return { status: 'completed', isBackground };
      }
      return null;
    }

    return null;
  }

</script>

<div class="events-panel">
  <div class="events-header">
    <span class="events-count">
      {#if hasActiveFilters}
        {events.length} of {allEvents.length} events
      {:else}
        {events.length} events
      {/if}
    </span>
  </div>
  <table class="events-table">
    <thead>
      <tr>
        <th>Time</th>
        <th>Source</th>
        <th>Project</th>
        <th>Type</th>
        <th>Status</th>
        <th>Message</th>
      </tr>
    </thead>
    <tbody>
      {#if events.length === 0}
        <tr class="placeholder-row">
          <td colspan="6">Events will appear here</td>
        </tr>
      {:else}
        {#each events as event (event.id)}
          <tr
            class="event-row"
            class:selected={selectedEventId === event.id}
            onclick={() => handleRowClick(event)}
          >
            <td class="time-cell">{formatTime(event.timestamp)}</td>
            <td><span class="source-badge">{event.source}</span></td>
            <td>{getProject(event)}</td>
            <td><TypeBadge type={event.event_type} /></td>
            <td class="status-cell">
              {#if getEventStatus(event)}
                {@const eventStatus = getEventStatus(event)!}
                <StatusBadge status={eventStatus.status} showBackground={eventStatus.isBackground} />
              {:else}
                <span class="no-status">—</span>
              {/if}
            </td>
            <td class="message-cell">{truncateMessage(event.message)}</td>
          </tr>
        {/each}
      {/if}
    </tbody>
  </table>
</div>

<style>
  .events-panel {
    flex: 1;
    overflow: auto;
    display: flex;
    flex-direction: column;
  }

  .events-header {
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--vw-border);
    background: var(--vw-bg-elevated);
    flex-shrink: 0;
  }

  .events-count {
    font-size: var(--text-xs);
    color: var(--vw-gray);
    text-transform: lowercase;
  }

  .events-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }

  .events-table th {
    position: sticky;
    top: 0;
    background: var(--vw-bg-elevated);
    padding: 0.75rem 1rem;
    text-align: left;
    font-weight: 500;
    color: var(--vw-gray);
    text-transform: lowercase;
    font-size: var(--text-xs);
    letter-spacing: 0.05em;
    border-bottom: 1px solid var(--vw-border);
  }

  .events-table td {
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--vw-border);
    color: var(--vw-text);
  }

  .event-row {
    cursor: pointer;
    transition: background var(--transition-fast);
  }

  .event-row:hover {
    background: var(--vw-bg-elevated);
  }

  .event-row.selected {
    background: var(--vw-cyan-bg);
  }

  .placeholder-row td {
    text-align: center;
    color: var(--vw-gray);
    padding: 2rem;
  }

  .time-cell {
    font-family: var(--vw-font-mono);
    color: var(--vw-gray);
    white-space: nowrap;
  }

  .source-badge {
    padding: 0.125rem 0.375rem;
    background: var(--vw-bg-elevated);
    border: 1px solid var(--vw-border);
    border-radius: 3px;
    font-size: var(--text-xs);
  }

  .message-cell {
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status-cell {
    white-space: nowrap;
  }

  .no-status {
    color: var(--vw-gray);
  }
</style>
