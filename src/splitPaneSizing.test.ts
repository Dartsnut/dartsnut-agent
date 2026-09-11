import { afterEach, describe, expect, it } from "vitest";
import {
  CHAT_PANE_RATIO_STORAGE_KEY,
  DEFAULT_CHAT_PANE_WIDTH,
  DEFAULT_WORKSPACE_MENU_WIDTH,
  MAX_WORKSPACE_MENU_WIDTH,
  MIN_CHAT_PANE_WIDTH,
  MIN_WORKSPACE_MENU_WIDTH,
  WORKSPACE_MENU_WIDTH_STORAGE_KEY,
  WORKSPACE_MENU_COLLAPSED_STORAGE_KEY,
  chatPaneRatioFromWidth,
  chatPaneWidthFromRatio,
  clampChatPaneRatio,
  clampWorkspaceMenuWidth,
  getStoredChatPaneWidth,
  getStoredChatPaneRatio,
  getStoredWorkspaceMenuWidth,
  getStoredWorkspaceMenuCollapsed,
  nextWorkspaceMenuWidthFromDrag,
  setStoredChatPaneRatio,
  setStoredWorkspaceMenuWidth,
  setStoredWorkspaceMenuCollapsed
} from "./splitPaneSizing";

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

describe("split pane sizing", () => {
it("legacy chat pane width remains readable for ratio compatibility", () => {
  const values = new Map<string, string>();
  global.window = {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    }
  } as unknown as Window & typeof globalThis;

  values.set("dartsnut-chat-pane-width", "732");

  expect(getStoredChatPaneWidth()).toBe(732);
});

it("invalid or unavailable stored widths use the default", () => {
  global.window = {
    localStorage: {
      getItem: () => "not-a-width",
      setItem: () => undefined
    }
  } as unknown as Window & typeof globalThis;

  expect(getStoredChatPaneWidth()).toBe(DEFAULT_CHAT_PANE_WIDTH);
});

it("workspace menu width clamps and follows pointer movement", () => {
  expect(clampWorkspaceMenuWidth(100)).toBe(MIN_WORKSPACE_MENU_WIDTH);
  expect(clampWorkspaceMenuWidth(900)).toBe(MAX_WORKSPACE_MENU_WIDTH);
  expect(nextWorkspaceMenuWidthFromDrag({
    startClientX: 280,
    currentClientX: 340,
    startWidth: DEFAULT_WORKSPACE_MENU_WIDTH
  })).toBe(DEFAULT_WORKSPACE_MENU_WIDTH + 60);
});

it("chat and emulator panes preserve ratio as panel width changes", () => {
  const ratio = chatPaneRatioFromWidth(680, 1280);
  expect(chatPaneWidthFromRatio(ratio, 960)).toBe(510);
  expect(chatPaneWidthFromRatio(ratio, 1440)).toBe(765);
});

it("temporary minimum clamp does not replace the preferred ratio", () => {
  const preferredRatio = 0.55;
  expect(chatPaneWidthFromRatio(preferredRatio, 700)).toBe(340);
  expect(chatPaneWidthFromRatio(preferredRatio, 1000)).toBe(550);
});

it("chat ratio keeps both pane minimums", () => {
  expect(chatPaneWidthFromRatio(0, 1000)).toBe(MIN_CHAT_PANE_WIDTH);
  expect(chatPaneWidthFromRatio(1, 1000)).toBe(640);
  expect(clampChatPaneRatio(0.5, 500)).toBe(0.64);
});

it("chat pane ratio round-trips through local storage", () => {
  const values = new Map<string, string>();
  global.window = {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    }
  } as unknown as Window & typeof globalThis;

  setStoredChatPaneRatio(0.53125);

  expect(values.get(CHAT_PANE_RATIO_STORAGE_KEY)).toBe("0.53125");
  expect(getStoredChatPaneRatio()).toBe(0.53125);
});

it("workspace menu width round-trips through local storage", () => {
  const values = new Map<string, string>();
  global.window = {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    }
  } as unknown as Window & typeof globalThis;

  setStoredWorkspaceMenuWidth(311.6);

  expect(values.get(WORKSPACE_MENU_WIDTH_STORAGE_KEY)).toBe("312");
  expect(getStoredWorkspaceMenuWidth()).toBe(312);
});

it("workspace menu collapsed state round-trips through local storage", () => {
  const values = new Map<string, string>();
  global.window = {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    }
  } as unknown as Window & typeof globalThis;

  setStoredWorkspaceMenuCollapsed(true);

  expect(values.get(WORKSPACE_MENU_COLLAPSED_STORAGE_KEY)).toBe("true");
  expect(getStoredWorkspaceMenuCollapsed()).toBe(true);
});
});
