/**
 * WebSocket connection store for Argus dashboard
 *
 * Manages WebSocket lifecycle, authentication, reconnection with exponential backoff,
 * and message dispatch to registered handlers.
 */

// Connection state type
export type ConnectionStatus = "disconnected" | "connecting" | "connected";

// Message types from server
export type ServerMessageType =
  | "auth_result"
  | "subscribe_result"
  | "event"
  | "session_started"
  | "session_ended"
  | "session_active"
  | "session_idle"
  | "agent_started"
  | "agent_activated"
  | "agent_completed"
  | "agent_abandoned"
  | "error"
  | "pong";

// Base message structure
export interface ServerMessage {
  type: ServerMessageType;
  status?: "success" | "error";
  message?: string;
  event?: unknown;
  payload?: unknown;
  active_filters?: Record<string, unknown>;
}

// Message handler callback type
export type MessageHandler = (message: ServerMessage) => void;

// Reconnection config
const RECONNECT_CONFIG = {
  initialDelay: 5000,
  maxDelay: 60000,
  backoffMultiplier: 2,
};

// Module-level state using Svelte 5 runes
let ws: WebSocket | null = $state(null);
let status: ConnectionStatus = $state("disconnected");
let authenticated: boolean = $state(false);
let reconnectDelay: number = $state(RECONNECT_CONFIG.initialDelay);
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let currentFilters: Record<string, unknown> = $state({});

// Message handlers registry
const messageHandlers = new Map<ServerMessageType, Set<MessageHandler>>();

// Build WebSocket URL from current location
function getWsUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

// Send message to server
function send(data: Record<string, unknown>): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// Send authentication message (with optional API key for dev proxy)
function sendAuth(): void {
  const apiKey = import.meta.env.VITE_ARGUS_API_KEY;
  if (apiKey) {
    send({ type: "auth", api_key: apiKey });
  } else {
    send({ type: "auth" });
  }
}

// Subscribe to events with optional filters
function subscribe(filters: Record<string, unknown> = {}): void {
  currentFilters = filters;
  send({ type: "subscribe", filters });
}

// Handle successful authentication
function handleAuthResult(message: ServerMessage): void {
  if (message.status === "success") {
    authenticated = true;
    status = "connected";
    reconnectDelay = RECONNECT_CONFIG.initialDelay;
    console.log("WebSocket authenticated");
    subscribe({});
  } else {
    console.error("WebSocket auth failed:", message.message);
    ws?.close();
  }
}

// Dispatch message to registered handlers
function dispatchMessage(message: ServerMessage): void {
  const handlers = messageHandlers.get(message.type);
  if (handlers) {
    handlers.forEach((handler) => {
      try {
        handler(message);
      } catch (error) {
        console.error(`Handler error for ${message.type}:`, error);
      }
    });
  }
}

// Handle incoming message
function handleMessage(event: MessageEvent): void {
  try {
    const message: ServerMessage = JSON.parse(event.data);

    // Handle auth internally
    if (message.type === "auth_result") {
      handleAuthResult(message);
    }

    // Dispatch to all registered handlers
    dispatchMessage(message);
  } catch (error) {
    console.error("Failed to parse WebSocket message:", error);
  }
}

// Handle connection open
function handleOpen(): void {
  console.log("WebSocket connected");
  sendAuth();
}

// Handle connection close
function handleClose(event: CloseEvent): void {
  console.log("WebSocket closed:", event.code, event.reason);
  ws = null;
  authenticated = false;
  status = "disconnected";
  scheduleReconnect();
}

// Handle connection error
function handleError(event: Event): void {
  console.error("WebSocket error:", event);
}

// Schedule reconnection with exponential backoff
function scheduleReconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }

  console.log(`Reconnecting in ${reconnectDelay / 1000}s...`);

  reconnectTimer = setTimeout(() => {
    connect();
    reconnectDelay = Math.min(
      reconnectDelay * RECONNECT_CONFIG.backoffMultiplier,
      RECONNECT_CONFIG.maxDelay,
    );
  }, reconnectDelay);
}

// Connect to WebSocket server
function connect(): void {
  if (status !== "disconnected") {
    return;
  }

  status = "connecting";

  try {
    const socket = new WebSocket(getWsUrl());
    socket.addEventListener("open", handleOpen);
    socket.addEventListener("message", handleMessage);
    socket.addEventListener("close", handleClose);
    socket.addEventListener("error", handleError);
    ws = socket;
  } catch (error) {
    console.error("WebSocket connection error:", error);
    scheduleReconnect();
  }
}

// Disconnect from WebSocket server
function disconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (ws) {
    ws.close();
    ws = null;
  }

  authenticated = false;
  status = "disconnected";
  reconnectDelay = RECONNECT_CONFIG.initialDelay;
}

// Register a message handler for a specific message type
function onMessage(
  type: ServerMessageType,
  handler: MessageHandler,
): () => void {
  if (!messageHandlers.has(type)) {
    messageHandlers.set(type, new Set());
  }
  messageHandlers.get(type)!.add(handler);

  // Return unsubscribe function
  return () => {
    messageHandlers.get(type)?.delete(handler);
  };
}

// Export reactive getters for state
export function getStatus(): ConnectionStatus {
  return status;
}

export function isAuthenticated(): boolean {
  return authenticated;
}

export function getFilters(): Record<string, unknown> {
  return currentFilters;
}

// Export actions
export const websocket = {
  connect,
  disconnect,
  send,
  subscribe,
  onMessage,
  getStatus,
  isAuthenticated,
  getFilters,
};

// Default export for convenience
export default websocket;
