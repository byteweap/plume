import { invokeCommand } from "../../platform/tauri";
import type {
  ConnectedDatabaseResult,
  ConnectionProfile,
  ConnectionTestRequest,
  ConnectionTestResult,
  ProfileWriteRequest,
  SessionHealth,
} from "./connection";

export const connectionApi = {
  test(request: ConnectionTestRequest): Promise<ConnectionTestResult> {
    return invokeCommand<ConnectionTestResult>("test_connection", { request });
  },
  testProfile(request: ProfileWriteRequest): Promise<ConnectionTestResult> {
    return invokeCommand<ConnectionTestResult>("test_connection_profile", { request });
  },
  connect(request: ConnectionTestRequest): Promise<ConnectedDatabaseResult> {
    return invokeCommand<ConnectedDatabaseResult>("connect_database", { request });
  },
  listProfiles(): Promise<ConnectionProfile[]> {
    return invokeCommand<ConnectionProfile[]>("list_connection_profiles");
  },
  createProfile(request: ProfileWriteRequest): Promise<ConnectionProfile> {
    return invokeCommand<ConnectionProfile>("create_connection_profile", { request });
  },
  updateProfile(request: ProfileWriteRequest): Promise<ConnectionProfile> {
    return invokeCommand<ConnectionProfile>("update_connection_profile", { request });
  },
  duplicateProfile(id: string): Promise<ConnectionProfile> {
    return invokeCommand<ConnectionProfile>("duplicate_connection_profile", {
      request: { id },
    });
  },
  renameProfile(id: string, name: string): Promise<ConnectionProfile> {
    return invokeCommand<ConnectionProfile>("rename_connection_profile", {
      request: { id, name },
    });
  },
  setFavorite(id: string, favorite: boolean): Promise<ConnectionProfile> {
    return invokeCommand<ConnectionProfile>("set_connection_favorite", {
      request: { id, favorite },
    });
  },
  deleteProfile(id: string): Promise<void> {
    return invokeCommand<void>("delete_connection_profile", {
      request: { id },
    });
  },
  connectSaved(id: string): Promise<ConnectedDatabaseResult> {
    return invokeCommand<ConnectedDatabaseResult>("connect_saved_database", {
      request: { id },
    });
  },
  reconnectSaved(
    profileId: string,
    sessionId: string,
  ): Promise<ConnectedDatabaseResult> {
    return invokeCommand<ConnectedDatabaseResult>("reconnect_saved_database", {
      request: { profileId, sessionId },
    });
  },
  disconnect(sessionId: string): Promise<void> {
    return invokeCommand<void>("disconnect_database", {
      request: { sessionId },
    });
  },
  checkSession(sessionId: string): Promise<SessionHealth> {
    return invokeCommand<SessionHealth>("check_database_session", {
      request: { sessionId },
    });
  },
};
