<script lang="ts">
  import { Search } from 'lucide-svelte';
  import filtersStore, { type TimeRange } from '../stores/filters.svelte';

  // Local state synced from store
  let source = $state('all');
  let project = $state('all');
  let eventType = $state('all');
  let search = $state('');
  let timeRange = $state<TimeRange>('1h');

  // Available options for dropdowns
  let sources: string[] = $state([]);
  let projects: string[] = $state([]);
  let types: string[] = $state([]);

  // Poll store for current values and options
  $effect(() => {
    const interval = setInterval(() => {
      source = filtersStore.getSource();
      project = filtersStore.getProject();
      eventType = filtersStore.getEventType();
      search = filtersStore.getSearch();
      timeRange = filtersStore.getTimeRange();

      const unique = filtersStore.getUniqueValues();
      sources = unique.sources;
      projects = unique.projects;
      types = unique.types;
    }, 100);
    return () => clearInterval(interval);
  });

  // Handlers
  function handleSourceChange(e: Event): void {
    const target = e.target as HTMLSelectElement;
    filtersStore.setSource(target.value);
  }

  function handleProjectChange(e: Event): void {
    const target = e.target as HTMLSelectElement;
    filtersStore.setProject(target.value);
  }

  function handleTypeChange(e: Event): void {
    const target = e.target as HTMLSelectElement;
    filtersStore.setEventType(target.value);
  }

  function handleSearchInput(e: Event): void {
    const target = e.target as HTMLInputElement;
    filtersStore.setSearch(target.value);
  }

  function handleTimeRange(range: TimeRange): void {
    filtersStore.setTimeRange(range);
  }
</script>

<div class="filter-bar">
  <select class="filter-select" value={source} onchange={handleSourceChange}>
    <option value="all">source: all</option>
    {#each sources as s}
      <option value={s}>source: {s}</option>
    {/each}
  </select>

  <select class="filter-select" value={project} onchange={handleProjectChange}>
    <option value="all">project: all</option>
    {#each projects as p}
      <option value={p}>project: {p}</option>
    {/each}
  </select>

  <select class="filter-select" value={eventType} onchange={handleTypeChange}>
    <option value="all">type: all</option>
    {#each types as t}
      <option value={t}>type: {t}</option>
    {/each}
  </select>

  <div class="search-wrapper">
    <Search size={14} class="search-icon" />
    <input
      type="text"
      class="filter-search"
      placeholder="search events..."
      value={search}
      oninput={handleSearchInput}
    />
  </div>

  <div class="time-range-btns">
    <button
      class="time-btn"
      class:active={timeRange === '1h'}
      onclick={() => handleTimeRange('1h')}
    >1h</button>
    <button
      class="time-btn"
      class:active={timeRange === '24h'}
      onclick={() => handleTimeRange('24h')}
    >24h</button>
    <button
      class="time-btn"
      class:active={timeRange === '7d'}
      onclick={() => handleTimeRange('7d')}
    >7d</button>
    <button
      class="time-btn"
      class:active={timeRange === 'all'}
      onclick={() => handleTimeRange('all')}
    >all</button>
  </div>
</div>

<style>
  .filter-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--vw-border);
    flex-shrink: 0;
  }

  .filter-select {
    padding: 0.5rem 0.75rem;
    background: var(--vw-bg-elevated);
    border: 1px solid var(--vw-border);
    border-radius: 4px;
    color: var(--vw-text);
    font-size: var(--text-sm);
    text-transform: lowercase;
    cursor: pointer;
    transition: border-color var(--transition-fast);
  }

  .filter-select:hover {
    border-color: var(--vw-border-bright);
  }

  .filter-select:focus {
    border-color: var(--vw-cyan);
    outline: none;
  }

  .search-wrapper {
    flex: 1;
    position: relative;
    display: flex;
    align-items: center;
  }

  .search-wrapper :global(.search-icon) {
    position: absolute;
    left: 0.75rem;
    color: var(--vw-gray);
    pointer-events: none;
  }

  .filter-search {
    flex: 1;
    padding: 0.5rem 0.75rem 0.5rem 2rem;
    background: var(--vw-bg-elevated);
    border: 1px solid var(--vw-border);
    border-radius: 4px;
    color: var(--vw-text);
    font-size: var(--text-sm);
    transition: border-color var(--transition-fast);
  }

  .filter-search:hover {
    border-color: var(--vw-border-bright);
  }

  .filter-search:focus {
    border-color: var(--vw-cyan);
    outline: none;
  }

  .filter-search::placeholder {
    color: var(--vw-gray);
    text-transform: lowercase;
  }

  .time-range-btns {
    display: flex;
    gap: 0;
  }

  .time-btn {
    padding: 0.5rem 0.75rem;
    background: var(--vw-bg-elevated);
    border: 1px solid var(--vw-border);
    color: var(--vw-gray);
    font-size: var(--text-sm);
    text-transform: lowercase;
    cursor: pointer;
    margin-left: -1px;
    transition: border-color var(--transition-fast), background var(--transition-fast);
  }

  .time-btn:first-child {
    margin-left: 0;
    border-radius: 4px 0 0 4px;
  }

  .time-btn:last-child {
    border-radius: 0 4px 4px 0;
  }

  .time-btn.active {
    background: var(--vw-cyan-bg);
    border-color: var(--vw-cyan);
    color: var(--vw-cyan);
    z-index: 1;
  }

  .time-btn:hover:not(.active) {
    border-color: var(--vw-border-bright);
    background: var(--vw-bg-card);
  }
</style>
