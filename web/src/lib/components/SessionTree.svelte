<script lang="ts">
  import { ChevronRight, ChevronDown, Eye, EyeOff, X, Clock } from 'lucide-svelte';
  import sessionsStore, { type Session, type Agent } from '../stores/sessions.svelte';
  import eventsStore from '../stores/events.svelte';

  // Track expanded state per node
  let expandedNodes: Set<string> = $state(new Set());

  // Show ended sessions toggle (default: hide ended)
  let showEnded: boolean = $state(false);

  // Reactive data from store
  let allSessions: Session[] = $state([]);
  let hierarchy: { rootAgents: Agent[]; childrenMap: Record<string, Agent[]> } = $state({ rootAgents: [], childrenMap: {} });
  let selectedSessionId: string | null = $state(null);
  let selectedAgentId: string | null = $state(null);

  // Filtered sessions based on showEnded toggle
  let sessions: Session[] = $derived(
    showEnded
      ? allSessions
      : allSessions.filter(s => s.status === 'active')
  );

  // Poll store for updates (including hierarchy rebuild)
  $effect(() => {
    const interval = setInterval(() => {
      allSessions = sessionsStore.getSessions();
      selectedSessionId = sessionsStore.getSelectedSessionId();
      selectedAgentId = sessionsStore.getSelectedAgentId();
      // Rebuild hierarchy for all agents so any session can be expanded
      hierarchy = sessionsStore.buildAgentHierarchy();
    }, 100);
    return () => clearInterval(interval);
  });

  function toggleExpand(id: string): void {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    expandedNodes = newExpanded;
  }

  function handleSessionClick(session: Session): void {
    // Toggle expand
    toggleExpand(`session-${session.id}`);
    // Select session
    sessionsStore.selectSession(session.id);
    // Load events for this session (fetches on-demand if not already loaded)
    eventsStore.loadEventsForSession(session.id);
  }

  function handleAgentClick(agent: Agent): void {
    // Toggle expand
    toggleExpand(`agent-${agent.id}`);
    // Select agent
    sessionsStore.selectAgent(agent.id);
    // Load events for this agent (fetches on-demand if not already loaded)
    eventsStore.loadEventsForAgent(agent.id);
  }

  function isExpanded(id: string): boolean {
    return expandedNodes.has(id);
  }

  function getAgentsForSession(sessionId: string): Agent[] {
    return sessionsStore.getAgentsForSession(sessionId);
  }

  function getChildAgents(agentId: string): Agent[] {
    return hierarchy.childrenMap[agentId] || [];
  }
</script>

