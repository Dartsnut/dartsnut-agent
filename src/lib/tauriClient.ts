import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AgentEvent,
  AgentSessionWorkspaceSummary,
  AppUpdateInstallResponse,
  AppUpdateDownloadResponse,
  AppUpdateCheckResponse,
  AppUpdateStatus,
  BootstrapState,
  ProjectTree,
  ProjectCreateRequest,
  ProjectSelectRequest,
  ChatCreateRequest,
  ProjectSwitchProgress,
  PickWorkspaceRequest,
  PickWorkspaceResponse,
  MachineMcpSubmitQuestionAnswerRequest,
  MachineMcpSubmitQuestionAnswerResponse,
  AgentQuestionAnswerRequest,
  PromptRequest,
  ProviderSettings,
  PythonRuntimeProgress,
  SaveProviderSettingsRequest,
  SendPromptResponse,
  DeployConnectRequest,
  DeployConnectResponse,
  DeployConnectionState,
  DeployEligibility,
  DeployActionResponse,
  DeployFrameEvent,
  DeployLaunchRequest,
  CommunitySessionInfo,
  CommunityCancelGoogleLoginResponse,
  CommunityLoginRequest,
  CommunityLoginResponse,
  CommunitySetPasswordRequest,
  CommunitySetPasswordResponse,
  CommunityLogoutResponse,
  CommunityGetLlmQuotaResponse,
  CommunityListDeployDevicesResponse,
  CommunityListMyGamesResponse,
  CommunityGetPublishOptionsResponse,
  CommunityListAppVersionsRequest,
  CommunityListAppVersionsResponse,
  CommunityCreateAppRequest,
  CommunityCreateAppResponse,
  CommunityUploadNativeImageRequest,
  CommunityUploadNativeImageResponse,
  CommunitySubmitAppVersionRequest,
  CommunitySubmitAppVersionResponse,
  CommunityUpdateWorkspaceVersionRequest,
  CommunityUpdateWorkspaceVersionResponse,
  CommunitySubmitProgress,
  CommunityWithdrawAppVersionRequest,
  CommunityWithdrawAppVersionResponse,
  WindowChromeInsets,
  ShellUiTheme,
  AgentQuestionAnswerResponse as QuestionAnswerResponse,
  WidgetConfigScope,
  WidgetConfigSnapshot,
  RendererErrorPayload
} from "@dartsnut/desktop-contracts";
import type {
  EmulatorCommand,
  EmulatorFrame,
  EmulatorLogEntry,
  EmulatorStateSnapshot
} from "@dartsnut/emulator-protocol";

type Listener<T> = (value: T) => void;

// WebView File objects do not expose native paths in Tauri. Keep a short-lived
// filename-to-path map populated by Tauri's native drag/drop event so existing
// upload flows can resolve native paths without exposing them in DOM events.
const nativeDroppedPaths = new Map<string, string>();
let nativeDropListenerStarted = false;

function startNativeDropListener(): void {
  if (nativeDropListenerStarted || typeof window === "undefined") return;
  nativeDropListenerStarted = true;
  void tauriListen<{ paths?: string[] }>("tauri://drag-drop", (event) => {
    nativeDroppedPaths.clear();
    for (const filePath of event.payload?.paths ?? []) {
      const normalized = filePath.replaceAll("\\", "/");
      const name = normalized.slice(normalized.lastIndexOf("/") + 1);
      if (name) nativeDroppedPaths.set(name, filePath);
    }
    if (nativeDroppedPaths.size > 64) {
      const keep = [...nativeDroppedPaths.entries()].slice(-64);
      nativeDroppedPaths.clear();
      for (const [name, filePath] of keep) nativeDroppedPaths.set(name, filePath);
    }
  }).catch(() => {
    nativeDropListenerStarted = false;
  });
}

const invoke = <T>(command: string, args?: unknown): Promise<T> =>
  tauriInvoke<T>(command, args === undefined ? undefined : { payload: args });

function safelyUnlisten(stop: (() => void) | undefined): void {
  if (!stop) return;
  try {
    void Promise.resolve(stop()).catch(() => undefined);
  } catch {
    // Tauri may already have removed this listener during WebView teardown.
  }
}

function subscribe<T>(event: string, listener: Listener<T>): () => void {
  let unlisten: UnlistenFn | undefined;
  let disposed = false;
  void tauriListen<T>(event, (message) => listener(message.payload))
    .then((stop) => {
      if (disposed) {
        safelyUnlisten(stop);
      } else {
        unlisten = stop;
      }
    })
    .catch(() => {
      // Listener setup is best effort; app remains usable without optional events.
    });
  return () => {
    if (disposed) {
      return;
    }
    disposed = true;
    const stop = unlisten;
    unlisten = undefined;
    safelyUnlisten(stop);
  };
}

function subscribeNoPayload(event: string, listener: () => void): () => void {
  return subscribe(event, () => listener());
}

