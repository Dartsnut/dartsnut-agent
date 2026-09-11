import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined)
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => undefined)
}));

import { createTauriClient } from "./tauriClient";

describe("Tauri client command contract", () => {
  it("exposes every frontend operation from desktop contracts", () => {
    const api = createTauriClient();
    const expectedTopLevel = [
      "rendererReady", "reportRendererError", "openStartupLogs", "openWorkspaceFolder", "copyStartupDiagnostics",
      "resetRendererState", "restartApp", "getBootstrapState", "getWorkspaceSessionSummary",
      "resetWorkspaceSession", "listProjects", "createProject", "removeProject", "selectProject",
      "createChat", "archiveChat", "generateChatTitle", "selectChat", "onProjectSwitchProgress",
      "getWindowChromeInsets", "getAppUpdateStatus", "installAppUpdateNow", "getAppUpdateAutoDownload",
      "setAppUpdateAutoDownload", "downloadAppUpdate", "checkAppUpdate", "setShellUiTheme",
      "pickWorkspace", "machineMcpSubmitQuestionAnswer", "agentQuestionSubmitAnswer", "sendPrompt",
      "cancelAgent", "getProviderSettings", "getPythonRuntimeStatus", "getPythonRuntimeProgress", "retryPythonRuntimeSetup",
      "saveProviderSettings", "onAgentEvent", "onWindowChromeInsets",
      "onAppUpdateStatus", "onSessionReset", "onBootstrapStateChanged", "onPythonRuntimeStatus",
      "onPythonRuntimeProgress", "sendEmulatorCommand", "pickWidgetPath", "getLastWidgetPath",
      "getEmulatorBackground", "openCaptureFolder", "onEmulatorState", "onEmulatorFrame", "onEmulatorLog",
      "onEmulatorLogsClear", "getWidgetConfig", "onWidgetConfig", "deployGetEligibility",
      "onDeployEligibility", "deployConnect", "deployGetState", "onDeployConnectionChanged", "deployDisconnect", "deployRun",
      "deployReload", "deployApplyWidgetParams", "deployStop", "deployOpenLocalNetworkSettings", "onDeployLog",
      "onDeployFrame", "communityGetSession", "communityLogin", "communitySetPassword",
      "communityCancelGoogleLogin", "communityLogout", "communityGetLlmQuota", "communityListDeployDevices",
      "communityListMyGames", "communityGetPublishOptions", "communityListAppVersions", "communityCreateApp",
      "communityUploadNativeImage", "communitySubmitAppVersion", "communityUpdateWorkspaceVersion",
      "onCommunitySubmitProgress", "communityWithdrawAppVersion", "getPathForFile"
    ];
    expect(Object.keys(api).sort()).toEqual(expectedTopLevel.sort());
  });
});
