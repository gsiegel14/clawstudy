import { Hono, type Context } from 'hono';
import { D1IdempotencyStore, InMemoryIdempotencyStore, sha256Hex } from './idempotency';
import { DEFAULT_SCHEMA_VERSION, jsonError, jsonResponse, schemaVersion } from './errors';
import { deriveSmsIdempotencyKey } from './sms-idempotency';
import { D1StudyStore, InMemoryStudyStore } from './store';
import { deriveTelegramIdempotencyKey } from './telegram-idempotency';
import { buildAnswerFeedback, buildImageDescription, buildQuestionText } from './telegram';
import { verifyTwilioWebhookSignature } from './twilio-signature';
import { normalizeChoice, parseAnswerBody, parseCompleteSourceBody, parseStartSessionBody, parseUploadUrlBody } from './validation';
import type { Env, IdempotencyStore, QuizQuestion, StudyStore } from './types';
import { planTelegramAgentRoute, resolveChapterIdFromName, runAgentWithTools, isStudyAgentEnabled } from './study-agent';
import type { AgentPlanner, AgentMissSnapshot, AgentToolExecutor } from './study-agent';

interface AppDependencies {
  store?: StudyStore;
  idempotencyStore?: IdempotencyStore;
  now?: () => Date;
  agentPlanner?: AgentPlanner;
}

interface JsonResult {
  status: number;
  payload: Record<string, unknown>;
}

const IDEMPOTENCY_TTL_SECONDS = 7 * 24 * 60 * 60;

function buildStore(c: { env: Env }, deps: AppDependencies): StudyStore {
  if (deps.store) {
    return deps.store;
  }
  if (c.env.DB) {
    return new D1StudyStore(c.env.DB);
  }
  return new InMemoryStudyStore();
}

function buildIdempotencyStore(c: { env: Env }, deps: AppDependencies): IdempotencyStore {
  if (deps.idempotencyStore) {
    return deps.idempotencyStore;
  }
  if (c.env.DB) {
    return new D1IdempotencyStore(c.env.DB);
  }
  return new InMemoryIdempotencyStore();
}

function toQuestionPayload(question: QuizQuestion): Record<string, unknown> {
  return {
    question_id: question.questionId,
    stem: question.stem,
    choices: question.choices,
    image_ref: question.imageRef,
    source_chunk_ids: question.sourceChunkIds,
    source_id: question.sourceId ?? null,
    topic: question.topic ?? 'unknown',
    difficulty: question.difficulty ?? 'medium',
  };
}

function nowIso(deps: AppDependencies): string {
  return (deps.now ? deps.now() : new Date()).toISOString();
}

function buildAgentPlanner(deps: AppDependencies): AgentPlanner {
  return deps.agentPlanner ?? planTelegramAgentRoute;
}

function resolveDecisionChapterId(chapterId: string | null, chapterName: string | null): string | null {
  if (chapterId) return chapterId;
  if (chapterName) return resolveChapterIdFromName(chapterName);
  return null;
}

function formatMissesMessage(misses: AgentMissSnapshot[], limit: number): string {
  const items = misses.slice(0, limit);
  if (items.length === 0) return 'No recent misses — great work!';
  const lines = items.map((m, i) => {
    const stem = m.stem.replace(/\s+/g, ' ').trim().slice(0, 120);
    return `${i + 1}. [${m.chapterId}] ${stem}\n   You chose ${m.selectedChoice}, correct was ${m.correctChoice}.`;
  });
  return `Recent misses (${items.length}):\n${lines.join('\n')}`;
}

function formatLastMissMessage(miss: AgentMissSnapshot | null): string {
  if (!miss) return 'No misses recorded yet.';
  const stem = miss.stem.replace(/\s+/g, ' ').trim().slice(0, 200);
  return `Last miss [${miss.chapterId}]:\n${stem}\nYou chose ${miss.selectedChoice}, correct was ${miss.correctChoice}.\n${miss.explanation.slice(0, 300)}`;
}

function buildToolExecutor(store: StudyStore, userId: string): AgentToolExecutor {
  return {
    async checkChapterStatus(chapterId) {
      const src = await store.getSourceByChapterId(chapterId);
      if (!src) return { found: false, questionCount: 0, ingestStatus: null };
      return { found: true, questionCount: src.questionCount, ingestStatus: src.ingestStatus };
    },

    async queueChapterIngest(chapterId) {
      const src = await store.getSourceByChapterId(chapterId);
      if (!src) return { success: false, alreadyDone: false, alreadyInProgress: false, noSourceFound: true };
      if (src.questionCount > 0) return { success: false, alreadyDone: true, alreadyInProgress: false, noSourceFound: false };
      if (src.ingestStatus === 'processing' || src.ingestStatus === 'queued') {
        return { success: false, alreadyDone: false, alreadyInProgress: true, noSourceFound: false };
      }
      try {
        await store.completeSource(src.sourceId);
        return { success: true, alreadyDone: false, alreadyInProgress: false, noSourceFound: false };
      } catch {
        return { success: false, alreadyDone: false, alreadyInProgress: false, noSourceFound: false };
      }
    },

    async getRecentMisses(limit) {
      const attempts = await store.listRecentAttempts(userId, 20);
      const missed = attempts.filter((a) => !a.isCorrect).slice(0, limit);
      const misses = await Promise.all(
        missed.map(async (a) => {
          const q = await store.getQuestionById(a.questionId);
          return {
            chapterId: a.chapterId,
            topic: a.topic,
            selectedChoice: a.selectedChoice,
            correctChoice: q?.correctChoice ?? '?',
            stem: (q?.stem ?? '').slice(0, 120),
          };
        }),
      );
      return { misses };
    },

    async checkSessionReady(chapterId) {
      const src = await store.getSourceByChapterId(chapterId);
      const questionCount = src?.questionCount ?? 0;
      const firstQuestion = questionCount > 0 ? await store.getQuestionByIndex(chapterId, 0) : null;
      return { questionsAvailable: firstQuestion !== null, questionCount };
    },

    async getProgressSummary() {
      const [progress, mastery] = await Promise.all([store.listProgress(userId), store.listTopicMastery(userId)]);
      const totalAnswered = progress.reduce((sum, p) => sum + p.questionsAnswered, 0);
      const totalCorrect = progress.reduce((sum, p) => sum + p.questionsCorrect, 0);
      const accuracy = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : null;
      const weakTopics = mastery
        .filter((t) => t.weaknessRank !== null)
        .sort((a, b) => (a.weaknessRank ?? 999) - (b.weaknessRank ?? 999))
        .slice(0, 3)
        .map((t) => t.topic);
      return {
        totalAnswered,
        accuracy,
        chaptersStudied: progress.filter((p) => p.questionsAnswered > 0).length,
        topWeakTopics: weakTopics,
      };
    },
  };
}

function resolveR2Key(imageRef: string): string {
  if (imageRef.startsWith('r2://')) {
    const withoutProtocol = imageRef.replace(/^r2:\/\//, '');
    const firstSlash = withoutProtocol.indexOf('/');
    if (firstSlash === -1) {
      return withoutProtocol;
    }
    return withoutProtocol.slice(firstSlash + 1);
  }
  return imageRef;
}

async function sendTelegramMessage(env: Env, chatId: string, text: string): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return;
  }

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
    }),
  });
}

function buildTelegramImageFallbackText(questionText: string, imageDescription: string | null): string {
  const note = imageDescription
    ? `Image unavailable. Image description: ${imageDescription}`
    : 'Image unavailable. This question references an ultrasound figure.';
  return `${questionText}\n\n${note}`;
}

