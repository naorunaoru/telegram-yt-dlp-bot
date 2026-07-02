export const FAILURE_REACTION_EMOJI = "😢";

export const isGroupChatType = (chatType?: string): boolean =>
  chatType === "group" || chatType === "supergroup";

interface ReactionContextLike {
  chat?: {
    id: number | string;
    type?: string;
  };
  message?: {
    message_id: number;
  };
  telegram: {
    callApi: (method: "setMessageReaction", payload: any) => Promise<unknown>;
  };
}

export const reactSadOnFailure = async (
  ctx: ReactionContextLike
): Promise<boolean> => {
  if (!isGroupChatType(ctx.chat?.type) || !ctx.chat || !ctx.message) {
    return false;
  }

  try {
    await ctx.telegram.callApi("setMessageReaction", {
      chat_id: ctx.chat.id,
      message_id: ctx.message.message_id,
      reaction: [
        {
          type: "emoji",
          emoji: FAILURE_REACTION_EMOJI,
        },
      ],
      is_big: false,
    });
    return true;
  } catch {
    return false;
  }
};
