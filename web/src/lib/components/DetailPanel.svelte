<script lang="ts">
  import { X } from 'lucide-svelte';
  import eventsStore, { type Event } from '../stores/events.svelte';
  import TypeBadge from './TypeBadge.svelte';

  // Reactive data from stores
  let selectedEvent: Event | null = $state(null);

  // Poll stores for updates
  $effect(() => {
    const interval = setInterval(() => {
      selectedEvent = eventsStore.getSelectedEvent();
    }, 100);
    return () => clearInterval(interval);
  });

  function formatTimestamp(timestamp: string): string {
    try {
      const date = new Date(timestamp);
      return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
    } catch {
      return timestamp;
    }
  }

  function highlightJson(data: unknown): string {
    if (!data) return '';

    const json = JSON.stringify(data, null, 2);

    return json
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\\n/g, '\n')  // Convert escaped newlines to actual newlines
      .replace(/"([^"]+)":/g, '<span class="json-key">"$1"</span>:')
      .replace(/: "([^"]*)"/g, ': <span class="json-string">"$1"</span>')
      .replace(/: (\d+\.?\d*)/g, ': <span class="json-number">$1</span>')
      .replace(/: (true|false)/g, ': <span class="json-boolean">$1</span>')
      .replace(/: (null)/g, ': <span class="json-null">$1</span>');
  }

  function clearSelection(): void {
    eventsStore.selectEvent(null);
  }
</script>

<div class="detail-panel">
  {#if selectedEvent}
    <div class="detail-header">
      <h3>Event Detail</h3>
      <button class="close-btn" onclick={clearSelection}>
        <X size={16} />
      </button>
    </div>
    <div class="detail-content">
      <div class="detail-row">
        <span class="detail-label">ID</span>
        <span class="detail-value mono">{selectedEvent.id}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Source</span>
        <span class="detail-value">{selectedEvent.source}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Type</span>
        <TypeBadge type={selectedEvent.event_type} />
      </div>
      <div class="detail-row">
        <span class="detail-label">Timestamp</span>
        <span class="detail-value mono">{formatTimestamp(selectedEvent.timestamp)}</span>
      </div>
      {#if selectedEvent.session_id}
        <div class="detail-row">
          <span class="detail-label">Session</span>
          <span class="detail-value mono">{selectedEvent.session_id.slice(0, 8)}</span>
        </div>
      {/if}
      {#if selectedEvent.agent_id}
        <div class="detail-row">
          <span class="detail-label">Agent</span>
          <span class="detail-value mono">{selectedEvent.agent_id.slice(0, 8)}</span>
        </div>
      {/if}
      {#if selectedEvent.tool_name}
        <div class="detail-row">
          <span class="detail-label">Tool</span>
          <span class="detail-value">{selectedEvent.tool_name}</span>
        </div>
      {/if}
      {#if selectedEvent.message}
        <div class="detail-section">
          <span class="detail-label">Message</span>
          <p class="detail-message">{selectedEvent.message}</p>
        </div>
      {/if}
      {#if selectedEvent.data && Object.keys(selectedEvent.data).length > 0}
        <div class="detail-section">
          <span class="detail-label">Data</span>
          <pre class="detail-json">{@html highlightJson(selectedEvent.data)}</pre>
        </div>
      {/if}
    </div>
  {:else}
    <div class="detail-empty">
      <p>Select an event to view details</p>
    </div>
  {/if}
</div>

<style>
  .detail-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .detail-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--vw-border);
  }

  .detail-header h3 {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--vw-gray);
    text-transform: lowercase;
    letter-spacing: 0.05em;
    margin: 0;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--vw-gray);
    cursor: pointer;
    padding: 0.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: color var(--transition-fast), background var(--transition-fast);
  }

  .close-btn:hover {
    color: var(--vw-text);
    background: var(--vw-bg-elevated);
  }

  .detail-content {
    flex: 1;
    overflow: auto;
    padding: 1rem;
  }

  .detail-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--vw-gray);
    font-size: var(--text-sm);
  }

  .detail-row {
    display: flex;
    align-items: baseline;
    gap: 1rem;
    margin-bottom: 0.75rem;
  }

  .detail-label {
    font-size: var(--text-xs);
    color: var(--vw-gray);
    text-transform: lowercase;
    min-width: 80px;
  }

  .detail-value {
    font-size: var(--text-sm);
    color: var(--vw-text);
  }

  .detail-value.mono {
    font-family: var(--vw-font-mono);
  }

  .detail-section {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--vw-border);
  }

  .detail-section .detail-label {
    display: block;
    margin-bottom: 0.5rem;
  }

  .detail-message {
    font-size: var(--text-sm);
    color: var(--vw-text);
    line-height: 1.5;
    margin: 0;
  }

  .detail-json {
    font-family: var(--vw-font-mono);
    font-size: var(--text-xs);
    background: var(--vw-bg-deep);
    border: 1px solid var(--vw-border);
    border-radius: 4px;
    padding: 1rem;
    overflow: auto;
    max-height: 300px;
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
  }

  :global(.detail-json .json-key) {
    color: var(--vw-cyan);
  }

  :global(.detail-json .json-string) {
    color: var(--vw-success);
  }

  :global(.detail-json .json-number) {
    color: var(--vw-warning);
  }

  :global(.detail-json .json-boolean) {
    color: var(--vw-purple);
  }

  :global(.detail-json .json-null) {
    color: var(--vw-gray);
  }

</style>
