<script lang="ts">
  import { onMount } from 'svelte';
  import sessionsStore, { type Agent } from '../stores/sessions.svelte';
  import timelineStore, { type TimeBucket } from '../stores/timeline.svelte';

  // Canvas element references
  let canvas: HTMLCanvasElement;
  let container: HTMLDivElement;
  let containerWidth: number = $state(0);
  let containerHeight: number = $state(0);

  // Data from stores
  let agents: Agent[] = $state([]);
  let buckets: TimeBucket[] = $state([]);
  let maxCount: number = $state(0);

  // Hover state
  let mouseX: number | null = $state(null);
  let mouseY: number | null = $state(null);
  let hoveredBucketIndex: number | null = $state(null);
  let hoveredAgent: Agent | null = $state(null);

  // Tooltip positioning constants
  const TOOLTIP_MARGIN = 8; // Minimum margin from edges

  // Store agent bar positions for hit detection
  let agentBars: Array<{ agent: Agent; x: number; y: number; width: number; height: number }> = [];

  // Separate time windows for each section
  const SWIMLANE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes for agent lifecycles
  const DENSITY_WINDOW_MS = 5 * 60 * 1000;   // 5 minutes for event density

  // Layout proportions - swimlanes get more space, density is compact
  const SWIMLANE_RATIO = 0.65;
  const DENSITY_RATIO = 0.35;

  // Small margins to match other dashboard cards
  const PADDING = { top: 24, right: 8, bottom: 30, left: 8 };

  // Agent type colors (solid fills, no patterns)
  const AGENT_COLORS: Record<string, string> = {
    'Explore': '#00D9FF',
    'code-reviewer': '#9F4DFF',
    'general-purpose': '#E6CCFF',
    'claude-code-guide': '#4a9e6b',
    'default': '#666666',
  };

  // Event type colors for density chart (solid colors for gradient creation)
  const TYPE_COLORS = {
    tool: '#00D9FF',
    agent: '#9F4DFF',
    session: '#E6CCFF',
    response: '#4a9e6b',
    prompt: '#a68a4d',
  };

  const STACK_ORDER: (keyof typeof TYPE_COLORS)[] = ['tool', 'agent', 'session', 'response', 'prompt'];

  // Build smooth bezier path using Catmull-Rom spline
  function buildSmoothPath(
    ctx: CanvasRenderingContext2D,
    points: { x: number; y: number }[],
    tension: number = 0.3
  ): void {
    if (points.length < 2) return;

    ctx.moveTo(points[0].x, points[0].y);

    if (points.length === 2) {
      ctx.lineTo(points[1].x, points[1].y);
      return;
    }

    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];

      const cp1x = p1.x + ((p2.x - p0.x) * tension) / 3;
      const cp1y = p1.y + ((p2.y - p0.y) * tension) / 3;
      const cp2x = p2.x - ((p3.x - p1.x) * tension) / 3;
      const cp2y = p2.y - ((p3.y - p1.y) * tension) / 3;

      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
  }

  // Create vertical gradient for a color (matching mockup style)
  // Gradient holds solid at top, then fades
  function createGradient(
    ctx: CanvasRenderingContext2D,
    color: string,
    top: number,
    bottom: number
  ): CanvasGradient {
    const gradient = ctx.createLinearGradient(0, top, 0, bottom);
    gradient.addColorStop(0, hexToRgba(color, 0.6));
    gradient.addColorStop(0.2, hexToRgba(color, 0.6));  // Hold solid until 20%
    gradient.addColorStop(0.5, hexToRgba(color, 0.25));
    gradient.addColorStop(1, hexToRgba(color, 0));
    return gradient;
  }

  // Setup resize observer
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

  // Poll stores for updates
  $effect(() => {
    const interval = setInterval(() => {
      agents = sessionsStore.getAgents();
      timelineStore.updateBuckets();
      buckets = timelineStore.getBuckets();
      maxCount = timelineStore.getMaxCount();
    }, 100);
    return () => clearInterval(interval);
  });

  // Redraw on data/size changes
  $effect(() => {
    if (canvas && containerWidth > 0 && containerHeight > 0) {
      draw();
    }
  });

  // Calculate agent end time based on status and completed_at
  function getAgentEndTime(agent: Agent, now: number): number {
    if (agent.completed_at) {
      return new Date(agent.completed_at).getTime();
    } else if (agent.status === 'running') {
      return now;
    } else {
      // Completed/failed without timestamp - estimate 2-minute duration
      return new Date(agent.created_at).getTime() + (2 * 60 * 1000);
    }
  }

  // Filter agents to those active within swimlane time window
  function getVisibleAgents(): Agent[] {
    const now = Date.now();
    const windowStart = now - SWIMLANE_WINDOW_MS;

    return agents.filter(agent => {
      if (!agent.created_at) return false;

      const startTime = new Date(agent.created_at).getTime();
      const endTime = getAgentEndTime(agent, now);

      // Only show if agent overlaps with visible window
      return endTime >= windowStart && startTime <= now;
    }).sort((a, b) => {
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
  }

  function handleMouseMove(event: MouseEvent): void {
    const rect = canvas.getBoundingClientRect();
    mouseX = event.clientX - rect.left;
    mouseY = event.clientY - rect.top;

    // Check for agent bar hover
    hoveredAgent = null;
    for (const bar of agentBars) {
      if (mouseX >= bar.x && mouseX <= bar.x + bar.width &&
          mouseY >= bar.y && mouseY <= bar.y + bar.height) {
        hoveredAgent = bar.agent;
        break;
      }
    }

    // Calculate hovered bucket for density section (only if not hovering agent)
    if (!hoveredAgent) {
      const chartWidth = containerWidth - PADDING.left - PADDING.right;
      const relativeX = mouseX - PADDING.left;

      if (relativeX >= 0 && relativeX <= chartWidth && buckets.length > 0) {
        const bucketWidth = chartWidth / buckets.length;
        const index = Math.floor(relativeX / bucketWidth);
        hoveredBucketIndex = Math.min(index, buckets.length - 1);
      } else {
        hoveredBucketIndex = null;
      }
    } else {
      hoveredBucketIndex = null;
    }

    draw();
  }

  function handleMouseLeave(): void {
    mouseX = null;
    mouseY = null;
    hoveredBucketIndex = null;
    hoveredAgent = null;
    draw();
  }

  function draw(): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = containerWidth;
    const height = containerHeight;

    ctx.clearRect(0, 0, width * dpr, height * dpr);
    ctx.save();
    ctx.scale(dpr, dpr);

    const chartWidth = width - PADDING.left - PADDING.right;
    const swimlaneHeight = (height - PADDING.top - PADDING.bottom) * SWIMLANE_RATIO;
    const densityHeight = (height - PADDING.top - PADDING.bottom) * DENSITY_RATIO;
    const swimlaneTop = PADDING.top;
    const densityTop = PADDING.top + swimlaneHeight;

    // Density chart area - space for label at top, waves go to bottom
    const densityLabelHeight = 20;
    const densityChartTop = densityTop + densityLabelHeight;
    const densityChartHeight = densityHeight - densityLabelHeight;
    const chartBottom = densityChartTop + densityChartHeight;

    const now = Date.now();
    const swimlaneWindowStart = now - SWIMLANE_WINDOW_MS;
    const densityWindowStart = now - DENSITY_WINDOW_MS;

    // Draw section labels with letter-spacing (0.1em at 10px = 1px)
    ctx.fillStyle = '#666666';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'left';
    drawSpacedText(ctx, 'ACTIVE AGENTS', PADDING.left, swimlaneTop - 2, 1);
    drawSpacedText(ctx, 'EVENT DENSITY', PADDING.left, densityTop + 12, 1);

    // Draw vertical grid lines for swimlane section (every minute over 10min = 10 lines)
    ctx.strokeStyle = 'rgba(51, 51, 51, 0.3)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i++) {
      // Draw all lines, every other one brighter
      if (i % 2 === 0) {
        ctx.strokeStyle = 'rgba(51, 51, 51, 0.5)';
      } else {
        ctx.strokeStyle = 'rgba(51, 51, 51, 0.25)';
      }
      const x = PADDING.left + (i / 10) * chartWidth;
      ctx.beginPath();
      ctx.moveTo(x, swimlaneTop);
      ctx.lineTo(x, swimlaneTop + swimlaneHeight);
      ctx.stroke();
    }

    // Draw vertical grid lines for density section (every 30 seconds over 5min = 10 lines)
    for (let i = 0; i <= 10; i++) {
      if (i % 2 === 0) {
        ctx.strokeStyle = 'rgba(51, 51, 51, 0.5)';
      } else {
        ctx.strokeStyle = 'rgba(51, 51, 51, 0.2)';
      }
      const x = PADDING.left + (i / 10) * chartWidth;
      ctx.beginPath();
      ctx.moveTo(x, densityChartTop);
      ctx.lineTo(x, chartBottom);
      ctx.stroke();
    }

    // Draw horizontal divider between sections
    ctx.strokeStyle = '#333333';
    ctx.beginPath();
    ctx.moveTo(PADDING.left, densityTop);
    ctx.lineTo(PADDING.left + chartWidth, densityTop);
    ctx.stroke();

    // === DRAW AGENT SWIMLANES ===
    const visibleAgents = getVisibleAgents();
    agentBars = []; // Reset bar positions for hit detection

    if (visibleAgents.length === 0) {
      ctx.fillStyle = 'rgba(128, 128, 128, 0.5)';
      ctx.font = '12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No agents in window', width / 2, swimlaneTop + swimlaneHeight / 2);
    } else {
      const maxRows = 8;
      const maxRowHeight = 28; // Max height per row so pills don't get huge
      const rowHeight = Math.min(swimlaneHeight / Math.min(visibleAgents.length, maxRows), maxRowHeight);
      const barHeight = rowHeight * 0.7;
      const barGap = (rowHeight - barHeight) / 2;

      visibleAgents.slice(0, maxRows).forEach((agent, index) => {
        const y = swimlaneTop + index * rowHeight + barGap;

        const startTime = new Date(agent.created_at).getTime();
        const endTime = getAgentEndTime(agent, now);

        // Calculate bar position within swimlane window
        const barStartTime = Math.max(startTime, swimlaneWindowStart);
        const barEndTime = Math.min(endTime, now);

        const xStart = PADDING.left + ((barStartTime - swimlaneWindowStart) / SWIMLANE_WINDOW_MS) * chartWidth;
        const xEnd = PADDING.left + ((barEndTime - swimlaneWindowStart) / SWIMLANE_WINDOW_MS) * chartWidth;
        const barWidth = Math.max(xEnd - xStart, 4);

        // Store bar position for hit detection
        agentBars.push({ agent, x: xStart, y, width: barWidth, height: barHeight });

        // Get color for this agent type
        const agentType = agent.type || agent.name || 'default';
        const color = AGENT_COLORS[agentType] || AGENT_COLORS['default'];

        // Highlight hovered agent
        const isHovered = hoveredAgent?.id === agent.id;

        // Draw solid bar with left accent
        drawAgentBar(ctx, xStart, y, barWidth, barHeight, color, agent.status === 'running', isHovered);

        // Draw agent label just left of where the bar starts
        ctx.fillStyle = isHovered ? '#FFFFFF' : '#BBBBBB';
        ctx.font = '11px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        const label = (agent.name || agent.type || agent.id.slice(0, 7));
        ctx.fillText(label, xStart - 8, y + barHeight / 2);
      });
    }

    // === DRAW EVENT DENSITY ===
    if (buckets.length === 0 || maxCount === 0) {
      ctx.fillStyle = 'rgba(128, 128, 128, 0.5)';
      ctx.font = '12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for events...', width / 2, densityTop + densityHeight / 2);
    } else {
      const bucketWidth = chartWidth / buckets.length;

      // Draw overlapping areas (NOT stacked) - each type from its value to baseline
      // Draw in reverse order so higher-priority types render on top
      const reversedOrder = [...STACK_ORDER].reverse();

      for (const type of reversedOrder) {
        // Build points for this type's values only (not cumulative)
        const points: { x: number; y: number }[] = [];
        for (let i = 0; i < buckets.length; i++) {
          const bucket = buckets[i];
          const x = PADDING.left + i * bucketWidth + bucketWidth / 2;
          const value = bucket[type];
          // Use square root scaling for better visibility of small values
          // Also ensure non-zero values have minimum 15% height
          let normalizedValue = value > 0
            ? Math.max(0.15, Math.sqrt(value) / Math.sqrt(maxCount))
            : 0;
          const y = chartBottom - normalizedValue * densityChartHeight;
          points.push({ x, y });
        }

        // Skip if no data for this type
        const hasData = points.some(p => p.y < chartBottom);
        if (!hasData) continue;

        // Fixed gradient from chart top to baseline (like SVG userSpaceOnUse)
        // This ensures consistent opacity at any y-coordinate regardless of peak height
        const gradient = createGradient(ctx, TYPE_COLORS[type], densityChartTop, chartBottom);

        // Draw gradient-filled area from line to baseline
        // Higher tension (0.5) for more dramatic curves like mockup
        ctx.fillStyle = gradient;
        ctx.beginPath();
        buildSmoothPath(ctx, points, 0.5);

        // Close path to baseline
        if (points.length > 0) {
          ctx.lineTo(points[points.length - 1].x, chartBottom);
          ctx.lineTo(points[0].x, chartBottom);
          ctx.closePath();
          ctx.fill();
        }

        // Draw crisp line on top
        ctx.strokeStyle = TYPE_COLORS[type];
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        buildSmoothPath(ctx, points, 0.5);
        ctx.stroke();
      }
    }

    // === DRAW HOVER LINE (only in the section mouse is over) ===
    if (mouseX !== null && mouseY !== null && mouseX >= PADDING.left && mouseX <= PADDING.left + chartWidth) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.setLineDash([2, 2]);
      ctx.beginPath();

      // Determine which section the mouse is in
      if (mouseY >= swimlaneTop && mouseY < densityTop) {
        // In swimlanes section
        ctx.moveTo(mouseX, swimlaneTop);
        ctx.lineTo(mouseX, densityTop);
      } else if (mouseY >= densityTop && mouseY <= height - PADDING.bottom) {
        // In density section
        ctx.moveTo(mouseX, densityTop);
        ctx.lineTo(mouseX, height - PADDING.bottom);
      }

      ctx.stroke();
      ctx.setLineDash([]);
    }

    // === DRAW SWIMLANE TIME AXIS (above divider) ===
    ctx.fillStyle = 'rgba(128, 128, 128, 0.6)';
    ctx.font = '9px "JetBrains Mono", monospace';

    // Swimlane: labels every minute (11 labels over 10 min)
    for (let i = 0; i <= 10; i++) {
      const time = new Date(swimlaneWindowStart + (i / 10) * SWIMLANE_WINDOW_MS);
      const label = time.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit'
      });
      const x = PADDING.left + (i / 10) * chartWidth;
      // Edge labels aligned to stay in bounds
      ctx.textAlign = i === 0 ? 'left' : i === 10 ? 'right' : 'center';
      ctx.fillText(label, x, densityTop - 4);
    }

    // === DRAW DENSITY TIME AXIS (bottom) ===
    ctx.fillStyle = 'rgba(128, 128, 128, 0.8)';
    ctx.font = '10px "JetBrains Mono", monospace';

    // Density: labels every minute (6 labels over 5 min) with seconds
    for (let i = 0; i <= 5; i++) {
      const time = new Date(densityWindowStart + (i / 5) * DENSITY_WINDOW_MS);
      const label = time.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      const x = PADDING.left + (i / 5) * chartWidth;
      // Edge labels aligned to stay in bounds
      ctx.textAlign = i === 0 ? 'left' : i === 5 ? 'right' : 'center';
      ctx.fillText(label, x, height - 8);
    }

    ctx.restore();
  }

  // Draw a solid agent bar with left accent border
  function drawAgentBar(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    color: string,
    isRunning: boolean,
    isHovered: boolean = false
  ): void {
    const radius = 4;
    const accentWidth = 2;

    // Draw muted fill
    ctx.fillStyle = hexToRgba(color, isRunning ? 0.18 : 0.12);
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.fill();

    // Draw left accent border
    ctx.fillStyle = hexToRgba(color, isRunning ? 0.7 : 0.5);
    ctx.beginPath();
    ctx.roundRect(x, y, accentWidth, height, [radius, 0, 0, radius]);
    ctx.fill();

    // Hover highlight border
    if (isHovered) {
      ctx.strokeStyle = hexToRgba(color, 0.8);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x, y, width, height, radius);
      ctx.stroke();
    }

    // Running indicator (pulsing dot)
    if (isRunning) {
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(x + width - 6, y + height / 2, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // Draw text with letter-spacing (canvas doesn't support it natively)
  function drawSpacedText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    spacing: number = 1
  ): void {
    let currentX = x;
    for (const char of text) {
      ctx.fillText(char, currentX, y);
      currentX += ctx.measureText(char).width + spacing;
    }
  }

  function updateCanvasSize(): void {
    if (!canvas || containerWidth <= 0 || containerHeight <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = containerWidth * dpr;
    canvas.height = containerHeight * dpr;
    canvas.style.width = `${containerWidth}px`;
    canvas.style.height = `${containerHeight}px`;

    draw();
  }

  // Tooltip data for density chart
  function getDensityTooltip(): { time: string; counts: string } | null {
    if (hoveredBucketIndex === null || hoveredBucketIndex >= buckets.length) return null;

    const bucket = buckets[hoveredBucketIndex];
    const time = new Date(bucket.startTime).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    const parts: string[] = [];
    if (bucket.tool > 0) parts.push(`tool: ${bucket.tool}`);
    if (bucket.agent > 0) parts.push(`agent: ${bucket.agent}`);
    if (bucket.session > 0) parts.push(`session: ${bucket.session}`);
    if (bucket.response > 0) parts.push(`response: ${bucket.response}`);
    if (bucket.prompt > 0) parts.push(`prompt: ${bucket.prompt}`);

    return {
      time,
      counts: parts.length > 0 ? parts.join(', ') : 'no events'
    };
  }

  // Tooltip data for agent bars
  function getAgentTooltip(): {
    type: string;
    status: string;
    duration: string;
    parent: string | null;
    events: number;
    id: string;
  } | null {
    if (!hoveredAgent) return null;

    const agent = hoveredAgent;
    const now = Date.now();
    const startTime = new Date(agent.created_at).getTime();
    const endTime = getAgentEndTime(agent, now);
    const durationMs = endTime - startTime;

    // Format duration
    let duration: string;
    if (durationMs < 60000) {
      duration = `${Math.round(durationMs / 1000)}s`;
    } else if (durationMs < 3600000) {
      const mins = Math.floor(durationMs / 60000);
      const secs = Math.round((durationMs % 60000) / 1000);
      duration = `${mins}m ${secs}s`;
    } else {
      const hours = Math.floor(durationMs / 3600000);
      const mins = Math.round((durationMs % 3600000) / 60000);
      duration = `${hours}h ${mins}m`;
    }

    // Find parent agent name if exists
    let parent: string | null = null;
    if (agent.parent_agent_id) {
      const parentAgent = agents.find(a => a.id === agent.parent_agent_id);
      parent = parentAgent ? (parentAgent.name || parentAgent.type || parentAgent.id.slice(0, 8)) : agent.parent_agent_id.slice(0, 8);
    }

    return {
      type: agent.name || agent.type || 'unknown',
      status: agent.status,
      duration,
      parent,
      events: agent.event_count || 0,
      id: agent.id.slice(0, 8)
    };
  }

  let densityTooltip = $derived(getDensityTooltip());
  let agentTooltip = $derived(getAgentTooltip());
</script>

<div class="combined-timeline" bind:this={container}>
  <canvas
    bind:this={canvas}
    onmousemove={handleMouseMove}
    onmouseleave={handleMouseLeave}
  ></canvas>

  {#if agentTooltip && mouseX !== null && mouseY !== null}
    {@const bar = agentBars.find(b => b.agent.id === hoveredAgent?.id)}
    {@const rawX = bar ? bar.x + bar.width / 2 : mouseX}
    {@const tooltipWidth = 160}
    {@const tooltipHeight = 120}
    {@const clampedX = Math.max(tooltipWidth / 2 + TOOLTIP_MARGIN, Math.min(rawX, containerWidth - tooltipWidth / 2 - TOOLTIP_MARGIN))}
    {@const belowY = bar ? bar.y + bar.height + 8 : mouseY + 20}
    {@const aboveY = bar ? bar.y - tooltipHeight - 8 : mouseY - tooltipHeight - 20}
    {@const wouldOverflowBottom = belowY + tooltipHeight > containerHeight - TOOLTIP_MARGIN}
    {@const tooltipY = wouldOverflowBottom ? Math.max(TOOLTIP_MARGIN, aboveY) : belowY}
    <div
      class="tooltip agent-tooltip"
      style="left: {clampedX}px; top: {tooltipY}px;"
    >
      <div class="tooltip-header">{agentTooltip.type}</div>
      <div class="tooltip-row">
        <span class="tooltip-label">status:</span>
        <span class="tooltip-value status-{agentTooltip.status}">{agentTooltip.status}</span>
      </div>
      <div class="tooltip-row">
        <span class="tooltip-label">duration:</span>
        <span class="tooltip-value">{agentTooltip.duration}</span>
      </div>
      {#if agentTooltip.parent}
        <div class="tooltip-row">
          <span class="tooltip-label">parent:</span>
          <span class="tooltip-value">{agentTooltip.parent}</span>
        </div>
      {/if}
      <div class="tooltip-row">
        <span class="tooltip-label">events:</span>
        <span class="tooltip-value">{agentTooltip.events}</span>
      </div>
      <div class="tooltip-id">{agentTooltip.id}</div>
    </div>
  {:else if densityTooltip && mouseX !== null && mouseY !== null}
    {@const tooltipWidth = 140}
    {@const tooltipHeight = 50}
    {@const clampedX = Math.max(tooltipWidth / 2 + TOOLTIP_MARGIN, Math.min(mouseX, containerWidth - tooltipWidth / 2 - TOOLTIP_MARGIN))}
    {@const belowY = mouseY + 20}
    {@const aboveY = mouseY - tooltipHeight - 20}
    {@const wouldOverflowBottom = belowY + tooltipHeight > containerHeight - TOOLTIP_MARGIN}
    {@const tooltipY = wouldOverflowBottom ? Math.max(TOOLTIP_MARGIN, aboveY) : belowY}
    <div
      class="tooltip"
      style="left: {clampedX}px; top: {tooltipY}px;"
    >
      <div class="tooltip-time">{densityTooltip.time}</div>
      <div class="tooltip-counts">{densityTooltip.counts}</div>
    </div>
  {/if}
</div>

<style>
  .combined-timeline {
    width: 100%;
    height: 100%;
    position: relative;
    background: var(--vw-bg-card);
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
    cursor: crosshair;
  }

  .tooltip {
    position: absolute;
    background: var(--vw-bg-elevated);
    border: 1px solid var(--vw-border-bright);
    border-radius: 4px;
    padding: 0.5rem 0.75rem;
    font-size: var(--text-xs);
    pointer-events: none;
    z-index: 100;
    transform: translateX(-50%);
    white-space: nowrap;
  }

  .tooltip-time {
    color: var(--vw-cyan);
    font-family: var(--vw-font-mono);
    margin-bottom: 0.25rem;
  }

  .tooltip-counts {
    color: var(--vw-text);
  }

  /* Agent tooltip styles */
  .agent-tooltip {
    min-width: 140px;
  }

  .tooltip-header {
    color: var(--vw-cyan);
    font-family: var(--vw-font-mono);
    font-weight: 600;
    margin-bottom: 0.5rem;
    padding-bottom: 0.25rem;
    border-bottom: 1px solid var(--vw-border);
  }

  .tooltip-row {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.25rem;
  }

  .tooltip-label {
    color: var(--vw-gray);
  }

  .tooltip-value {
    color: var(--vw-text);
    font-family: var(--vw-font-mono);
  }

  .tooltip-value.status-running {
    color: var(--vw-success);
  }

  .tooltip-value.status-completed {
    color: var(--vw-gray);
  }

  .tooltip-value.status-failed {
    color: var(--vw-danger);
  }

  .tooltip-id {
    margin-top: 0.5rem;
    padding-top: 0.25rem;
    border-top: 1px solid var(--vw-border);
    color: var(--vw-gray);
    font-family: var(--vw-font-mono);
    font-size: 0.65rem;
  }
</style>
