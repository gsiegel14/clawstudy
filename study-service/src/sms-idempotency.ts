export type SmsIntent = 'start' | 'q1' | 'answer';

export interface SmsIdempotencyInput {
  fromPhone: string;
  messageSid: string;
  intent: SmsIntent;
  chapterId?: string;
  sessionId?: string;
  questionId?: string;
}

export function deriveSmsIdempotencyKey(input: SmsIdempotencyInput): string {
  const fromPhone = String(input.fromPhone).trim();
  const messageSid = String(input.messageSid).trim();

  if (!fromPhone || !messageSid) {
    throw new Error('fromPhone and messageSid are required');
  }

  if (input.intent === 'start') {
    if (!input.chapterId) {
      throw new Error('chapterId is required for start intent');
    }
    return `sms:${fromPhone}:${messageSid}:start:${input.chapterId}`;
  }

  if (input.intent === 'q1') {
    if (!input.chapterId) {
      throw new Error('chapterId is required for q1 intent');
    }
    return `sms:${fromPhone}:${messageSid}:q1:${input.chapterId}`;
  }

  if (!input.sessionId || !input.questionId) {
    throw new Error('sessionId and questionId are required for answer intent');
  }

  return `sms:${fromPhone}:${messageSid}:answer:${input.sessionId}:${input.questionId}`;
}
