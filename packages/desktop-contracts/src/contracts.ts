import type { ChatMediaAttachment } from "./chatMediaAttachments";
import type { AgentProfileId } from "./agentProfiles";

export type RendererErrorPayload = {
  message: string;
  stack?: string;
  source?: string;
};

/** Padding (logical px) that MUST stay clear of traffic lights / caption overlay. */
export interface WindowChromeInsets {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

/** Matches renderer `ThemeId`; used to style Windows `titleBarOverlay` and `nativeTheme`. */
export type ShellUiTheme = "system" | "dark" | "light";

export type AppUpdateStatusKind =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "not_available"
  | "error";

export interface AppUpdateStatus {
  kind: AppUpdateStatusKind;
  currentVersion: string;
  availableVersion: string | null;
  percent: number | null;
  message: string | null;
}

export type AppUpdateInstallResponse =
  | { ok: true }
  | { ok: false; reason: "not_ready" | "cancelled" };

export type AppUpdateDownloadResponse =
  | { ok: true }
  | { ok: false; reason: "not_available" | "already_downloading" | "failed"; message?: string };

export type AppUpdateCheckResponse =
  | { ok: true }
  | { ok: false; reason: "disabled" | "already_checking" | "already_ready" | "failed"; message?: string };

export type ProviderStatus = "ready" | "missing_config" | "invalid";

export interface PythonRuntimeProgress {
  running: boolean;
  stage: "check" | "probe" | "download" | "verify" | "extract" | "install" | "validate" | "complete" | "error" | null;
  percent: number;
  message: string | null;
  error?: string;
  artifact?: string;
}

export interface BootstrapState {
  workspaceRoot: string | null;
  activeProjectId: string | null;
  activeChatId: string | null;
  providerStatus: ProviderStatus;
  firstRunComplete: boolean;
}

export interface ProjectRecord { id: string; name: string; folderPath: string; createdAt: string; updatedAt: string; lastOpenedAt: string; }
export interface ChatRecord { id: string; projectId: string; title: string; createdAt: string; updatedAt: string; archivedAt?: string; }
export interface ProjectTree { projects: ProjectRecord[]; chats: ChatRecord[]; }
export interface ProjectCreateRequest {
  folderPath: string;
  name?: string;
  /** Creates and selects a persona-bound chat as part of project creation. */
  agentProfileId?: AgentProfileId;
}
export interface ProjectSelectRequest { projectId: string | null; chatId?: string; }
export interface ChatCreateRequest { projectId: string; agentProfileId: AgentProfileId; }
export interface ChatGenerateTitleRequest { chatId: string; firstUserMessage: string; }
export type ProjectSwitchProgress = { active: boolean; stage: "confirming" | "stopping-deployment" | "stopping-emulator" | "switching" | "reloading" | "ready" | "error"; message?: string };

export type AgentSessionIntent = "auto" | "resume" | "fresh";

export interface PromptRequest {
  prompt: string;
  /** Media files dropped onto the chat composer. Main copies these into the workspace before the agent sees them. */
  chatMediaAttachments?: ChatMediaAttachment[];
  projectType?: ProjectType;
  widgetSize?: WidgetSize;
  workspacePath?: string;
  projectId?: string;
  chatId?: string;
  agentProfileId?: AgentProfileId;
  templateMode?: "game-creator" | "widget-creator";
  /**
   * Controls loading vs resetting on-disk workspace agent session (see `AgentSessionWorkspaceSummary`).
   * Omitted means **auto**: load `conversation.json` when present.
   */
  agentSession?: {
    intent: AgentSessionIntent;
  };
}

export type DartsnutLlmFailureReason =
  | "auth_required"
  | "no_bound_machine"
  | "daily_quota_exceeded"
  | "run_already_active"
  | "run_expired"
  | "service_unavailable";

/** IPC return from `sendPrompt` — optional routing snapshot or typed Dartsnut LLM rejection. */
export interface SendPromptResponse {
  ok: boolean;
  failureReason?: DartsnutLlmFailureReason;
  message?: string;
  sessionRouting?: {
    templateMode: "game-creator" | "widget-creator";
    projectType: ProjectType;
    widgetSize?: WidgetSize;
  };
}

export type AgentToolCallTerminalStatus = "succeeded" | "failed" | "skipped" | "refused" | "cancelled";

export type AgentToolCallEvent =
  | {
    type: "tool_call";
    phase: "started";
    at: number;
    runId: string;
    callId: string;
    toolName: string;
    inputPreview?: unknown;
  }
  | {
    type: "tool_call";
    phase: "finished";
    at: number;
    runId: string;
    callId: string;
    toolName: string;
    status: AgentToolCallTerminalStatus;
    durationMs: number;
    resultPreview?: unknown;
    error?: string;
  };

export type AgentSessionTranscriptLineKind = "user" | "assistant" | "tool" | "tool_status" | "thinking";

export interface AgentTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AgentSessionTokenUsage extends AgentTokenUsage {
  lastRun?: AgentTokenUsage;
}

/** Workspace `transcript.jsonl` row shape (renderer preview). */
export interface AgentSessionTranscriptLine {
  kind: AgentSessionTranscriptLineKind;
  at: number;
  text: string;
  toolName?: string;
  toolCall?: AgentToolCallEvent;
}

/** Snapshot for agent session banner + history hydrate. */
export interface AgentSessionWorkspaceSummary {
  chatId: string | null;
  hasPersistedSession: boolean;
  sessionId: string | null;
  updatedAt: string | null;
  templateMode: string | null;
  transcriptTail: AgentSessionTranscriptLine[];
  tokenUsage?: AgentSessionTokenUsage | null;
  agentProfileId: AgentProfileId | null;
}

export type ProjectType = "game" | "widget";

export type WidgetSize = "128x160" | "128x128" | "128x64" | "64x32";

/** Supported physical widget display sizes (WxH string tokens). */
export const WIDGET_DISPLAY_SIZES: readonly WidgetSize[] = ["128x160", "128x128", "128x64", "64x32"];

export type MachineMcpQuestionMachine = {
  deviceId: string;
  name: string;
  model: string;
  ipAddress: string;
  ssid: string;
  updatedAt: string | null;
};

export type MachineMcpSubmitQuestionAnswerRequest =
  | { kind: "machine"; deviceId: string; ipAddress: string }
  | { kind: "manual_ip"; value: string };

export type MachineMcpSubmitQuestionAnswerResponse =
  | { ok: true }
  | { ok: false; reason: "no_pending" | "invalid_value" };

export type AgentQuestionOption = {
  value: string;
  label: string;
};

export type AgentQuestionPrompt = {
  question: string;
  options?: AgentQuestionOption[];
  allowFreeText?: boolean;
  freeTextPlaceholder?: string;
};

export type AgentQuestionAnswerRequest = {
  questionId: string;
  value: string;
};

export type AgentQuestionAnswerResponse =
  | { ok: true }
  | { ok: false; reason: "no_pending" | "stale_question" | "invalid_value" };

const TRANSCRIPT_USER_REQUEST_SECTION = "\n\nUser request:\n";

/**
 * Routed agent turns may append creation context before the human request.
 * The timeline only shows what the human typed.
 */
export function transcriptUserBubbleText(fullUserPrompt: string): string | null {
  const trimmed = fullUserPrompt.trim();
  if (!trimmed) {
    return null;
  }
  const markerAt = trimmed.lastIndexOf(TRANSCRIPT_USER_REQUEST_SECTION);
  const body =
    markerAt >= 0 ? trimmed.slice(markerAt + TRANSCRIPT_USER_REQUEST_SECTION.length).trim() : trimmed;
  if (!body) {
    return null;
  }

  return body;
}

export interface PickWorkspaceRequest {
  requireEmpty?: boolean;
}

export interface PickWorkspaceResponse {
  state: BootstrapState;
  selectedPath: string | null;
  accepted: boolean;
  reason?: "cancelled" | "non_empty";
}

export interface CustomProviderSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  apiFormat?: "auto" | "responses" | "chat_completion" | "claude" | "gemini";
}

