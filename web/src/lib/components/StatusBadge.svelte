<script lang="ts">
  import { Layers } from 'lucide-svelte';

  type Status = 'started' | 'completed' | 'failed' | 'background' | 'pending' | 'activated' | 'abandoned';

  interface Props {
    status: Status | string;
    showBackground?: boolean;
  }

  let { status, showBackground = false }: Props = $props();

  const validStatuses = ['started', 'completed', 'failed', 'background', 'pending', 'activated', 'abandoned'] as const;

  function getStatusClass(s: string): string {
    return validStatuses.includes(s as Status) ? s : 'unknown';
  }
</script>

<span class="status-badge {getStatusClass(status)}">{status}</span>
{#if showBackground}
  <span class="bg-indicator"><Layers size={10} /></span>
{/if}

<style>
  .status-badge {
    padding: 0.125rem 0.375rem;
    border-radius: 3px;
    font-size: var(--text-xs);
    text-transform: lowercase;
  }

  .status-badge.started {
    background: var(--vw-warning-bg);
    color: var(--vw-warning);
  }

  .status-badge.completed {
    background: var(--vw-success-bg);
    color: var(--vw-success);
  }

  .status-badge.failed {
    background: var(--vw-danger-bg);
    color: var(--vw-danger);
  }

  .status-badge.background {
    background: var(--vw-bg-elevated);
    color: var(--vw-gray);
    border: 1px solid var(--vw-border);
  }

  .status-badge.pending {
    background: var(--vw-bg-elevated);
    color: var(--vw-gray);
    border: 1px solid var(--vw-border);
  }

  .status-badge.activated {
    background: var(--vw-cyan-bg);
    color: var(--vw-cyan);
  }

  .status-badge.abandoned {
    background: var(--vw-warning-bg);
    color: var(--vw-warning);
  }

  .status-badge.unknown {
    background: var(--vw-bg-elevated);
    color: var(--vw-gray);
    border: 1px solid var(--vw-border);
  }

  .bg-indicator {
    margin-left: 0.25rem;
    padding: 0.125rem 0.25rem;
    background: var(--vw-bg-elevated);
    color: var(--vw-gray);
    border: 1px solid var(--vw-border);
    border-radius: 3px;
    font-size: var(--text-xs);
    text-transform: lowercase;
  }
</style>
