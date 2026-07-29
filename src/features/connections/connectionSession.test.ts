import { describe, expect, it } from "vitest";
import {
  connectionSessionReducer,
  getConnectionSession,
  type ConnectionSessionMap,
} from "./connectionSession";

const connectedResult = {
  sessionId: "session-1",
  database: "postgres",
  latencyMs: 10,
  serverVersion: "18.0",
  transport: "plain" as const,
};

describe("connectionSessionReducer", () => {
  it("moves through connect, busy, ready, and disconnect states", () => {
    let sessions: ConnectionSessionMap = {};
    sessions = connectionSessionReducer(sessions, {
      type: "connect",
      profileId: "profile-1",
    });
    expect(getConnectionSession(sessions, "profile-1").state).toBe("connecting");

    sessions = connectionSessionReducer(sessions, {
      type: "connected",
      profileId: "profile-1",
      result: connectedResult,
    });
    sessions = connectionSessionReducer(sessions, {
      type: "begin-work",
      profileId: "profile-1",
    });
    expect(getConnectionSession(sessions, "profile-1").state).toBe("busy");

    sessions = connectionSessionReducer(sessions, {
      type: "ready",
      profileId: "profile-1",
    });
    sessions = connectionSessionReducer(sessions, {
      type: "disconnect",
      profileId: "profile-1",
    });
    expect(getConnectionSession(sessions, "profile-1").state).toBe(
      "disconnecting",
    );

    sessions = connectionSessionReducer(sessions, {
      type: "disconnected",
      profileId: "profile-1",
    });
    expect(getConnectionSession(sessions, "profile-1")).toEqual({
      state: "disconnected",
    });
  });

  it("preserves the old session while reconnecting and replaces it on success", () => {
    let sessions = connectionSessionReducer({}, {
      type: "connected",
      profileId: "profile-1",
      result: connectedResult,
    });
    sessions = connectionSessionReducer(sessions, {
      type: "failed",
      profileId: "profile-1",
      error: "connection closed",
    });
    sessions = connectionSessionReducer(sessions, {
      type: "reconnect",
      profileId: "profile-1",
    });
    expect(getConnectionSession(sessions, "profile-1")).toMatchObject({
      state: "reconnecting",
      sessionId: "session-1",
    });

    sessions = connectionSessionReducer(sessions, {
      type: "connected",
      profileId: "profile-1",
      result: { ...connectedResult, sessionId: "session-2" },
    });
    expect(getConnectionSession(sessions, "profile-1")).toMatchObject({
      state: "connected",
      sessionId: "session-2",
    });
  });

  it("ignores invalid transitions", () => {
    const sessions = connectionSessionReducer({}, {
      type: "begin-work",
      profileId: "profile-1",
    });
    expect(sessions).toEqual({});
  });
});