export type ProviderId = "dartsnut-llm" | "custom";

export interface ProviderSettings {
  activeProvider: ProviderId;
  custom: CustomProviderSettings;
}

export type SaveProviderSettingsRequest = ProviderSettings;

export type AgentSdkStreamEvent =
  | {
    type: "text_delta";
    source?: string;
    delta: string;
  }
  | {
    type: "raw_model_stream_event";
    source?: string;
    data: unknown;
  }
  | {
    type: "run_item_stream_event";
    name: string;
    item: unknown;
  }
  | {
    type: "agent_updated_stream_event";
    agent: unknown;
  };

export type AgentEvent =
  | AgentSdkStreamEvent
  | AgentToolCallEvent
  | {
    type: "status";
    message: string;
    at: number;
  }
  | {
    type: "error";
    message: string;
    at: number;
  }
  | {
    type: "final";
    content: string;
    at: number;
  }
  | {
    type: "token_usage";
    at: number;
    runUsage: AgentTokenUsage;
    sessionUsage: AgentSessionTokenUsage;
  }
  | {
    type: "machine_mcp_prompt";
    at: number;
    /** When true, renderer asks the user which machine/IP to use for MCP. */
    visible: boolean;
    machines?: MachineMcpQuestionMachine[];
    manualOnly?: boolean;
  }
  | ({
    type: "agent_question";
    questionId: string;
    visible: boolean;
  } & AgentQuestionPrompt);

