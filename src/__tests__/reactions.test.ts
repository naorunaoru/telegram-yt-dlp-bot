import { describe, expect, it, vi } from "vitest";
import {
  FAILURE_REACTION_EMOJI,
  isGroupChatType,
  reactSadOnFailure,
} from "../helpers/reactions.js";

describe("isGroupChatType", () => {
  it("recognizes Telegram group chats", () => {
    expect(isGroupChatType("group")).toBe(true);
    expect(isGroupChatType("supergroup")).toBe(true);
  });

  it("ignores non-group chats", () => {
    expect(isGroupChatType("private")).toBe(false);
    expect(isGroupChatType("channel")).toBe(false);
    expect(isGroupChatType(undefined)).toBe(false);
  });
});

describe("reactSadOnFailure", () => {
  it("sets a sad reaction for group messages", async () => {
    const callApi = vi.fn().mockResolvedValue(true);

    const result = await reactSadOnFailure({
      chat: { id: -100123, type: "supergroup" },
      message: { message_id: 42 },
      telegram: { callApi },
    });

    expect(result).toBe(true);
    expect(callApi).toHaveBeenCalledWith("setMessageReaction", {
      chat_id: -100123,
      message_id: 42,
      reaction: [{ type: "emoji", emoji: FAILURE_REACTION_EMOJI }],
      is_big: false,
    });
  });

  it("does nothing in private chats", async () => {
    const callApi = vi.fn();

    const result = await reactSadOnFailure({
      chat: { id: 123, type: "private" },
      message: { message_id: 42 },
      telegram: { callApi },
    });

    expect(result).toBe(false);
    expect(callApi).not.toHaveBeenCalled();
  });

  it("swallows Telegram API errors", async () => {
    const callApi = vi.fn().mockRejectedValue(new Error("no reactions here"));

    const result = await reactSadOnFailure({
      chat: { id: -100123, type: "group" },
      message: { message_id: 42 },
      telegram: { callApi },
    });

    expect(result).toBe(false);
  });
});
