export type MobileView = "navigation" | "pages" | "editor";

export type MobileBackState = {
  hasOverlay: boolean;
  screen: "workspace" | "trash" | "stickers" | "today";
  view: MobileView;
};

export type MobileBackAction = "close-overlay" | "workspace" | "pages" | "navigation" | "system";
export type MobileBackResult = "HANDLED" | "UNHANDLED";

export const MOBILE_BACK_PROTOCOL_VERSION = 2;

export function mobileViewLogLevel(view: MobileView) {
  if (view === "editor") return "PAGE_EDITOR";
  if (view === "pages") return "PAGE_LIST";
  return "ROOT_NOTEBOOKS";
}

export function mobileBackActionLog(action: MobileBackAction) {
  if (action === "pages") return "OPEN_PAGE_LIST";
  if (action === "navigation") return "OPEN_NOTEBOOKS";
  if (action === "close-overlay") return "CLOSE_OVERLAY";
  if (action === "workspace") return "OPEN_WORKSPACE";
  return "SYSTEM_BACK";
}

export function resolveMobileBack(state: MobileBackState): MobileBackAction {
  if (state.hasOverlay) return "close-overlay";
  if (state.screen !== "workspace") return "workspace";
  if (state.view === "editor") return "pages";
  if (state.view === "pages") return "navigation";
  return "system";
}
