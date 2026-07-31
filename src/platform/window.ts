import { getCurrentWindow } from "@tauri-apps/api/window";

export function onWindowCloseRequested(
  handler: (event: { preventDefault: () => void }) => void,
): Promise<() => void> {
  return getCurrentWindow().onCloseRequested(handler);
}

export function destroyCurrentWindow(): Promise<void> {
  return getCurrentWindow().destroy();
}