async function sendTelegramQuestion(env: Env, input: {
  chatId: string;
  questionText: string;
  imageRef: string | null;
  imageDescription: string | null;
}): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return;
  }

  const fallbackText = buildTelegramImageFallbackText(input.questionText, input.imageDescription);

  if (!input.imageRef) {
    await sendTelegramMessage(env, input.chatId, input.questionText);
    return;
  }

  try {
    const key = resolveR2Key(input.imageRef);
    const object = await env.STUDY_ASSETS.get(key);
    if (!object) {
      await sendTelegramMessage(env, input.chatId, fallbackText);
      return;
    }

    const contentType = object.httpMetadata?.contentType ?? 'image/jpeg';
    const bytes = await object.arrayBuffer();

    // Telegram limits photos to 10 MB
    const TEN_MB = 10 * 1024 * 1024;
    if (bytes.byteLength > TEN_MB) {
      console.warn('telegram_image_too_large', { key, bytes: bytes.byteLength });
      await sendTelegramMessage(env, input.chatId, fallbackText);
      return;
    }

    const filename = key.split('/').pop() || 'question-image.jpg';
    const formData = new FormData();
    formData.append('chat_id', input.chatId);
    formData.append('caption', input.questionText);
    formData.append('photo', new Blob([bytes], { type: contentType }), filename);

    const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      console.warn('telegram_sendPhoto_failed', { key, status: response.status, body: errorBody });
      await sendTelegramMessage(env, input.chatId, fallbackText);
    }
  } catch {
    await sendTelegramMessage(env, input.chatId, fallbackText);
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function smsTwiMlResponse(messages: string[]): Response {
  const body = messages
    .map((message) => `  <Message>${escapeXml(message)}</Message>`)
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n${body}\n</Response>`;
  return new Response(xml, {
    status: 200,
    headers: {
      'content-type': 'text/xml; charset=utf-8',
    },
  });
}

function toStringMap(input: Record<string, string | File>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') {
      output[key] = value;
    }
  }
  return output;
}

function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function truncateText(input: string, maxChars: number): string {
  if (input.length <= maxChars) {
    return input;
  }
  return `${input.slice(0, maxChars - 1).trim()}…`;
}

interface SourceContextSnippet {
  chunkId: string;
  sourceId: string | null;
  topicTag: string | null;
  excerpt: string;
}

function buildDetailedExplanation(input: {
  brief: string;
  sourceContexts: Array<{ chunkId: string; sourceId: string | null; topicTag: string | null; text: string }>;
}): {
  explanationDetailed: string;
  sourceContextSnippets: SourceContextSnippet[];
} {
  const sourceContextSnippets = input.sourceContexts
    .slice(0, 2)
    .map((context) => ({
      chunkId: context.chunkId,
      sourceId: context.sourceId,
      topicTag: context.topicTag,
      excerpt: truncateText(collapseWhitespace(context.text), 320),
    }))
    .filter((snippet) => snippet.excerpt.length > 0);

  if (sourceContextSnippets.length === 0) {
    return {
      explanationDetailed: input.brief,
      sourceContextSnippets: [],
    };
  }

  const contextLines = sourceContextSnippets.map((context, index) => {
    const sourcePart = context.sourceId ? `source ${context.sourceId}` : 'source unknown';
    const topicPart = context.topicTag ? `, topic ${context.topicTag}` : '';
    return `${index + 1}. [${context.chunkId}] (${sourcePart}${topicPart}) ${context.excerpt}`;
  });

  const explanationDetailed = truncateText(
    [input.brief, 'Deep Dive from chapter context:', ...contextLines].join('\n'),
    2600,
  );

  return {
    explanationDetailed,
    sourceContextSnippets,
  };
}

async function withIdempotentJson(
  c: Context<{ Bindings: Env }>,
  deps: AppDependencies,
  endpoint: string,
  execute: (body: unknown, idempotencyKey: string, nowIsoValue: string) => Promise<JsonResult>,
): Promise<Response> {
  const idempotencyKey = c.req.header('Idempotency-Key');
  if (!idempotencyKey || idempotencyKey.trim().length === 0) {
    return jsonError(c, 400, 'MISSING_IDEMPOTENCY_KEY', 'Idempotency-Key header is required');
  }

  const rawBody = await c.req.text();
  const normalizedBodyText = rawBody.length > 0 ? rawBody : '{}';
  const requestHash = await sha256Hex(normalizedBodyText);
  const nowIsoValue = nowIso(deps);

  const idemStore = buildIdempotencyStore(c, deps);
  const existing = await idemStore.get(idempotencyKey, endpoint);
  if (existing) {
    if (existing.requestHash !== requestHash) {
      return jsonError(c, 409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key reused with different request payload');
    }

    try {
      const payload = JSON.parse(existing.responseJson) as Record<string, unknown>;
      return jsonResponse(payload, existing.statusCode);
    } catch {
      return jsonError(c, 500, 'IDEMPOTENCY_RECORD_ERROR', 'Stored idempotency response is invalid JSON');
    }
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(normalizedBodyText);
  } catch {
    return jsonError(c, 400, 'INVALID_JSON', 'Request body must be valid JSON');
  }

  const result = await execute(parsedBody, idempotencyKey, nowIsoValue);
  await idemStore.put({
    idempotencyKey,
    endpoint,
    requestHash,
    statusCode: result.status,
    responseJson: JSON.stringify(result.payload),
    nowIso: nowIsoValue,
    ttlSeconds: IDEMPOTENCY_TTL_SECONDS,
  });

  return jsonResponse(result.payload, result.status);
}

async function evaluateAnswer(input: {
  store: StudyStore;
  sessionId: string;
  questionId: string;
  selectedChoice: 'A' | 'B' | 'C' | 'D';
  idempotencyKey: string;
  responseTimeSeconds?: number;
  confidence: number | null;
  nowIsoValue: string;
}): Promise<
  | { status: 404; code: 'SESSION_NOT_FOUND' | 'QUESTION_NOT_FOUND' }
  | {
      status: 200;
      payload: {
        sessionId: string;
        questionId: string;
        isCorrect: boolean;
        explanation: string;
        explanationBrief: string;
        sourceContexts: SourceContextSnippet[];
        sourceChunkIds: string[];
        progress: { questionsAnswered: number; questionsCorrect: number; accuracy: number };
        nextQuestion: QuizQuestion | null;
      };
    }
> {
  const session = await input.store.getSessionById(input.sessionId);
  if (!session) {
    return {
      status: 404,
      code: 'SESSION_NOT_FOUND',
    };
  }

  const question = await input.store.getQuestionById(input.questionId);
  if (!question || question.chapterId !== session.chapterId) {
    return {
      status: 404,
      code: 'QUESTION_NOT_FOUND',
    };
  }

  const parsedNow = Date.parse(input.nowIsoValue);
  const parsedPresented = session.currentQuestionPresentedAt ? Date.parse(session.currentQuestionPresentedAt) : Number.NaN;
  const derivedResponseTimeSeconds =
    Number.isFinite(parsedNow) && Number.isFinite(parsedPresented)
      ? Math.max(0, (parsedNow - parsedPresented) / 1000)
      : 0;
  const responseTimeSeconds =
    typeof input.responseTimeSeconds === 'number' && Number.isFinite(input.responseTimeSeconds)
      ? Math.max(0, input.responseTimeSeconds)
      : derivedResponseTimeSeconds;
  const sourceContexts = await input.store.getChunkContexts(question.sourceChunkIds);
  const explanation = buildDetailedExplanation({
    brief: question.explanation,
    sourceContexts,
  });

  const isCorrect = input.selectedChoice === question.correctChoice;
  await input.store.recordAttempt({
    sessionId: session.sessionId,
    questionId: question.questionId,
    selectedChoice: input.selectedChoice,
    isCorrect,
    responseTimeSeconds,
    confidence: input.confidence,
    idempotencyKey: input.idempotencyKey,
    nowIso: input.nowIsoValue,
  });

  const progress = await input.store.recomputeProgress({
    userId: session.userId,
    chapterId: session.chapterId,
    nowIso: input.nowIsoValue,
  });

  await input.store.recomputeQuestionProgress({
    userId: session.userId,
    questionId: question.questionId,
    nowIso: input.nowIsoValue,
  });

  if (question.sourceId) {
    await input.store.recomputePdfProgress({
      userId: session.userId,
      sourceId: question.sourceId,
      nowIso: input.nowIsoValue,
    });
  }

  const topic = question.topic ?? 'unknown';
  await input.store.recomputeTopicMastery({
    userId: session.userId,
    topic,
    nowIso: input.nowIsoValue,
  });
  await input.store.refreshTopicWeaknessRanks(session.userId);

  const nextQuestionIndex = session.currentQuestionIndex + 1;
  const nextQuestion = await input.store.getQuestionByIndex(session.chapterId, nextQuestionIndex);
  await input.store.updateSessionPointer({
    sessionId: session.sessionId,
    questionIndex: nextQuestionIndex,
    lastQuestionId: question.questionId,
    currentQuestionPresentedAt: nextQuestion ? input.nowIsoValue : null,
    nowIso: input.nowIsoValue,
  });

  return {
    status: 200,
    payload: {
      sessionId: session.sessionId,
      questionId: question.questionId,
      isCorrect,
      explanation: explanation.explanationDetailed,
      explanationBrief: question.explanation,
      sourceContexts: explanation.sourceContextSnippets,
      sourceChunkIds: question.sourceChunkIds,
      progress: {
        questionsAnswered: progress.questionsAnswered,
        questionsCorrect: progress.questionsCorrect,
        accuracy: progress.accuracy,
      },
      nextQuestion,
    },
  };
}

export function createApp(deps: AppDependencies = {}): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.get('/healthz', (c) => {
    return c.json({
      ok: true,
      schema_version: schemaVersion(c),
      service: 'study-service',
    });
  });

  app.use('/v1/*', async (c, next) => {
    if (
      c.req.path === '/v1/telegram/webhook' ||
      c.req.path === '/v1/channel/sms/webhook' ||
      c.req.path === '/v1/channel/sms/status'
    ) {
      return next();
    }

    const expectedToken = c.env.STUDY_SERVICE_TOKEN;
    if (expectedToken && expectedToken.length > 0) {
      const providedToken = c.req.header('x-study-service-token');
      if (providedToken !== expectedToken) {
        return jsonError(c, 401, 'UNAUTHORIZED', 'Missing or invalid x-study-service-token');
      }
    }

    return next();
  });

  app.post('/v1/sources/upload-url', async (c) => {
    return withIdempotentJson(c, deps, '/v1/sources/upload-url', async (body) => {
      try {
        const request = parseUploadUrlBody(body);
        const store = buildStore(c, deps);
        const result = await store.createSource({
          filename: request.filename,
          contentType: request.content_type,
          sha256: request.sha256,
          sourceLabel: request.source_label,
          chapterId: request.chapter_id,
        });

        return {
          status: 201,
          payload: {
            schema_version: schemaVersion(c),
            source_id: result.sourceId,
            object_key: result.objectKey,
            upload_url: result.uploadUrl,
            expires_at: result.expiresAt,
          },
        };
      } catch (error) {
        return {
          status: 422,
          payload: {
            schema_version: schemaVersion(c),
            error: {
              code: 'VALIDATION_ERROR',
              message: error instanceof Error ? error.message : 'invalid request',
            },
          },
        };
      }
    });
  });

  app.post('/v1/sources/:sourceId/complete', async (c) => {
    return withIdempotentJson(c, deps, '/v1/sources/{source_id}/complete', async (body) => {
      try {
        parseCompleteSourceBody(body);
      } catch (error) {
        return {
          status: 422,
          payload: {
            schema_version: schemaVersion(c),
            error: {
              code: 'VALIDATION_ERROR',
              message: error instanceof Error ? error.message : 'invalid request',
            },
          },
        };
      }

      const store = buildStore(c, deps);
      try {
        const result = await store.completeSource(c.req.param('sourceId'));
        return {
          status: 202,
          payload: {
            schema_version: schemaVersion(c),
            ingest_job_id: result.ingestJobId,
            status: result.status,
          },
        };
      } catch (error) {
        if (error instanceof Error && error.message === 'source_not_found') {
          return {
            status: 404,
            payload: {
              schema_version: schemaVersion(c),
              error: {
                code: 'NOT_FOUND',
                message: 'source not found',
              },
            },
          };
        }

        return {
          status: 500,
          payload: {
            schema_version: schemaVersion(c),
            error: {
              code: 'INTERNAL_ERROR',
              message: 'unable to complete source',
            },
          },
        };
      }
    });
  });

  app.get('/v1/sources/:sourceId/status', async (c) => {
    const store = buildStore(c, deps);
    const source = await store.getSourceStatus(c.req.param('sourceId'));
    if (!source) {
      return jsonError(c, 404, 'NOT_FOUND', 'source not found');
    }

    return c.json({
      schema_version: schemaVersion(c),
      source_id: source.sourceId,
      upload_status: source.uploadStatus,
      ingest_status: source.ingestStatus,
      parse_confidence: source.parseConfidence,
      chunk_count: source.chunkCount,
      error_code: source.errorCode,
      object_key: source.objectKey,
    });
  });

  app.post('/v1/admin/seed/fast-pilot', async (c) => {
    return withIdempotentJson(c, deps, '/v1/admin/seed/fast-pilot', async (body, _idempotencyKey, nowIsoValue) => {
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return {
          status: 422,
          payload: {
            schema_version: schemaVersion(c),
            error: {
              code: 'VALIDATION_ERROR',
              message: 'request body must be a JSON object',
            },
          },
        };
      }

      const obj = body as Record<string, unknown>;
      if (typeof obj.schema_version !== 'string' || obj.schema_version.trim().length === 0) {
        return {
          status: 422,
          payload: {
            schema_version: schemaVersion(c),
            error: {
              code: 'VALIDATION_ERROR',
              message: 'schema_version is required',
            },
          },
        };
      }

      const chapterId = typeof obj.chapter_id === 'string' ? obj.chapter_id.trim() : 'us-01';
      const sourceObjectKey =
        typeof obj.source_object_key === 'string' ? obj.source_object_key.trim() : '';
      const imageObjectKey =
        typeof obj.image_object_key === 'string' && obj.image_object_key.trim().length > 0
          ? obj.image_object_key.trim()
          : null;
      const questionCountRaw = obj.question_count;
      const questionCount =
        typeof questionCountRaw === 'number' && Number.isInteger(questionCountRaw)
          ? questionCountRaw
          : 20;

      if (!sourceObjectKey) {
        return {
          status: 422,
          payload: {
            schema_version: schemaVersion(c),
            error: {
              code: 'VALIDATION_ERROR',
              message: 'source_object_key is required',
            },
          },
        };
      }

      if (questionCount < 1 || questionCount > 200) {
        return {
          status: 422,
          payload: {
            schema_version: schemaVersion(c),
            error: {
              code: 'VALIDATION_ERROR',
              message: 'question_count must be between 1 and 200',
            },
          },
        };
      }

      const store = buildStore(c, deps);
      const seeded = await store.seedPilotChapter({
        chapterId,
        sourceObjectKey,
        imageObjectKey,
        questionCount,
        nowIso: nowIsoValue,
      });

      return {
        status: 200,
        payload: {
          schema_version: schemaVersion(c),
          chapter_id: seeded.chapterId,
          question_count: seeded.questionCount,
          image_question_count: seeded.imageQuestionCount,
          status: 'seeded',
        },
      };
    });
  });

  app.post('/v1/quiz/session/start', async (c) => {
    return withIdempotentJson(c, deps, '/v1/quiz/session/start', async (body) => {
      let request;
      try {
        request = parseStartSessionBody(body);
      } catch (error) {
        return {
          status: 422,
          payload: {
            schema_version: schemaVersion(c),
            error: {
              code: 'VALIDATION_ERROR',
              message: error instanceof Error ? error.message : 'invalid request',
            },
          },
        };
      }

      if (request.telegram_chat_type && request.telegram_chat_type !== 'private') {
        return {
          status: 200,
          payload: {
            schema_version: schemaVersion(c),
            status: 'unsupported_chat_type',
            message: 'Only direct-message Telegram chats are supported for study sessions.',
          },
        };
      }

      const userId = request.user_id ?? `tg:user:${request.telegram_user_id}`;
      const nowIsoValue = nowIso(deps);
      const store = buildStore(c, deps);
      const session = await store.getOrCreateSession({
        chapterId: request.chapter_id,
        userId,
        telegramUserId: request.telegram_user_id ?? null,
        telegramChatId: request.telegram_chat_id ?? null,
        nowIso: nowIsoValue,
      });

      const currentQuestion = await store.getQuestionByIndex(session.chapterId, session.currentQuestionIndex);
      const twentiethQuestion = await store.getQuestionByIndex(session.chapterId, 19);

      if (!currentQuestion) {
        return {
          status: 200,
          payload: {
            schema_version: schemaVersion(c),
            status: 'warming',
            cache_state: 'question_cache_empty',
            message: 'Question cache is warming up. Retry in a few seconds.',
            session_id: session.sessionId,
            chapter_id: session.chapterId,
          },
        };
      }

      await store.updateSessionPointer({
        sessionId: session.sessionId,
        questionIndex: session.currentQuestionIndex,
        lastQuestionId: session.lastQuestionId,
        currentQuestionPresentedAt: nowIsoValue,
        nowIso: nowIsoValue,
      });

      return {
        status: 200,
        payload: {
          schema_version: schemaVersion(c),
          status: 'ok',
          cache_state: twentiethQuestion ? 'question_cache_ready' : 'question_cache_degraded',
          session_id: session.sessionId,
          chapter_id: session.chapterId,
          question: toQuestionPayload(currentQuestion),
        },
      };
    });
  });

  app.post('/v1/quiz/session/:sessionId/answer', async (c) => {
    return withIdempotentJson(c, deps, '/v1/quiz/session/{session_id}/answer', async (body, idempotencyKey) => {
      let request;
      try {
        request = parseAnswerBody(body);
      } catch (error) {
        return {
          status: 422,
          payload: {
            schema_version: schemaVersion(c),
            error: {
              code: 'VALIDATION_ERROR',
              message: error instanceof Error ? error.message : 'invalid request',
            },
          },
        };
      }

      const selectedChoice = normalizeChoice(request.selected_choice);
      if (!selectedChoice) {
        return {
          status: 422,
          payload: {
            schema_version: schemaVersion(c),
            error: {
              code: 'INVALID_CHOICE',
              message: 'selected_choice must map to A, B, C, or D',
            },
          },
        };
      }

      const store = buildStore(c, deps);
      const nowIsoValue = nowIso(deps);
      const result = await evaluateAnswer({
        store,
        sessionId: c.req.param('sessionId'),
        questionId: request.question_id,
        selectedChoice,
        idempotencyKey,
        responseTimeSeconds: request.response_time_seconds,
        confidence: request.confidence ?? null,
        nowIsoValue,
      });

      if (result.status === 404) {
        return {
          status: 404,
          payload: {
            schema_version: schemaVersion(c),
            error: {
              code: 'NOT_FOUND',
              message:
                result.code === 'SESSION_NOT_FOUND'
                  ? 'session not found'
                  : 'question not found for this session',
            },
          },
        };
      }

      return {
        status: 200,
        payload: {
          schema_version: schemaVersion(c),
          session_id: result.payload.sessionId,
          question_id: result.payload.questionId,
          selected_choice: selectedChoice,
          is_correct: result.payload.isCorrect,
          explanation: result.payload.explanation,
          explanation_brief: result.payload.explanationBrief,
          source_contexts: result.payload.sourceContexts.map((row) => ({
            chunk_id: row.chunkId,
            source_id: row.sourceId,
            topic: row.topicTag,
            excerpt: row.excerpt,
          })),
          source_chunk_ids: result.payload.sourceChunkIds,
          progress: {
            questions_answered: result.payload.progress.questionsAnswered,
            questions_correct: result.payload.progress.questionsCorrect,
            accuracy: result.payload.progress.accuracy,
          },
          next_question: result.payload.nextQuestion ? toQuestionPayload(result.payload.nextQuestion) : null,
        },
      };
    });
  });

  app.post('/v1/channel/sms/webhook', async (c) => {
    const parsed = (await c.req.parseBody()) as Record<string, string | File>;
    const params = toStringMap(parsed);

    const expectedAuthToken = c.env.TWILIO_AUTH_TOKEN;
    if (expectedAuthToken && expectedAuthToken.length > 0) {
      const providedSignature = c.req.header('x-twilio-signature');
      if (!providedSignature || providedSignature.trim().length === 0) {
        return jsonError(c, 401, 'UNAUTHORIZED', 'Missing Twilio signature');
      }

      const isValidSignature = await verifyTwilioWebhookSignature({
        authToken: expectedAuthToken,
        signature: providedSignature,
        url: c.req.url,
        params,
      });

      if (!isValidSignature) {
        return jsonError(c, 401, 'UNAUTHORIZED', 'Invalid Twilio signature');
      }
    }

    const text = String(params.Body ?? '').trim();
    const fromPhone = String(params.From ?? '').trim();
    const messageSid = String(params.MessageSid ?? params.SmsMessageSid ?? '').trim();

    if (!fromPhone || !messageSid) {
      return smsTwiMlResponse([]);
    }

    const store = buildStore(c, deps);
    const idemStore = buildIdempotencyStore(c, deps);
    const currentNowIso = nowIso(deps);
    const userId = `sms:user:${fromPhone}`;

    // A/B/C/D fast-path — no LLM needed
    const choice = normalizeChoice(text);
    if (choice) {
      const activeSession = await store.getActiveSessionByUser(userId);
      if (!activeSession) {
        return smsTwiMlResponse(['No active session. Send "start fast" to begin.']);
      }

      const currentQuestionIndex = activeSession.currentQuestionIndex;
      const currentQuestion = await store.getQuestionByIndex(activeSession.chapterId, currentQuestionIndex);
      if (!currentQuestion) {
        return smsTwiMlResponse(['Question cache is warming up. Send "question 1" in a few seconds.']);
      }

      const answerDeliveryIdempotencyKey = `sms:${fromPhone}:${messageSid}:answer`;
      const answerIdempotencyKey = deriveSmsIdempotencyKey({
        fromPhone,
        messageSid,
        intent: 'answer',
        sessionId: activeSession.sessionId,
        questionId: currentQuestion.questionId,
      });
      const answerRequestHash = await sha256Hex(
        JSON.stringify({
          message_sid: messageSid,
          from_phone: fromPhone,
          text,
          intent: 'answer',
        }),
      );

      const existingAnswer = await idemStore.get(answerDeliveryIdempotencyKey, '/v1/channel/sms/webhook');
      if (existingAnswer) {
        if (existingAnswer.requestHash !== answerRequestHash) {
          return smsTwiMlResponse([]);
        }
        return smsTwiMlResponse([]);
      }

      const evaluated = await evaluateAnswer({
        store,
        sessionId: activeSession.sessionId,
        questionId: currentQuestion.questionId,
        selectedChoice: choice,
        idempotencyKey: answerIdempotencyKey,
        confidence: null,
        nowIsoValue: currentNowIso,
      });

      if (evaluated.status === 404) {
        return smsTwiMlResponse(['Session state changed. Send "start fast" to continue.']);
      }

      const messages = [
        buildAnswerFeedback({
          isCorrect: evaluated.payload.isCorrect,
          explanation: truncateText(evaluated.payload.explanation, 1400),
          progress: evaluated.payload.progress,
        }),
      ];

      if (evaluated.payload.nextQuestion) {
        const nextImageDescription = buildImageDescription({
          imageRef: evaluated.payload.nextQuestion.imageRef,
          stem: evaluated.payload.nextQuestion.stem,
          explanation: evaluated.payload.nextQuestion.explanation,
        });
        messages.push(
          buildQuestionText({
            questionNumber: currentQuestionIndex + 2,
            stem: evaluated.payload.nextQuestion.stem,
            choices: evaluated.payload.nextQuestion.choices,
          }),
        );
        if (nextImageDescription) {
          messages.push(`Image description: ${nextImageDescription}`);
        }
      }

      await idemStore.put({
        idempotencyKey: answerDeliveryIdempotencyKey,
        endpoint: '/v1/channel/sms/webhook',
        requestHash: answerRequestHash,
        statusCode: 200,
        responseJson: JSON.stringify({ ok: true, status: 'answer_processed' }),
        nowIso: currentNowIso,
        ttlSeconds: IDEMPOTENCY_TTL_SECONDS,
      });

      return smsTwiMlResponse(messages);
    }

    // LLM planner — handles all other text
    const [activeSessionForPlanner, topicMasteryForSms] = await Promise.all([
      store.getActiveSessionByUser(userId),
      store.listTopicMastery(userId),
    ]);
    const smsWeakTopics = topicMasteryForSms
      .filter((t) => t.weaknessRank !== null)
      .sort((a, b) => (a.weaknessRank ?? 999) - (b.weaknessRank ?? 999))
      .slice(0, 3)
      .map((t) => t.topic);
    const smsReviewDueCount = topicMasteryForSms.filter(
      (t) => t.nextReviewAt !== null && t.nextReviewAt <= currentNowIso,
    ).length;
    const decision = await buildAgentPlanner(deps)({
      env: c.env,
      nowIso: currentNowIso,
      userId,
      userText: text,
      selectedFolder: null,
      activeSession: {
        chapterId: activeSessionForPlanner?.chapterId ?? null,
        questionIndex: activeSessionForPlanner?.currentQuestionIndex ?? null,
      },
      recentMisses: [],
      history: [],
      examDate: c.env.EXAM_DATE ?? null,
      topicWeaknesses: smsWeakTopics,
      topicsReviewDueCount: smsReviewDueCount,
    });

    if (!decision) {
      return smsTwiMlResponse(['Send "start fast" to begin, or A/B/C/D to answer.']);
    }

    if (decision.route === 'chat') {
      return smsTwiMlResponse([decision.message ?? 'Send "start fast" to begin.']);
    }

    if (decision.route === 'misses') {
      return smsTwiMlResponse([formatMissesMessage(topicMasteryForSms.length > 0 ? [] : [], decision.limit)]);
    }

    if (decision.route === 'last_miss') {
      return smsTwiMlResponse([formatLastMissMessage(null)]);
    }

    if (decision.route === 'ingest' || decision.route === 'ingest_status') {
      const chapterId = resolveDecisionChapterId(decision.chapterId, decision.chapterName);
      if (!chapterId) {
        return smsTwiMlResponse(['Which chapter? Say e.g. "ingest focused echo" or "ingest us-02".']);
      }
      if (decision.route === 'ingest_status') {
        const src = await store.getSourceByChapterId(chapterId);
        if (!src) return smsTwiMlResponse([`No source found for ${chapterId}.`]);
        return smsTwiMlResponse([`${chapterId}: ingest=${src.ingestStatus ?? 'not started'}, questions=${src.questionCount}`]);
      }
      // ingest route: trigger or report status
      const src = await store.getSourceByChapterId(chapterId);
      if (!src) return smsTwiMlResponse([`No uploaded source found for ${chapterId}. Upload the PDF first.`]);
      if (src.questionCount > 0) {
        return smsTwiMlResponse([`${chapterId} already has ${src.questionCount} questions. Say "start ${chapterId}" to begin.`]);
      }
      if (src.ingestStatus === 'processing' || src.ingestStatus === 'queued') {
        return smsTwiMlResponse([`${chapterId} ingest already in progress (${src.ingestStatus}). Check back in a minute.`]);
      }
      try {
        await store.completeSource(src.sourceId);
        return smsTwiMlResponse([`Queued ingest for ${chapterId}. Check status with "ingest status ${chapterId}" in ~1 min.`]);
      } catch {
        return smsTwiMlResponse([`Could not queue ingest for ${chapterId}. Try again.`]);
      }
    }

    if (decision.route === 'start' || decision.route === 'resume' || decision.route === 'q1') {
      const chapterId =
        decision.route === 'resume'
          ? (activeSessionForPlanner?.chapterId ?? 'us-01')
          : (resolveDecisionChapterId(decision.chapterId, decision.chapterName) ?? 'us-01');
      const intentLabel: 'start' | 'q1' = decision.route === 'q1' ? 'q1' : 'start';
      const idempotencyKey = deriveSmsIdempotencyKey({
        fromPhone,
        messageSid,
        intent: intentLabel,
        chapterId,
      });
      const requestHash = await sha256Hex(
        JSON.stringify({
          message_sid: messageSid,
          from_phone: fromPhone,
          text,
          intent: intentLabel,
          chapter_id: chapterId,
        }),
      );

      const existing = await idemStore.get(idempotencyKey, '/v1/channel/sms/webhook');
      if (existing) {
        if (existing.requestHash !== requestHash) return smsTwiMlResponse([]);
        return smsTwiMlResponse([]);
      }

      const session = await store.getOrCreateSession({
        chapterId,
        userId,
        telegramUserId: null,
        telegramChatId: null,
        nowIso: currentNowIso,
      });

      const questionIndex = decision.route === 'q1' ? 0 : session.currentQuestionIndex;
      const question = await store.getQuestionByIndex(chapterId, questionIndex);
      if (!question) {
        await idemStore.put({
          idempotencyKey,
          endpoint: '/v1/channel/sms/webhook',
          requestHash,
          statusCode: 200,
          responseJson: JSON.stringify({ ok: true, status: 'warming' }),
          nowIso: currentNowIso,
          ttlSeconds: IDEMPOTENCY_TTL_SECONDS,
        });
        return smsTwiMlResponse([`${chapterId} not ready yet — say "ingest ${chapterId}" to process it first.`]);
      }

      await store.updateSessionPointer({
        sessionId: session.sessionId,
        questionIndex,
        lastQuestionId: session.lastQuestionId,
        currentQuestionPresentedAt: currentNowIso,
        nowIso: currentNowIso,
      });

      const questionText = buildQuestionText({
        questionNumber: questionIndex + 1,
        stem: question.stem,
        choices: question.choices,
      });
      const imageDescription = buildImageDescription({
        imageRef: question.imageRef,
        stem: question.stem,
        explanation: question.explanation,
      });
      const messages = [questionText];
      if (imageDescription) messages.push(`Image description: ${imageDescription}`);

      await idemStore.put({
        idempotencyKey,
        endpoint: '/v1/channel/sms/webhook',
        requestHash,
        statusCode: 200,
        responseJson: JSON.stringify({ ok: true, status: 'sent_question', question_id: question.questionId }),
        nowIso: currentNowIso,
        ttlSeconds: IDEMPOTENCY_TTL_SECONDS,
      });

      return smsTwiMlResponse(messages);
    }

    return smsTwiMlResponse(['Try: "start fast", "ingest focused echo", "misses", or answer A/B/C/D.']);
  });

  app.post('/v1/channel/sms/status', async (c) => {
    const parsed = (await c.req.parseBody()) as Record<string, string | File>;
    const params = toStringMap(parsed);

    const expectedAuthToken = c.env.TWILIO_AUTH_TOKEN;
    if (expectedAuthToken && expectedAuthToken.length > 0) {
      const providedSignature = c.req.header('x-twilio-signature');
      if (!providedSignature || providedSignature.trim().length === 0) {
        return jsonError(c, 401, 'UNAUTHORIZED', 'Missing Twilio signature');
      }

      const isValidSignature = await verifyTwilioWebhookSignature({
        authToken: expectedAuthToken,
        signature: providedSignature,
        url: c.req.url,
        params,
      });

      if (!isValidSignature) {
        return jsonError(c, 401, 'UNAUTHORIZED', 'Invalid Twilio signature');
      }
    }

    const messageSid = String(params.MessageSid ?? '');
    const messageStatus = String(params.MessageStatus ?? '');
    const errorCode = String(params.ErrorCode ?? '');
    console.info('sms_delivery_status', {
      messageSid,
      messageStatus,
      errorCode: errorCode || null,
    });

    return c.text('ok');
  });

  app.post('/v1/telegram/webhook', async (c) => {
    const expectedWebhookSecret = c.env.TELEGRAM_WEBHOOK_SECRET;
    if (expectedWebhookSecret && expectedWebhookSecret.length > 0) {
      const providedSecret = c.req.header('x-telegram-bot-api-secret-token');
      if (providedSecret !== expectedWebhookSecret) {
        return jsonError(c, 401, 'UNAUTHORIZED', 'Invalid Telegram webhook secret');
      }
    }

    let update: Record<string, unknown>;
    try {
      update = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return jsonError(c, 400, 'INVALID_JSON', 'Request body must be valid JSON');
    }

    const message = (update.message ?? update.edited_message) as Record<string, unknown> | undefined;
    if (!message) {
      return c.json({ ok: true, ignored: 'no_message' });
    }

    const text = typeof message.text === 'string' ? message.text : '';
    const chat = (message.chat ?? {}) as Record<string, unknown>;
    const from = (message.from ?? {}) as Record<string, unknown>;
    const chatId = String(chat.id ?? '');
    const chatType = String(chat.type ?? '');
    const fromId = String(from.id ?? '');
    const messageId = String(message.message_id ?? '');

    if (!chatId || !fromId || !messageId) {
      return c.json({ ok: true, ignored: 'missing_message_identifiers' });
    }

    const userId = `tg:user:${fromId}`;
    const store = buildStore(c, deps);
    const idemStore = buildIdempotencyStore(c, deps);
    const currentNowIso = nowIso(deps);

    // 1. PDF document upload handler
    const document = message.document as Record<string, unknown> | undefined;
    if (document && document.mime_type === 'application/pdf') {
      const fileId = String(document.file_id ?? '');
      const fileName = String(document.file_name ?? 'upload.pdf');

      const fileInfo = (await fetch(
        `https://api.telegram.org/bot${c.env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`,
      ).then((r) => r.json())) as { ok: boolean; result?: { file_path: string } };

      if (!fileInfo.ok || !fileInfo.result?.file_path) {
        await sendTelegramMessage(c.env, chatId, 'Could not retrieve your PDF. Try again.');
        return c.json({ ok: true, status: 'pdf_get_file_failed' });
      }

      const fileBytes = await fetch(
        `https://api.telegram.org/file/bot${c.env.TELEGRAM_BOT_TOKEN}/${fileInfo.result.file_path}`,
      ).then((r) => r.arrayBuffer());

      const source = await store.createSource({
        filename: fileName,
        contentType: 'application/pdf',
        sourceLabel: fileName.replace(/\.pdf$/i, ''),
      });

      await c.env.STUDY_ASSETS.put(source.objectKey, fileBytes, {
        httpMetadata: { contentType: 'application/pdf' },
      });

      await store.completeSource(source.sourceId);
      await sendTelegramMessage(
        c.env,
        chatId,
        `Got ${fileName}. Ingesting now — reply "ingest status" to check progress.`,
      );
      return c.json({ ok: true, status: 'pdf_upload_queued', sourceId: source.sourceId });
    }

    // 2. A/B/C/D fast-path — no LLM needed
    const choice = normalizeChoice(text);
    if (choice) {
      if (chatType !== 'private') {
        await sendTelegramMessage(
          c.env,
          chatId,
          'Only direct-message Telegram chats are supported for study sessions.',
        );
        return c.json({ ok: true, status: 'unsupported_chat_type' });
      }

      const activeSession = await store.getActiveSessionByUser(userId);
      if (!activeSession) {
        await sendTelegramMessage(c.env, chatId, 'No active session. Send "start fast" to begin.');
        return c.json({ ok: true, status: 'no_active_session' });
      }

      const currentQuestionIndex = activeSession.currentQuestionIndex;
      const currentQuestion = await store.getQuestionByIndex(activeSession.chapterId, currentQuestionIndex);
      if (!currentQuestion) {
        await sendTelegramMessage(c.env, chatId, 'Question cache is warming up. Send "question 1" in a few seconds.');
        return c.json({ ok: true, status: 'warming' });
      }

      const answerDeliveryIdempotencyKey = `tg:${chatId}:${messageId}:answer`;
      const answerIdempotencyKey = deriveTelegramIdempotencyKey({
        chatId,
        messageId,
        intent: 'answer',
        sessionId: activeSession.sessionId,
        questionId: currentQuestion.questionId,
      });
      const answerRequestHash = await sha256Hex(
        JSON.stringify({
          update_id: update.update_id ?? null,
          from_id: fromId,
          chat_id: chatId,
          text,
          intent: 'answer',
        }),
      );

      const existingAnswer = await idemStore.get(answerDeliveryIdempotencyKey, '/v1/telegram/webhook');
      if (existingAnswer) {
        if (existingAnswer.requestHash !== answerRequestHash) {
          return c.json({ ok: true, status: 'idempotency_conflict_ignored' });
        }
        return c.json({ ok: true, deduped: true, status: 'answer_processed' });
      }

      const evaluated = await evaluateAnswer({
        store,
        sessionId: activeSession.sessionId,
        questionId: currentQuestion.questionId,
        selectedChoice: choice,
        idempotencyKey: answerIdempotencyKey,
        confidence: null,
        nowIsoValue: currentNowIso,
      });

      if (evaluated.status === 404) {
        await sendTelegramMessage(c.env, chatId, 'Session state changed. Send "start fast" to continue.');
        return c.json({ ok: true, status: 'session_state_changed' });
      }

      const feedback = buildAnswerFeedback({
        isCorrect: evaluated.payload.isCorrect,
        explanation: truncateText(evaluated.payload.explanation, 1400),
        progress: evaluated.payload.progress,
      });
      await sendTelegramMessage(c.env, chatId, feedback);

      if (evaluated.payload.nextQuestion) {
        const nextQuestionText = buildQuestionText({
          questionNumber: currentQuestionIndex + 2,
          stem: evaluated.payload.nextQuestion.stem,
          choices: evaluated.payload.nextQuestion.choices,
        });
        const nextImageDescription = evaluated.payload.nextQuestion.imageDescription ?? buildImageDescription({
          imageRef: evaluated.payload.nextQuestion.imageRef,
          stem: evaluated.payload.nextQuestion.stem,
          explanation: evaluated.payload.nextQuestion.explanation,
        });
        await sendTelegramQuestion(c.env, {
          chatId,
          questionText: nextQuestionText,
          imageRef: evaluated.payload.nextQuestion.imageRef,
          imageDescription: nextImageDescription,
        });
      }

      await idemStore.put({
        idempotencyKey: answerDeliveryIdempotencyKey,
        endpoint: '/v1/telegram/webhook',
        requestHash: answerRequestHash,
        statusCode: 200,
        responseJson: JSON.stringify({ ok: true, status: 'answer_processed' }),
        nowIso: currentNowIso,
        ttlSeconds: IDEMPOTENCY_TTL_SECONDS,
      });

      return c.json({ ok: true, status: 'answer_processed' });
    }

    // 3. LLM agent — tool-calling path first, routing fallback
    const [activeSessionForPlanner, topicMasteryForTg] = await Promise.all([
      store.getActiveSessionByUser(userId),
      store.listTopicMastery(userId),
    ]);
    const tgWeakTopics = topicMasteryForTg
      .filter((t) => t.weaknessRank !== null)
      .sort((a, b) => (a.weaknessRank ?? 999) - (b.weaknessRank ?? 999))
      .slice(0, 3)
      .map((t) => t.topic);
    const tgReviewDueCount = topicMasteryForTg.filter(
      (t) => t.nextReviewAt !== null && t.nextReviewAt <= currentNowIso,
    ).length;

    // Tool-calling path: LLM has real tools and executes them, then responds naturally
    if (isStudyAgentEnabled(c.env) && !deps.agentPlanner) {
      const executor = buildToolExecutor(store, userId);
      const toolResult = await runAgentWithTools({
        env: c.env,
        nowIso: currentNowIso,
        userText: text,
        activeSession: {
          chapterId: activeSessionForPlanner?.chapterId ?? null,
          questionIndex: activeSessionForPlanner?.currentQuestionIndex ?? null,
        },
        examDate: c.env.EXAM_DATE ?? null,
        topicWeaknesses: tgWeakTopics,
        topicsReviewDueCount: tgReviewDueCount,
        executor,
      });

      if (toolResult) {
        await sendTelegramMessage(c.env, chatId, toolResult.message);

        if (toolResult.pendingStart) {
          const { chapterId } = toolResult.pendingStart;
          const session = await store.getOrCreateSession({
            chapterId,
            userId,
            telegramUserId: fromId,
            telegramChatId: chatId,
            nowIso: currentNowIso,
          });
          const question = await store.getQuestionByIndex(chapterId, session.currentQuestionIndex);
          if (question) {
            await store.updateSessionPointer({
              sessionId: session.sessionId,
              questionIndex: session.currentQuestionIndex,
              lastQuestionId: session.lastQuestionId,
              currentQuestionPresentedAt: currentNowIso,
              nowIso: currentNowIso,
            });
            const questionText = buildQuestionText({
              questionNumber: session.currentQuestionIndex + 1,
              stem: question.stem,
              choices: question.choices,
            });
            const imageDescription =
              question.imageDescription ??
              buildImageDescription({ imageRef: question.imageRef, stem: question.stem, explanation: question.explanation });
            await sendTelegramQuestion(c.env, { chatId, questionText, imageRef: question.imageRef, imageDescription });
          }
        }

        return c.json({ ok: true, status: 'agent_tool_response' });
      }
      // Fall through to routing if tool-calling returned null
    }

    const decision = await buildAgentPlanner(deps)({
      env: c.env,
      nowIso: currentNowIso,
      userId,
      userText: text,
      selectedFolder: null,
      activeSession: {
        chapterId: activeSessionForPlanner?.chapterId ?? null,
        questionIndex: activeSessionForPlanner?.currentQuestionIndex ?? null,
      },
      recentMisses: [],
      history: [],
      examDate: c.env.EXAM_DATE ?? null,
      topicWeaknesses: tgWeakTopics,
      topicsReviewDueCount: tgReviewDueCount,
    });

    if (!decision) {
      await sendTelegramMessage(c.env, chatId, 'Send "start fast" to begin, or A/B/C/D to answer.');
      return c.json({ ok: true, status: 'fallback' });
    }

    if (decision.route === 'chat') {
      await sendTelegramMessage(c.env, chatId, decision.message ?? 'Send "start fast" to begin.');
      return c.json({ ok: true, status: 'chat' });
    }

    if (decision.route === 'misses') {
      const recentAttempts = await store.listRecentAttempts(userId, 20);
      const misses: AgentMissSnapshot[] = recentAttempts
        .filter((a) => !a.isCorrect)
        .slice(0, decision.limit)
        .map((a) => ({
          questionId: a.questionId,
          chapterId: a.chapterId,
          sourceId: a.sourceId,
          topic: a.topic,
          selectedChoice: a.selectedChoice,
          correctChoice: a.selectedChoice, // placeholder — not stored in attempt
          stem: '',
          explanation: '',
          createdAt: a.createdAt,
        }));
      await sendTelegramMessage(c.env, chatId, formatMissesMessage(misses, decision.limit));
      return c.json({ ok: true, status: 'misses' });
    }

    if (decision.route === 'last_miss') {
      const recentAttempts = await store.listRecentAttempts(userId, 10);
      const lastMiss = recentAttempts.find((a) => !a.isCorrect);
      if (!lastMiss) {
        await sendTelegramMessage(c.env, chatId, 'No misses recorded yet — keep going!');
      } else {
        const q = await store.getQuestionById(lastMiss.questionId);
        const msg = q
          ? `Last miss [${q.chapterId}]:\n${q.stem.slice(0, 200)}\nYou chose ${lastMiss.selectedChoice}, correct was ${q.correctChoice}.\n${q.explanation.slice(0, 300)}`
          : `Last miss: question ${lastMiss.questionId} — you chose ${lastMiss.selectedChoice}.`;
        await sendTelegramMessage(c.env, chatId, msg);
      }
      return c.json({ ok: true, status: 'last_miss' });
    }

    if (decision.route === 'ingest' || decision.route === 'ingest_status') {
      const chapterId = resolveDecisionChapterId(decision.chapterId, decision.chapterName);
      if (!chapterId) {
        await sendTelegramMessage(c.env, chatId, 'Which chapter? Say e.g. "review new chapter focused echo" or "ingest us-02".');
        return c.json({ ok: true, status: 'ingest_needs_chapter' });
      }
      if (decision.route === 'ingest_status') {
        const src = await store.getSourceByChapterId(chapterId);
        if (!src) {
          await sendTelegramMessage(c.env, chatId, `No source found for ${chapterId}.`);
        } else {
          await sendTelegramMessage(c.env, chatId, `${chapterId}: ingest=${src.ingestStatus ?? 'not started'}, questions ready=${src.questionCount}`);
        }
        return c.json({ ok: true, status: 'ingest_status' });
      }
      // ingest route
      const src = await store.getSourceByChapterId(chapterId);
      if (!src) {
        await sendTelegramMessage(c.env, chatId, `No uploaded source found for ${chapterId}. Upload the PDF first via Telegram or the API.`);
        return c.json({ ok: true, status: 'ingest_no_source' });
      }
      if (src.questionCount > 0) {
        await sendTelegramMessage(c.env, chatId, `${chapterId} already has ${src.questionCount} questions ready. Say "start ${chapterId}" to begin studying.`);
        return c.json({ ok: true, status: 'ingest_already_done' });
      }
      if (src.ingestStatus === 'processing' || src.ingestStatus === 'queued') {
        await sendTelegramMessage(c.env, chatId, `${chapterId} ingest is already in progress (${src.ingestStatus}). Check back in ~1 minute.`);
        return c.json({ ok: true, status: 'ingest_in_progress' });
      }
      try {
        await store.completeSource(src.sourceId);
        await sendTelegramMessage(c.env, chatId, `Queued ingest for ${chapterId}. I'll have questions ready in ~1 minute. Say "ingest status ${chapterId}" to check.`);
      } catch {
        await sendTelegramMessage(c.env, chatId, `Could not queue ingest for ${chapterId}. Try again.`);
      }
      return c.json({ ok: true, status: 'ingest_queued' });
    }

    if (decision.route === 'start' || decision.route === 'resume' || decision.route === 'q1') {
      const chapterId =
        decision.route === 'resume'
          ? (activeSessionForPlanner?.chapterId ?? 'us-01')
          : (resolveDecisionChapterId(decision.chapterId, decision.chapterName) ?? 'us-01');
      const intentLabel: 'start' | 'q1' = decision.route === 'q1' ? 'q1' : 'start';
      const idempotencyKey = deriveTelegramIdempotencyKey({
        chatId,
        messageId,
        intent: intentLabel,
        chapterId,
      });
      const requestHash = await sha256Hex(
        JSON.stringify({
          update_id: update.update_id ?? null,
          text,
          intent: intentLabel,
          chapter_id: chapterId,
        }),
      );

      const existing = await idemStore.get(idempotencyKey, '/v1/telegram/webhook');
      if (existing) {
        if (existing.requestHash !== requestHash) return c.json({ ok: true, status: 'idempotency_conflict_ignored' });
        return c.json({ ok: true, deduped: true });
      }

      if (chatType !== 'private') {
        await sendTelegramMessage(c.env, chatId, 'Only direct-message Telegram chats are supported for study sessions.');
        await idemStore.put({
          idempotencyKey,
          endpoint: '/v1/telegram/webhook',
          requestHash,
          statusCode: 200,
          responseJson: JSON.stringify({ ok: true, status: 'unsupported_chat_type' }),
          nowIso: currentNowIso,
          ttlSeconds: IDEMPOTENCY_TTL_SECONDS,
        });
        return c.json({ ok: true, status: 'unsupported_chat_type' });
      }

      const session = await store.getOrCreateSession({
        chapterId,
        userId,
        telegramUserId: fromId,
        telegramChatId: chatId,
        nowIso: currentNowIso,
      });

      const questionIndex = decision.route === 'q1' ? 0 : session.currentQuestionIndex;
      const question = await store.getQuestionByIndex(chapterId, questionIndex);
      if (!question) {
        await sendTelegramMessage(c.env, chatId, `${chapterId} isn't ready yet — say "ingest ${chapterId}" to process it first.`);
        await idemStore.put({
          idempotencyKey,
          endpoint: '/v1/telegram/webhook',
          requestHash,
          statusCode: 200,
          responseJson: JSON.stringify({ ok: true, status: 'warming' }),
          nowIso: currentNowIso,
          ttlSeconds: IDEMPOTENCY_TTL_SECONDS,
        });
        return c.json({ ok: true, status: 'warming' });
      }

      await store.updateSessionPointer({
        sessionId: session.sessionId,
        questionIndex,
        lastQuestionId: session.lastQuestionId,
        currentQuestionPresentedAt: currentNowIso,
        nowIso: currentNowIso,
      });

      const questionText = buildQuestionText({
        questionNumber: questionIndex + 1,
        stem: question.stem,
        choices: question.choices,
      });
      const imageDescription = question.imageDescription ?? buildImageDescription({
        imageRef: question.imageRef,
        stem: question.stem,
        explanation: question.explanation,
      });

      await sendTelegramQuestion(c.env, {
        chatId,
        questionText,
        imageRef: question.imageRef,
        imageDescription,
      });

      await idemStore.put({
        idempotencyKey,
        endpoint: '/v1/telegram/webhook',
        requestHash,
        statusCode: 200,
        responseJson: JSON.stringify({ ok: true, status: 'sent_question', question_id: question.questionId }),
        nowIso: currentNowIso,
        ttlSeconds: IDEMPOTENCY_TTL_SECONDS,
      });

      return c.json({ ok: true, status: 'sent_question' });
    }

    // Fallback for unrecognized agent routes
    await sendTelegramMessage(c.env, chatId, 'Try: "start fast", "review new chapter focused echo", "misses", or A/B/C/D to answer.');
    return c.json({ ok: true, status: 'fallback' });
  });

  app.get('/v1/progress/:userId', async (c) => {
    const store = buildStore(c, deps);
    const userId = c.req.param('userId');
    const [chapters, pdfs, questions, topics, recentAttempts] = await Promise.all([
      store.listProgress(userId),
      store.listPdfProgress(userId),
      store.listQuestionProgress(userId),
      store.listTopicMastery(userId),
      store.listRecentAttempts(userId, 100),
    ]);

    return c.json({
      schema_version: schemaVersion(c),
      user_id: userId,
      chapters: chapters.map((row) => ({
        chapter_id: row.chapterId,
        questions_answered: row.questionsAnswered,
        questions_correct: row.questionsCorrect,
        accuracy: row.accuracy,
        updated_at: row.updatedAt,
      })),
      pdfs: pdfs.map((row) => ({
        source_id: row.sourceId,
        chapter_id: row.chapterId,
        questions_answered: row.questionsAnswered,
        questions_correct: row.questionsCorrect,
        accuracy: row.accuracy,
        avg_response_time_seconds: row.avgResponseTimeSeconds,
        confidence_avg: row.confidenceAvg,
        last_answered_at: row.lastAnsweredAt,
        updated_at: row.updatedAt,
      })),
      questions: questions.map((row) => ({
        question_id: row.questionId,
        chapter_id: row.chapterId,
        source_id: row.sourceId,
        topic: row.topic,
        questions_answered: row.questionsAnswered,
        questions_correct: row.questionsCorrect,
        accuracy: row.accuracy,
        avg_response_time_seconds: row.avgResponseTimeSeconds,
        confidence_avg: row.confidenceAvg,
        last_answered_at: row.lastAnsweredAt,
        updated_at: row.updatedAt,
      })),
      topics: topics.map((row) => ({
        topic: row.topic,
        questions_answered: row.questionsAnswered,
        questions_correct: row.questionsCorrect,
        accuracy: row.accuracy,
        avg_response_time_seconds: row.avgResponseTimeSeconds,
        confidence_mismatch_score: row.confidenceMismatchScore,
        mastery_score: row.masteryScore,
        weakness_rank: row.weaknessRank,
        last_answered_at: row.lastAnsweredAt,
        next_review_at: row.nextReviewAt,
        updated_at: row.updatedAt,
      })),
      recent_attempts: recentAttempts.map((row) => ({
        session_id: row.sessionId,
        question_id: row.questionId,
        chapter_id: row.chapterId,
        source_id: row.sourceId,
        topic: row.topic,
        selected_choice: row.selectedChoice,
        is_correct: row.isCorrect,
        response_time_seconds: row.responseTimeSeconds,
        confidence: row.confidence,
        created_at: row.createdAt,
      })),
    });
  });

  app.get('/v1/analytics/dashboard', async (c) => {
    const store = buildStore(c, deps);
    const dashboard = await store.getDashboard();
    const userId = c.req.query('user_id');
    const weakTopics =
      userId && userId.trim().length > 0 ? await store.listTopicMastery(userId).then((rows) => rows.slice(0, 5)) : [];
    const weakPdfs =
      userId && userId.trim().length > 0 ? await store.listPdfProgress(userId).then((rows) => rows.slice(0, 5)) : [];

    return c.json({
      schema_version: schemaVersion(c),
      questions_total: dashboard.questionsTotal,
      attempts_total: dashboard.attemptsTotal,
      sessions_active: dashboard.sessionsActive,
      chapter_cache_ready: dashboard.chapterCacheReady,
      chapter_cache_degraded: dashboard.chapterCacheDegraded,
      chapter_cache_empty: dashboard.chapterCacheEmpty,
      weak_topics: weakTopics.map((row) => ({
        topic: row.topic,
        mastery_score: row.masteryScore,
        accuracy: row.accuracy,
        weakness_rank: row.weaknessRank,
        next_review_at: row.nextReviewAt,
      })),
      weak_pdfs: weakPdfs.map((row) => ({
        source_id: row.sourceId,
        chapter_id: row.chapterId,
        accuracy: row.accuracy,
        questions_answered: row.questionsAnswered,
        last_answered_at: row.lastAnsweredAt,
      })),
      generated_at: nowIso(deps),
    });
  });

  app.notFound((c) => {
    return jsonError(c, 404, 'NOT_FOUND', 'route not found');
  });

  app.onError((error, c) => {
    console.error('Unhandled study-service error', error);
    return jsonError(c, 500, 'INTERNAL_ERROR', 'unexpected server error');
  });

  return app;
}

export function defaultSchemaVersion(): string {
  return DEFAULT_SCHEMA_VERSION;
}