export function createTauriClient() {
  startNativeDropListener();
  return {
    rendererReady: () => invoke<void>("renderer_ready"),
    reportRendererError: (payload: RendererErrorPayload) => invoke<void>("report_renderer_error", payload),
    openStartupLogs: () => invoke<void>("open_startup_logs"),
    openWorkspaceFolder: (projectId: string) => invoke<void>("open_workspace_folder", projectId),
    copyStartupDiagnostics: () => invoke<void>("copy_startup_diagnostics"),
    resetRendererState: () => invoke<void>("reset_renderer_state"),
    restartApp: () => invoke<void>("restart_app"),
    getBootstrapState: () => invoke<BootstrapState>("get_bootstrap_state"),
    getWorkspaceSessionSummary: (chatId?: string) => invoke<AgentSessionWorkspaceSummary>("get_workspace_session_summary", chatId),
    resetWorkspaceSession: () => invoke<void>("reset_workspace_session"),
    listProjects: () => invoke<ProjectTree>("list_projects"),
    createProject: (request: ProjectCreateRequest) => invoke<{ state: BootstrapState; tree: ProjectTree }>("create_project", request),
    removeProject: (projectId: string) => invoke<{ state: BootstrapState; tree: ProjectTree }>("remove_project", projectId),
    selectProject: (request: ProjectSelectRequest) => invoke<{ state: BootstrapState; tree: ProjectTree; accepted: boolean; error?: string }>("select_project", request),
    createChat: (request: ChatCreateRequest) => invoke<{ state: BootstrapState; tree: ProjectTree }>("create_chat", request),
    archiveChat: (chatId: string) => invoke<{ state: BootstrapState; tree: ProjectTree }>("archive_chat", chatId),
    generateChatTitle: (request: { chatId: string; firstUserMessage: string; fallbackOnly?: boolean }) => invoke<{ tree: ProjectTree; updated: boolean; title?: string }>("generate_chat_title", request),
    selectChat: (chatId: string) => invoke<{ state: BootstrapState; tree: ProjectTree; accepted: boolean; error?: string }>("select_chat", chatId),
    onProjectSwitchProgress: (listener: Listener<ProjectSwitchProgress>) => subscribe("agent:project-switch-progress", listener),
    getWindowChromeInsets: () => invoke<WindowChromeInsets>("get_window_chrome_insets"),
    getAppUpdateStatus: () => invoke<AppUpdateStatus>("get_app_update_status"),
    installAppUpdateNow: () => invoke<AppUpdateInstallResponse>("install_app_update_now"),
    getAppUpdateAutoDownload: () => invoke<boolean>("get_app_update_auto_download"),
    setAppUpdateAutoDownload: (enabled: boolean) => invoke<boolean>("set_app_update_auto_download", enabled),
    downloadAppUpdate: () => invoke<AppUpdateDownloadResponse>("download_app_update"),
    checkAppUpdate: () => invoke<AppUpdateCheckResponse>("check_app_update"),
    setShellUiTheme: (theme: ShellUiTheme) => invoke<void>("set_shell_ui_theme", theme),
    pickWorkspace: (request?: PickWorkspaceRequest) => invoke<PickWorkspaceResponse>("pick_workspace", request),
    machineMcpSubmitQuestionAnswer: (body: MachineMcpSubmitQuestionAnswerRequest) => invoke<MachineMcpSubmitQuestionAnswerResponse>("machine_mcp_submit_question_answer", body),
    agentQuestionSubmitAnswer: (body: AgentQuestionAnswerRequest) => invoke<QuestionAnswerResponse>("agent_question_submit_answer", body),
    sendPrompt: (request: PromptRequest) => invoke<SendPromptResponse>("send_prompt", request),
    cancelAgent: () => invoke<{ ok: boolean }>("cancel_agent"),
    getProviderSettings: () => invoke<ProviderSettings>("get_provider_settings"),
    getPythonRuntimeStatus: () => invoke<string | null>("get_python_runtime_status"),
    getPythonRuntimeProgress: () => invoke<PythonRuntimeProgress>("get_python_runtime_progress"),
    retryPythonRuntimeSetup: () => invoke<boolean>("retry_python_runtime_setup"),
    saveProviderSettings: (request: SaveProviderSettingsRequest) => invoke<ProviderSettings>("save_provider_settings", request),
    onAgentEvent: (listener: Listener<AgentEvent>) => subscribe("agent:events", listener),
    onWindowChromeInsets: (listener: Listener<WindowChromeInsets>) => subscribe("shell:window-chrome-insets-changed", listener),
    onAppUpdateStatus: (listener: Listener<AppUpdateStatus>) => subscribe("app:update-status-changed", listener),
    onSessionReset: (listener: () => void) => subscribeNoPayload("agent:session-reset", listener),
    onBootstrapStateChanged: (listener: Listener<BootstrapState>) => subscribe("agent:bootstrap-state-changed", listener),
    onPythonRuntimeStatus: (listener: Listener<string | null>) => subscribe("agent:python-runtime-status", listener),
    onPythonRuntimeProgress: (listener: Listener<PythonRuntimeProgress>) => subscribe("agent:python-runtime-progress", listener),
    sendEmulatorCommand: (command: EmulatorCommand) => invoke<{ ok: boolean }>("emulator_command", command),
    pickWidgetPath: () => invoke<{ path: string | null }>("emulator_pick_path"),
    getLastWidgetPath: () => invoke<{ path: string | null }>("emulator_get_last_path"),
    getEmulatorBackground: () => invoke<{ url: string | null }>("emulator_get_background"),
    openCaptureFolder: (folderPath: string) => invoke<void>("emulator_open_capture_folder", folderPath),
    onEmulatorState: (listener: Listener<EmulatorStateSnapshot>) => subscribe("emulator:state", listener),
    onEmulatorFrame: (listener: Listener<EmulatorFrame>) => subscribe("emulator:frame", listener),
    onEmulatorLog: (listener: Listener<EmulatorLogEntry>) => subscribe("emulator:log", listener),
    onEmulatorLogsClear: (listener: () => void) => subscribeNoPayload("emulator:logs-clear", listener),
    getWidgetConfig: (scope: WidgetConfigScope) => invoke<WidgetConfigSnapshot>("get_widget_config", scope),
    onWidgetConfig: (listener: Listener<WidgetConfigSnapshot>) => subscribe("widget-config:changed", listener),
    deployGetEligibility: () => invoke<DeployEligibility>("deploy_get_eligibility"),
    onDeployEligibility: (listener: Listener<DeployEligibility>) => subscribe("deploy:eligibility-changed", listener),
    deployConnect: (request: DeployConnectRequest) => invoke<DeployConnectResponse>("deploy_connect", request),
    deployGetState: () => invoke<DeployConnectionState>("deploy_get_state"),
    onDeployConnectionChanged: (listener: Listener<DeployConnectionState>) => subscribe("deploy:connection-changed", listener),
    deployDisconnect: () => invoke<DeployActionResponse>("deploy_disconnect"),
    deployRun: (request?: DeployLaunchRequest) => invoke<DeployActionResponse>("deploy_run", request),
    deployReload: (request?: DeployLaunchRequest) => invoke<DeployActionResponse>("deploy_reload", request),
    deployApplyWidgetParams: (request: DeployLaunchRequest) => invoke<DeployActionResponse>("deploy_apply_widget_params", request),
    deployStop: () => invoke<DeployActionResponse>("deploy_stop"),
    deployOpenLocalNetworkSettings: () => invoke<DeployActionResponse>("deploy_open_local_network_settings"),
    onDeployLog: (listener: Listener<string>) => subscribe("deploy:log", listener),
    onDeployFrame: (listener: Listener<DeployFrameEvent>) => subscribe("deploy:frame", listener),
    communityGetSession: () => invoke<CommunitySessionInfo>("community_get_session"),
    communityLogin: (request: CommunityLoginRequest) => invoke<CommunityLoginResponse>("community_login", request),
    communitySetPassword: (request: CommunitySetPasswordRequest) => invoke<CommunitySetPasswordResponse>("community_set_password", request),
    communityCancelGoogleLogin: () => invoke<CommunityCancelGoogleLoginResponse>("community_cancel_google_login"),
    communityLogout: () => invoke<CommunityLogoutResponse>("community_logout"),
    communityGetLlmQuota: () => invoke<CommunityGetLlmQuotaResponse>("community_get_llm_quota"),
    communityListDeployDevices: () => invoke<CommunityListDeployDevicesResponse>("community_list_deploy_devices"),
    communityListMyGames: () => invoke<CommunityListMyGamesResponse>("community_list_my_games"),
    communityGetPublishOptions: () => invoke<CommunityGetPublishOptionsResponse>("community_get_publish_options"),
    communityListAppVersions: (request: CommunityListAppVersionsRequest) => invoke<CommunityListAppVersionsResponse>("community_list_app_versions", request),
    communityCreateApp: (request: CommunityCreateAppRequest) => invoke<CommunityCreateAppResponse>("community_create_app", request),
    communityUploadNativeImage: (request: CommunityUploadNativeImageRequest) => invoke<CommunityUploadNativeImageResponse>("community_upload_native_image", request),
    communitySubmitAppVersion: (request: CommunitySubmitAppVersionRequest) => invoke<CommunitySubmitAppVersionResponse>("community_submit_app_version", request),
    communityUpdateWorkspaceVersion: (request: CommunityUpdateWorkspaceVersionRequest) => invoke<CommunityUpdateWorkspaceVersionResponse>("community_update_workspace_version", request),
    onCommunitySubmitProgress: (listener: Listener<CommunitySubmitProgress>) => subscribe("community:submit-progress", listener),
    communityWithdrawAppVersion: (request: CommunityWithdrawAppVersionRequest) => invoke<CommunityWithdrawAppVersionResponse>("community_withdraw_app_version", request),
    getPathForFile: (file: File) => {
      const nativePath = (file as File & { path?: string }).path;
      if (nativePath) return nativePath;
      return nativeDroppedPaths.get(file.name) ?? "";
    }
  };
}

export type TauriClient = ReturnType<typeof createTauriClient>;

export const tauriClient = createTauriClient();
