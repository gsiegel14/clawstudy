export type TelegramIntent = 'start' | 'q1' | 'answer';

export interface TelegramIdempotencyInput {
  chatId: string | number;
  messageId: string | number;
  intent: TelegramIntent;
  chapterId?: string;
  sessionId?: string;
  questionId?: string;
}

export function deriveTelegramIdempotencyKey(input: TelegramIdempotencyInput): string {
  const chatId = String(input.chatId).trim();
  const messageId = String(input.messageId).trim();

  if (!chatId || !messageId) {
    throw new Error('chatId and messageId are required');
  }

  if (input.intent === 'start') {
    if (!input.chapterId) {
      throw new Error('chapterId is required for start intent');
    }
    return `tg:${chatId}:${messageId}:start:${input.chapterId}`;
  }

  if (input.intent === 'q1') {
    if (!input.chapterId) {
      throw new Error('chapterId is required for q1 intent');
    }
    return `tg:${chatId}:${messageId}:q1:${input.chapterId}`;
  }

  if (!input.sessionId || !input.questionId) {
    throw new Error('sessionId and questionId are required for answer intent');
  }

  return `tg:${chatId}:${messageId}:answer:${input.sessionId}:${input.questionId}`;
}
