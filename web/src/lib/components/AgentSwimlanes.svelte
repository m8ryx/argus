<script lang="ts">
  import { onMount } from 'svelte';
  import sessionsStore, { type Agent } from '../stores/sessions.svelte';

  // Canvas element references
  let canvas: HTMLCanvasElement;
  let container: HTMLDivElement;
  let containerWidth: number = $state(0);
  let containerHeight: number = $state(0);

  // Reactive data from store
  let agents: Agent[] = $state([]);

  // Time window configuration (10 minutes)
  const WINDOW_MS = 10 * 60 * 1000;

  // Agent type colours (matching Voidwire palette)
  const TYPE_COLORS: Record<string, string> = {
    'Explore': '#00D9FF',           // cyan
    'code-reviewer': '#9F4DFF',     // vibrant-purple
    'general-purpose': '#E6CCFF',   // purple
    'claude-code-guide': '#4a9e6b', // success
    'default': '#666666',           // gray
  };

  // Get colour for agent type
  function getAgentColor(agent: Agent): string {
    const type = agent.type || agent.name || 'default';
    return TYPE_COLORS[type] || TYPE_COLORS['default'];
  }

  // Setup resize observer on mount
  onMount(() => {
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        containerWidth = entry.contentRect.width;
        containerHeight = entry.contentRect.height;
        updateCanvasSize();
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  });

  // Poll store for updates
  $effect(() => {
    const interval = setInterval(() => {
      agents = sessionsStore.getAgents();
    }, 100);
    return () => clearInterval(interval);
  });

  // Redraw canvas when data or size changes
  $effect(() => {
    if (canvas && containerWidth > 0 && containerHeight > 0) {
      drawSwimlanes();
    }
  });

  // Filter agents to those active within the time window
  function getVisibleAgents(): Agent[] {
    const now = Date.now();
    const windowStart = now - WINDOW_MS;

    return agents.filter(agent => {
      const startTime = new Date(agent.created_at).getTime();
      const endTime = agent.completed_at
        ? new Date(agent.completed_at).getTime()
        : now;

      // Agent is visible if it overlaps with the window
      return endTime >= windowStart && startTime <= now;
    }).sort((a, b) => {
      // Sort by start time (oldest first)
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
  }

  function drawSwimlanes(): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = containerWidth;
    const height = containerHeight;
    const dpr = window.devicePixelRatio || 1;

    // Clear canvas
    ctx.clearRect(0, 0, width * dpr, height * dpr);
    ctx.save();
    ctx.scale(dpr, dpr);

    const padding = { top: 10, right: 20, bottom: 25, left: 120 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    const now = Date.now();
    const windowStart = now - WINDOW_MS;

    const visibleAgents = getVisibleAgents();

    // If no agents, show placeholder
    if (visibleAgents.length === 0) {
      ctx.fillStyle = 'rgba(128, 128, 128, 0.5)';
      ctx.font = '12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No active agents in window', width / 2, height / 2);
      ctx.restore();
      return;
    }

    // Calculate row height based on number of agents
    const maxRows = Math.min(visibleAgents.length, 8); // Limit to 8 rows
    const rowHeight = Math.min(chartHeight / maxRows, 30);
    const barHeight = rowHeight * 0.7;
    const barGap = (rowHeight - barHeight) / 2;

    // Draw subtle grid lines
    ctx.strokeStyle = 'rgba(51, 51, 51, 0.5)';
    ctx.lineWidth = 1;

    // Vertical grid lines (every 2 minutes)
    for (let i = 0; i <= 5; i++) {
      const x = padding.left + (i / 5) * chartWidth;
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, padding.top + chartHeight);
      ctx.stroke();
    }

    // Draw agent bars
    visibleAgents.slice(0, maxRows).forEach((agent, index) => {
      const y = padding.top + index * rowHeight + barGap;

      const startTime = new Date(agent.created_at).getTime();
      const endTime = agent.completed_at
        ? new Date(agent.completed_at).getTime()
        : now;

      // Calculate bar position (clamp to window)
      const barStartTime = Math.max(startTime, windowStart);
      const barEndTime = Math.min(endTime, now);

      const xStart = padding.left + ((barStartTime - windowStart) / WINDOW_MS) * chartWidth;
      const xEnd = padding.left + ((barEndTime - windowStart) / WINDOW_MS) * chartWidth;
      const barWidth = Math.max(xEnd - xStart, 4); // Minimum width of 4px

      // Draw bar background (for running agents)
      const color = getAgentColor(agent);
      ctx.fillStyle = agent.status === 'running'
        ? color
        : color.replace(')', ', 0.6)').replace('rgb', 'rgba').replace('#', '');

      // Convert hex to rgba for completed agents
      if (agent.status !== 'running') {
        ctx.fillStyle = hexToRgba(color, 0.6);
      } else {
        ctx.fillStyle = color;
      }

      // Draw rounded rectangle
      const radius = 4;
      ctx.beginPath();
      ctx.roundRect(xStart, y, barWidth, barHeight, radius);
      ctx.fill();

      // Draw agent type label on left
      ctx.fillStyle = '#BBBBBB';
      ctx.font = '11px Inter, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const label = (agent.name || agent.type || agent.id.slice(0, 7)).slice(0, 14);
      ctx.fillText(label, padding.left - 8, y + barHeight / 2);

      // Draw status indicator for running agents
      if (agent.status === 'running') {
        // Pulsing dot at end of bar
        ctx.fillStyle = '#00D9FF';
        ctx.beginPath();
        ctx.arc(xEnd - 2, y + barHeight / 2, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // Draw "Now" indicator
    ctx.strokeStyle = 'rgba(0, 217, 255, 0.5)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padding.left + chartWidth, padding.top);
    ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw time labels
    ctx.fillStyle = 'rgba(128, 128, 128, 0.8)';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';

    for (let i = 0; i <= 5; i++) {
      const time = new Date(windowStart + (i / 5) * WINDOW_MS);
      const label = time.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit'
      });
      const x = padding.left + (i / 5) * chartWidth;
      ctx.fillText(label, x, height - 5);
    }

    // Draw "Now" label
    ctx.fillStyle = '#00D9FF';
    ctx.textAlign = 'right';
    ctx.fillText('now', width - 5, padding.top + 10);

    ctx.restore();
  }

  // Helper to convert hex to rgba
  function hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // Update canvas size for high-DPI displays
  function updateCanvasSize(): void {
    if (!canvas || containerWidth <= 0 || containerHeight <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = containerWidth * dpr;
    canvas.height = containerHeight * dpr;
    canvas.style.width = `${containerWidth}px`;
    canvas.style.height = `${containerHeight}px`;

    drawSwimlanes();
  }
</script>

<div class="swimlanes-container" bind:this={container}>
  <div class="swimlanes-header">active agents</div>
  <div class="swimlanes-canvas-wrapper">
    <canvas bind:this={canvas}></canvas>
  </div>
</div>

<style>
  .swimlanes-container {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--vw-bg-card);
    border-bottom: 1px solid var(--vw-border);
  }

  .swimlanes-header {
    padding: 0.5rem 1rem;
    font-size: var(--text-xs);
    color: var(--vw-gray);
    text-transform: lowercase;
    letter-spacing: 0.05em;
    border-bottom: 1px solid var(--vw-border);
    flex-shrink: 0;
  }

  .swimlanes-canvas-wrapper {
    flex: 1;
    padding: 0.5rem;
    min-height: 0;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
