<script lang="ts">
  import type { Event } from '../stores/events.svelte';

  type EventType = Event['event_type'];

  interface Props {
    type: EventType | string;
  }

  let { type }: Props = $props();

  const validTypes = ['tool', 'agent', 'session', 'response', 'prompt'] as const;

  function getTypeClass(t: string): string {
    return validTypes.includes(t as EventType) ? t : 'unknown';
  }
</script>

<span class="type-badge {getTypeClass(type)}">{type}</span>

<style>
  .type-badge {
    padding: 0.125rem 0.375rem;
    border-radius: 3px;
    font-size: var(--text-xs);
    text-transform: lowercase;
  }

  .type-badge.tool {
    background: var(--vw-cyan-bg);
    color: var(--vw-cyan);
  }

  .type-badge.agent {
    background: var(--vw-vibrant-purple-bg);
    color: var(--vw-vibrant-purple);
  }

  .type-badge.session {
    background: var(--vw-purple-bg);
    color: var(--vw-purple);
  }

  .type-badge.response {
    background: var(--vw-success-bg);
    color: var(--vw-success);
  }

  .type-badge.prompt {
    background: var(--vw-warning-bg);
    color: var(--vw-warning);
  }

  .type-badge.unknown {
    background: var(--vw-bg-elevated);
    color: var(--vw-gray);
    border: 1px solid var(--vw-border);
  }
</style>