/** Result of classifying the workspace project files for deploy-to-machine eligibility. */
export type DeployEligibility =
  | { ok: true; appId: string; version: string; projectType: ProjectType }
  | { ok: false; reason: string };

export interface DeployConnectRequest {
  host: string;
}

export type DeployConnectResponse =
  | { ok: true; deviceName: string | null; deployMode: "safe_sideload" | "legacy_unsafe" }
  | { ok: false; error: string; needsLocalNetworkPermission?: true; canRetry?: true };

export type DeployConnectionState = {
  connected: boolean;
  connecting: boolean;
  host: string | null;
  deviceName: string | null;
  deployMode: "safe_sideload" | "legacy_unsafe" | null;
};

export type DeployActionResponse = { ok: true } | { ok: false; error: string };

export type DeployFrameEvent =
  | { active: false }
  | { active: true; frame: { width: number; height: number; rgbBase64: string; timestampMs: number } };

/** Optional payload for `deploy:run` / `deploy:reload` when the workspace is a widget. */
export interface DeployLaunchRequest {
  /** JSON object text; passed to the device as `main.py --params <json>`. */
  widgetParamsJson?: string;
}

export type CommunitySessionInfo = {
  loggedIn: boolean;
  account: string | null;
  analyticsUserId: string | null;
  authMethod: "password" | "google" | null;
  hasSupabase: boolean;
  googleClientId: string;
  googleDesktopClientId: string;
  googleSignInAvailable: boolean;
};

export type CommunityLoginRequest =
  | { method: "password"; account: string; password: string }
  | { method: "google"; idToken: string }
  | { method: "googleOAuth" };

export type CommunityLoginResponse =
  | { ok: true; account: string; needsPasswordSetup: boolean }
  | { ok: false; code: string; message: string };

export type CommunitySetPasswordRequest = { password: string };

export type CommunitySetPasswordResponse =
  | { ok: true; account: string }
  | { ok: false; code: string; message: string };

export type CommunityCancelGoogleLoginResponse = { ok: true };

export type CommunityLogoutResponse = { ok: true };

export type CommunityLlmQuotaStatus = {
  accountId: number;
  usageDate: string;
  inputTokens: number;
  outputTokens: number;
  usedTokens: number;
  customLimitTokens: number | null;
  limitTokens: number;
  defaultLimitTokens: number;
  remainingTokens: number;
  quotaExceeded: boolean;
  accountingHealth: string;
};

export type CommunityGetLlmQuotaResponse =
  | { ok: true; quota: CommunityLlmQuotaStatus }
  | { ok: false; code: string; message: string; serverMessage?: string; authRequired?: boolean };

export type CommunityDeployDevice = {
  deviceId: string;
  name: string;
  model: string;
  ipAddress: string;
  ssid: string;
  updatedAt: string | null;
};

export type CommunityListDeployDevicesResponse =
  | { ok: true; devices: CommunityDeployDevice[]; supabaseConfigured: boolean }
  | { ok: false; code: string; message: string; serverMessage?: string; authRequired?: boolean };

