import type { Choice } from './types';

export interface StartSessionBody {
  schema_version: string;
  chapter_id: string;
  user_id?: string;
  telegram_user_id?: string;
  telegram_chat_id?: string;
  telegram_chat_type?: string;
}

export interface AnswerBody {
  schema_version: string;
  question_id: string;
  selected_choice: string | number;
  response_time_seconds?: number;
  confidence?: number;
}

export interface UploadUrlBody {
  schema_version: string;
  filename: string;
  content_type: string;
  sha256?: string;
  source_label?: string;
  chapter_id?: string;
}

export interface CompleteSourceBody {
  schema_version: string;
}

function asObject(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  return input as Record<string, unknown>;
}

export function requireSchemaVersion(body: Record<string, unknown>): string {
  const value = body.schema_version;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('schema_version is required');
  }
  return value;
}

export function parseUploadUrlBody(input: unknown): UploadUrlBody {
  const body = asObject(input);
  if (!body) {
    throw new Error('request body must be a JSON object');
  }

  const schemaVersion = requireSchemaVersion(body);
  const filename = body.filename;
  const contentType = body.content_type;
  const sha256 = body.sha256;
  const sourceLabel = body.source_label;
  const chapterId = body.chapter_id;

  if (typeof filename !== 'string' || filename.trim().length === 0) {
    throw new Error('filename is required');
  }
  if (typeof contentType !== 'string' || contentType !== 'application/pdf') {
    throw new Error('content_type must be application/pdf');
  }

  if (sha256 !== undefined && (typeof sha256 !== 'string' || sha256.length !== 64)) {
    throw new Error('sha256 must be a 64-character hex string when provided');
  }

  if (sourceLabel !== undefined && (typeof sourceLabel !== 'string' || sourceLabel.trim().length === 0)) {
    throw new Error('source_label must be a non-empty string when provided');
  }

  if (chapterId !== undefined && (typeof chapterId !== 'string' || chapterId.trim().length === 0)) {
    throw new Error('chapter_id must be a non-empty string when provided');
  }

  return {
    schema_version: schemaVersion,
    filename: filename.trim(),
    content_type: contentType,
    sha256: typeof sha256 === 'string' ? sha256 : undefined,
    source_label: typeof sourceLabel === 'string' ? sourceLabel.trim() : undefined,
    chapter_id: typeof chapterId === 'string' ? chapterId.trim() : undefined,
  };
}

export function parseCompleteSourceBody(input: unknown): CompleteSourceBody {
  const body = asObject(input);
  if (!body) {
    throw new Error('request body must be a JSON object');
  }

  return {
    schema_version: requireSchemaVersion(body),
  };
}

export function parseStartSessionBody(input: unknown): StartSessionBody {
  const body = asObject(input);
  if (!body) {
    throw new Error('request body must be a JSON object');
  }

  const schemaVersion = requireSchemaVersion(body);
  const chapterId = body.chapter_id;
  const userId = body.user_id;
  const telegramUserId = body.telegram_user_id;
  const telegramChatId = body.telegram_chat_id;
  const telegramChatType = body.telegram_chat_type;

  if (typeof chapterId !== 'string' || chapterId.trim().length === 0) {
    throw new Error('chapter_id is required');
  }

  if (
    userId !== undefined &&
    (typeof userId !== 'string' || userId.trim().length === 0)
  ) {
    throw new Error('user_id must be a non-empty string when provided');
  }

  if (
    telegramUserId !== undefined &&
    (typeof telegramUserId !== 'string' || telegramUserId.trim().length === 0)
  ) {
    throw new Error('telegram_user_id must be a non-empty string when provided');
  }

  if (
    telegramChatId !== undefined &&
    (typeof telegramChatId !== 'string' || telegramChatId.trim().length === 0)
  ) {
    throw new Error('telegram_chat_id must be a non-empty string when provided');
  }

  if (
    telegramChatType !== undefined &&
    (typeof telegramChatType !== 'string' || telegramChatType.trim().length === 0)
  ) {
    throw new Error('telegram_chat_type must be a non-empty string when provided');
  }

  if (!userId && !telegramUserId) {
    throw new Error('either user_id or telegram_user_id must be provided');
  }

  return {
    schema_version: schemaVersion,
    chapter_id: chapterId.trim(),
    user_id: typeof userId === 'string' ? userId.trim() : undefined,
    telegram_user_id: typeof telegramUserId === 'string' ? telegramUserId.trim() : undefined,
    telegram_chat_id: typeof telegramChatId === 'string' ? telegramChatId.trim() : undefined,
    telegram_chat_type: typeof telegramChatType === 'string' ? telegramChatType.trim() : undefined,
  };
}

export function parseAnswerBody(input: unknown): AnswerBody {
  const body = asObject(input);
  if (!body) {
    throw new Error('request body must be a JSON object');
  }

  const schemaVersion = requireSchemaVersion(body);
  const questionId = body.question_id;

  if (typeof questionId !== 'string' || questionId.trim().length === 0) {
    throw new Error('question_id is required');
  }

  const selectedChoice = body.selected_choice;
  if (
    selectedChoice === undefined ||
    (typeof selectedChoice !== 'string' && typeof selectedChoice !== 'number')
  ) {
    throw new Error('selected_choice is required and must be string or number');
  }

  const responseTime = body.response_time_seconds;
  const confidence = body.confidence;
  if (
    responseTime !== undefined &&
    (typeof responseTime !== 'number' || !Number.isFinite(responseTime) || responseTime < 0)
  ) {
    throw new Error('response_time_seconds must be a finite number >= 0 when provided');
  }

  if (
    confidence !== undefined &&
    (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1)
  ) {
    throw new Error('confidence must be a finite number between 0 and 1 when provided');
  }

  return {
    schema_version: schemaVersion,
    question_id: questionId.trim(),
    selected_choice: selectedChoice,
    response_time_seconds: typeof responseTime === 'number' ? responseTime : undefined,
    confidence: typeof confidence === 'number' ? confidence : undefined,
  };
}

export function normalizeChoice(rawChoice: string | number): Choice | null {
  const value = String(rawChoice).trim().toUpperCase();

  if (value === 'A' || value === '1') {
    return 'A';
  }
  if (value === 'B' || value === '2') {
    return 'B';
  }
  if (value === 'C' || value === '3') {
    return 'C';
  }
  if (value === 'D' || value === '4') {
    return 'D';
  }

  return null;
}
