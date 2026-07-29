import type { ConnectedDatabaseResult } from "./connection";

export type ConnectionLifecycleState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "busy"
  | "reconnecting"
  | "disconnecting"
  | "error";

export interface ConnectionSessionState {
  state: ConnectionLifecycleState;
  sessionId?: string;
  serverVersion?: string;
  error?: string;
}

export type ConnectionSessionMap = Record<string, ConnectionSessionState>;

export type ConnectionSessionAction =
  | { type: "connect"; profileId: string }
  | { type: "reconnect"; profileId: string }
  | { type: "connected"; profileId: string; result: ConnectedDatabaseResult }
  | { type: "begin-work"; profileId: string }
  | { type: "ready"; profileId: string }
  | { type: "disconnect"; profileId: string }
  | { type: "disconnected"; profileId: string }
  | { type: "failed"; profileId: string; error: string }
  | { type: "remove"; profileId: string };

const disconnected: ConnectionSessionState = { state: "disconnected" };

export function getConnectionSession(
  sessions: ConnectionSessionMap,
  profileId: string,
): ConnectionSessionState {
  return sessions[profileId] ?? disconnected;
}

export function connectionSessionReducer(
  sessions: ConnectionSessionMap,
  action: ConnectionSessionAction,
): ConnectionSessionMap {
  if (action.type === "remove") {
    const next = { ...sessions };
    delete next[action.profileId];
    return next;
  }

  const current = getConnectionSession(sessions, action.profileId);
  let next: ConnectionSessionState;

  switch (action.type) {
    case "connect":
      if (!isOneOf(current.state, "disconnected", "error")) return sessions;
      next = { state: "connecting" };
      break;
    case "reconnect":
      if (!isOneOf(current.state, "connected", "error")) return sessions;
      next = { ...current, state: "reconnecting", error: undefined };
      break;
    case "connected":
      next = {
        state: "connected",
        sessionId: action.result.sessionId,
        serverVersion: action.result.serverVersion,
      };
      break;
    case "begin-work":
      if (current.state !== "connected") return sessions;
      next = { ...current, state: "busy", error: undefined };
      break;
    case "ready":
      if (current.state !== "busy") return sessions;
      next = { ...current, state: "connected", error: undefined };
      break;
    case "disconnect":
      if (!isOneOf(current.state, "connected", "busy", "error")) return sessions;
      next = { ...current, state: "disconnecting", error: undefined };
      break;
    case "disconnected":
      next = disconnected;
      break;
    case "failed":
      next = { ...current, state: "error", error: action.error };
      break;
  }

  return { ...sessions, [action.profileId]: next };
}

function isOneOf(
  state: ConnectionLifecycleState,
  ...allowed: ConnectionLifecycleState[]
) {
  return allowed.includes(state);
}