export type CommunityGameSummary = {
  id: number | string;
  gameId: string;
  gameName: string;
  mainCover: string;
  description: string;
  status: string;
  createdAt: string | null;
};

export type CommunityListMyGamesResponse =
  | { ok: true; games: CommunityGameSummary[]; total: number }
  | { ok: false; code: string; message: string; serverMessage?: string; authRequired?: boolean };

export type CommunityAppSummary = {
  id: number | string;
  appId: string;
  appName: string;
  projectType: ProjectType;
  mainCover: string;
  description: string;
  status: string;
  createdAt: string | null;
};

export type CommunityCategoryOption = {
  id: number | string;
  name: string;
};

export type CommunityControlOption = {
  value: string;
  label: string;
};

export type CommunitySizeOption = {
  value: string;
  label: string;
};

export type CommunityVersionSummary = {
  id: number | string;
  appSystemId: number | string;
  projectType: ProjectType;
  version: string;
  description: string;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
  reviewAction: string;
  reviewComment: string;
  reviewedAt: string | null;
  preview: string[];
};

export type CommunityWorkspaceDefaults = {
  eligible: boolean;
  appId: string;
  projectType: ProjectType | null;
  appName: string;
  version: string;
  description: string;
  widgetSize: string;
};

export type CommunityGetPublishOptionsResponse =
  | {
      ok: true;
      games: CommunityAppSummary[];
      widgets: CommunityAppSummary[];
      gameCategories: CommunityCategoryOption[];
      widgetCategories: CommunityCategoryOption[];
      gameControls: CommunityControlOption[];
      widgetControls: CommunityControlOption[];
      widgetSizes: CommunitySizeOption[];
      workspace: CommunityWorkspaceDefaults;
    }
  | { ok: false; code: string; message: string; serverMessage?: string; authRequired?: boolean };

export type CommunityListAppVersionsRequest = {
  projectType: ProjectType;
  appSystemId: number | string;
};

export type CommunityListAppVersionsResponse =
  | { ok: true; versions: CommunityVersionSummary[]; total: number }
  | { ok: false; code: string; message: string; serverMessage?: string; authRequired?: boolean };

export type CommunityCreateAppRequest = {
  projectType: ProjectType;
  mainCover: string;
  appName: string;
  appId: string;
  categoryId: number | string;
  minPersonal?: number | null;
  maxPersonal?: number | null;
  control: string[];
  widgetSize?: string;
};

export type CommunityCreateAppResponse =
  | { ok: true; app: CommunityAppSummary }
  | { ok: false; code: string; message: string; serverMessage?: string; authRequired?: boolean };

export type CommunityUploadNativeImageRequest = {
  filePath: string;
};

export type CommunityUploadNativeImageResponse =
  | { ok: true; url: string }
  | { ok: false; code: string; message: string; serverMessage?: string; authRequired?: boolean };

export type CommunitySubmitAppVersionRequest = {
  projectType: ProjectType;
  appSystemId: number | string;
  version: string;
  description: string;
  fields?: string;
  preview: string[];
};

export type CommunitySubmitProgressStage =
  | "creating"
  | "packaging"
  | "uploading"
  | "submitting"
  | "cleaning";

export type CommunitySubmitProgress = {
  stage: CommunitySubmitProgressStage;
  message: string;
};

export type CommunitySubmitAppVersionResponse =
  | {
      ok: true;
      versionId: number | string | null;
      status: string;
      downloadUrl: string;
      downloadMd5: string;
    }
  | { ok: false; code: string; message: string; serverMessage?: string; authRequired?: boolean };

export type CommunityUpdateWorkspaceVersionRequest = {
  version: string;
};

export type CommunityUpdateWorkspaceVersionResponse =
  | { ok: true; workspace: CommunityWorkspaceDefaults }
  | {
      ok: false;
      code: "no_workspace" | "invalid_version" | "invalid_workspace" | "write_failed";
      message: string;
    };

export type CommunityWithdrawAppVersionRequest = {
  projectType: ProjectType;
  versionId: number | string;
};

export type CommunityWithdrawAppVersionResponse =
  | { ok: true; status: string }
  | { ok: false; code: string; message: string; serverMessage?: string; authRequired?: boolean };