{#snippet agentNode(agent: Agent, depth: number)}
  {@const children = getChildAgents(agent.id)}
  {@const hasKids = children.length > 0}
  {@const expanded = isExpanded(`agent-${agent.id}`)}
  {@const isSelected = selectedAgentId === agent.id}

  <div class="tree-item agent" class:selected={isSelected}>
    <button
      class="tree-row"
      onclick={() => handleAgentClick(agent)}
      style="padding-left: {(depth + 1) * 1.25}rem"
    >
      <span class="tree-toggle" class:has-children={hasKids}>
        {#if hasKids}
          {#if expanded}
            <ChevronDown size={14} />
          {:else}
            <ChevronRight size={14} />
          {/if}
        {/if}
      </span>
      <span class="status-dot {agent.status}"></span>
      <span class="tree-label">{agent.type || agent.name || 'agent'}</span>
      <span class="tree-meta">{agent.event_count || 0}</span>
    </button>
  </div>

  {#if expanded && hasKids}
    <div class="tree-children">
      {#each children as child (child.id)}
        {@render agentNode(child, depth + 1)}
      {/each}
    </div>
  {/if}
{/snippet}

<div class="session-tree">
  <div class="tree-controls">
    <label class="show-ended-toggle">
      <input type="checkbox" bind:checked={showEnded} />
      {#if showEnded}
        <Eye size={14} />
      {:else}
        <EyeOff size={14} />
      {/if}
      <span>show ended</span>
    </label>
    {#if selectedSessionId || selectedAgentId}
      <button class="clear-btn" onclick={() => { sessionsStore.selectSession(null); }}>
        <X size={12} />
        <span>clear</span>
      </button>
    {/if}
  </div>

  {#if sessions.length === 0}
    <p class="empty-message">{showEnded ? 'No sessions' : 'No active sessions'}</p>
  {:else}
    {#each sessions as session (session.id)}
      {@const agents = getAgentsForSession(session.id)}
      {@const hasAgents = agents.length > 0}
      {@const expanded = isExpanded(`session-${session.id}`)}
      {@const isSelected = selectedSessionId === session.id}

      <div class="tree-item session" class:selected={isSelected}>
        <button
          class="tree-row"
          onclick={() => handleSessionClick(session)}
        >
          <span class="tree-toggle" class:has-children={hasAgents}>
            {#if hasAgents}
              {#if expanded}
                <ChevronDown size={14} />
              {:else}
                <ChevronRight size={14} />
              {/if}
            {/if}
          </span>
          <span class="status-dot {session.status}"></span>
          <span class="tree-label">{session.id.slice(0, 8)}</span>
          {#if session.project}
            <span class="project-badge">{session.project}</span>
          {/if}
          <span class="tree-meta">{agents.length}</span>
          <span class="indicator clock" class:idle={session.is_idle}>
            <Clock size={14} />
          </span>
          <span
            class="indicator close"
            class:active={session.is_idle}
            onclick={(e) => { e.stopPropagation(); if (session.status === 'active') sessionsStore.closeSession(session.id); }}
            onkeydown={(e) => { if (e.key === 'Enter' && session.status === 'active') sessionsStore.closeSession(session.id); }}
            role="button"
            tabindex="0"
          >
            <X size={14} />
          </span>
        </button>
      </div>

      {#if expanded && hasAgents}
        <div class="tree-children">
          {#each hierarchy.rootAgents.filter(a => a.session_id === session.id) as agent (agent.id)}
            {@render agentNode(agent, 1)}
          {/each}
        </div>
      {/if}
    {/each}
  {/if}
</div>

<style>
  .session-tree {
    font-size: var(--text-sm);
  }

  .tree-controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid var(--vw-border);
  }

  .clear-btn {
    padding: 0.25rem 0.5rem;
    margin-right: 0.5rem;
    background: var(--vw-bg-elevated);
    border: 1px solid var(--vw-border);
    border-radius: 3px;
    color: var(--vw-cyan);
    font-size: var(--text-xs);
    cursor: pointer;
    text-transform: lowercase;
  }

  .clear-btn:hover {
    background: var(--vw-cyan-bg);
    border-color: var(--vw-cyan);
  }

  .show-ended-toggle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    color: var(--vw-gray);
    font-size: var(--text-xs);
    text-transform: lowercase;
    cursor: pointer;
  }

  .show-ended-toggle:hover {
    background: var(--vw-bg-elevated);
  }

  .show-ended-toggle input[type="checkbox"] {
    accent-color: var(--vw-cyan);
  }

  .empty-message {
    color: var(--vw-gray);
    text-align: center;
    padding: 2rem 1rem;
  }

  .tree-item {
    border-bottom: 1px solid var(--vw-border);
  }

  .tree-item.selected {
    background: var(--vw-bg-elevated);
  }

  .tree-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.5rem 0.75rem;
    background: none;
    border: none;
    color: var(--vw-text);
    cursor: pointer;
    text-align: left;
    transition: background var(--transition-fast);
  }

  .tree-row:hover {
    background: var(--vw-bg-elevated);
  }

  .tree-toggle {
    width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--vw-gray);
  }

  .tree-toggle:not(.has-children) {
    visibility: hidden;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .status-dot.active,
  .status-dot.running {
    background: var(--vw-success);
  }

  .status-dot.ended,
  .status-dot.completed {
    background: var(--vw-gray);
  }

  .status-dot.failed {
    background: var(--vw-danger);
  }

  .tree-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .project-badge {
    padding: 0.125rem 0.375rem;
    background: var(--vw-purple-bg);
    color: var(--vw-purple);
    border-radius: 3px;
    font-size: var(--text-xs);
  }

  .tree-meta {
    color: var(--vw-gray);
    font-size: var(--text-xs);
  }

  .tree-children {
    border-left: 1px solid var(--vw-border);
    margin-left: 1rem;
  }

  /* Indicator columns - always present */
  .indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--vw-dark-gray);
    flex-shrink: 0;
  }

  .indicator.clock.idle {
    color: var(--vw-warning);
  }

  .indicator.close.active {
    color: var(--vw-text);
    cursor: pointer;
  }

  .indicator.close.active:hover {
    color: var(--vw-danger);
  }
</style>
