import { describe, expect, it } from "vitest";
import {
  chatPersonaReducer,
  INITIAL_CHAT_PERSONA_STATE,
  readyAgentProfileId,
  type ChatPersonaState
} from "./useChatPersonaController";

function hydrate(state: ChatPersonaState, profileId: unknown): ChatPersonaState {
  if (state.phase !== "hydrating") throw new Error("Expected hydrating state.");
  return chatPersonaReducer(state, {
    type: "hydrated",
    chatId: state.chatId,
    generation: state.generation,
    profileId
  });
}

describe("chat persona controller", () => {
  it("starts in picker with or without a selected project", () => {
    expect(chatPersonaReducer(INITIAL_CHAT_PERSONA_STATE, {
      type: "bootstrap", activeProjectId: null, activeChatId: null
    }).phase).toBe("picking");
    expect(chatPersonaReducer(INITIAL_CHAT_PERSONA_STATE, {
      type: "bootstrap", activeProjectId: "project-1", activeChatId: null
    })).toMatchObject({ phase: "picking", projectId: "project-1" });
  });

  it("hydrates existing chats and uses Export only after null metadata resolves", () => {
    const hydrating = chatPersonaReducer(INITIAL_CHAT_PERSONA_STATE, {
      type: "bootstrap", activeProjectId: "project-1", activeChatId: "chat-1"
    });
    expect(hydrating).toMatchObject({ phase: "hydrating", chatId: "chat-1" });
    expect(hydrate(hydrating, null)).toMatchObject({
      phase: "ready", chatId: "chat-1", profileId: "export"
    });
  });

  it("normalizes invalid persisted metadata to Export", () => {
    const hydrating = chatPersonaReducer(INITIAL_CHAT_PERSONA_STATE, {
      type: "bootstrap", activeProjectId: "project-1", activeChatId: "chat-1"
    });
    expect(hydrate(hydrating, "unknown-profile")).toMatchObject({ profileId: "export" });
  });

  it("preserves ready persona across same-chat bootstrap refreshes", () => {
    const ready: ChatPersonaState = {
      phase: "ready", generation: 4, chatId: "chat-1", profileId: "child-curious"
    };
    expect(chatPersonaReducer(ready, {
      type: "bootstrap", activeProjectId: "project-1", activeChatId: "chat-1"
    })).toBe(ready);
  });

  it("never exposes one chat's persona as another chat's hint", () => {
    const ready: ChatPersonaState = {
      phase: "ready", generation: 4, chatId: "chat-a", profileId: "child-curious"
    };
    expect(readyAgentProfileId(ready, "chat-a")).toBe("child-curious");
    expect(readyAgentProfileId(ready, "chat-b")).toBeNull();
    expect(readyAgentProfileId(ready, null)).toBeNull();
  });

  it.each([
    "child-creator",
    "teen-builder",
    "adult-vibe",
    "export"
  ] as const)("keeps the hydrated %s profile attached to its chat", (profileId) => {
    const hydrating = chatPersonaReducer(INITIAL_CHAT_PERSONA_STATE, {
      type: "bootstrap", activeProjectId: "project-1", activeChatId: "chat-1"
    });
    const ready = hydrate(hydrating, profileId);
    expect(readyAgentProfileId(ready, "chat-1")).toBe(profileId);
  });

  it("ignores stale hydration, including A to B to A switching", () => {
    const firstA = chatPersonaReducer(INITIAL_CHAT_PERSONA_STATE, {
      type: "bootstrap", activeProjectId: "project-1", activeChatId: "chat-a"
    });
    const chatB = chatPersonaReducer(firstA, {
      type: "bootstrap", activeProjectId: "project-1", activeChatId: "chat-b"
    });
    const secondA = chatPersonaReducer(chatB, {
      type: "bootstrap", activeProjectId: "project-1", activeChatId: "chat-a"
    });
    if (firstA.phase !== "hydrating" || secondA.phase !== "hydrating") throw new Error("Expected hydration.");
    const stale = chatPersonaReducer(secondA, {
      type: "hydrated",
      chatId: firstA.chatId,
      generation: firstA.generation,
      profileId: "teen-builder"
    });
    expect(stale).toBe(secondA);
    expect(hydrate(secondA, "adult-vibe")).toMatchObject({ profileId: "adult-vibe" });
  });

  it("creates a persona-bound chat for an active project", () => {
    let state = chatPersonaReducer(INITIAL_CHAT_PERSONA_STATE, {
      type: "new-chat", projectId: "project-1"
    });
    state = chatPersonaReducer(state, { type: "profile-selected", profileId: "teen-explorer" });
    expect(state).toMatchObject({ phase: "creating-chat", profileId: "teen-explorer" });
    state = chatPersonaReducer(state, {
      type: "creation-succeeded", chatId: "chat-1", profileId: "teen-explorer"
    });
    expect(state).toMatchObject({ phase: "ready", chatId: "chat-1", profileId: "teen-explorer" });
  });

  it("returns to picker when project creation is cancelled", () => {
    let state = chatPersonaReducer(INITIAL_CHAT_PERSONA_STATE, {
      type: "new-chat", projectId: null
    });
    state = chatPersonaReducer(state, { type: "profile-selected", profileId: "adult-shipper" });
    state = chatPersonaReducer(state, { type: "project-creation-cancelled" });
    expect(state).toMatchObject({ phase: "picking", projectId: null });
  });

  it("never opens the picker for a Scratch workspace", () => {
    const state = chatPersonaReducer(INITIAL_CHAT_PERSONA_STATE, {
      type: "bootstrap", activeProjectId: "project-1", activeChatId: null, projectKind: "scratch"
    });
    expect(state).toMatchObject({ phase: "no-chat", projectId: "project-1" });
    expect(state.phase).not.toBe("picking");
    expect(readyAgentProfileId(state, null)).toBeNull();
  });

  it("stays out of the picker when a Scratch project is selected again", () => {
    let state = chatPersonaReducer(INITIAL_CHAT_PERSONA_STATE, {
      type: "bootstrap", activeProjectId: "project-1", activeChatId: null, projectKind: "scratch"
    });
    state = chatPersonaReducer(state, { type: "new-chat", projectId: "project-1" });
    expect(state.phase).toBe("no-chat");
  });

  it("is idempotent for a repeated Scratch bootstrap", () => {
    const first = chatPersonaReducer(INITIAL_CHAT_PERSONA_STATE, {
      type: "bootstrap", activeProjectId: "project-1", activeChatId: null, projectKind: "scratch"
    });
    expect(chatPersonaReducer(first, {
      type: "bootstrap", activeProjectId: "project-1", activeChatId: null, projectKind: "scratch"
    })).toBe(first);
  });

  it("leaves the no-chat phase once a Python workspace is selected", () => {
    const scratch = chatPersonaReducer(INITIAL_CHAT_PERSONA_STATE, {
      type: "bootstrap", activeProjectId: "project-1", activeChatId: null, projectKind: "scratch"
    });
    // Bootstrap without a chat lands in idle for every kind; selection then asks
    // for a new chat, which is what opens the picker.
    const python = chatPersonaReducer(scratch, {
      type: "bootstrap", activeProjectId: "project-2", activeChatId: null, projectKind: "python"
    });
    expect(python).toMatchObject({ phase: "idle", projectId: "project-2" });
    expect(chatPersonaReducer(python, {
      type: "new-chat", projectId: "project-2"
    })).toMatchObject({ phase: "picking", projectId: "project-2" });
  });

  it("keeps a Python workspace picking exactly as before", () => {
    expect(chatPersonaReducer(INITIAL_CHAT_PERSONA_STATE, {
      type: "bootstrap", activeProjectId: "project-1", activeChatId: null, projectKind: "python"
    })).toMatchObject({ phase: "picking", projectId: "project-1" });
  });

  it("archives into idle state instead of reopening picker", () => {
    const ready: ChatPersonaState = {
      phase: "ready", generation: 2, chatId: "chat-1", profileId: "child-creator"
    };
    expect(chatPersonaReducer(ready, {
      type: "active-chat-archived", projectId: "project-1"
    })).toMatchObject({ phase: "idle", projectId: "project-1" });
  });
});
