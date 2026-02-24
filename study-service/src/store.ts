import type {
  ChapterProgress,
  ChunkContext,
  Choice,
  PdfProgress,
  QuestionAttemptRecord,
  QuestionProgress,
  QuizQuestion,
  QuizSession,
  SourceRecord,
  StudyStore,
  TopicMastery,
  UploadSourceInput,
} from './types';
import { randomUUID as nodeRandomUUID } from 'node:crypto';

function safeJsonParseStringArray(input: string): string[] {
  try {
    const parsed = JSON.parse(input);
    if (Array.isArray(parsed) && parsed.every((value) => typeof value === 'string')) {
      return parsed;
    }
    return [];
  } catch {
    return [];
  }
}

function safeJsonParseChoices(input: string): string[] {
  try {
    const parsed = JSON.parse(input);
    if (Array.isArray(parsed) && parsed.every((value) => typeof value === 'string')) {
      return parsed;
    }
    return [];
  } catch {
    return [];
  }
}

function timestampIso(): string {
  return new Date().toISOString();
}

function sanitizeFilename(filename: string): string {
  return filename
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function generateId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return nodeRandomUUID();
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function daysFromNowIso(inputIso: string, days: number): string {
  const base = Date.parse(inputIso);
  const ms = Number.isFinite(base) ? base : Date.now();
  return new Date(ms + days * 24 * 60 * 60 * 1000).toISOString();
}

function nextReviewForMastery(nowIso: string, masteryScore: number): string {
  if (masteryScore < 0.6) {
    return daysFromNowIso(nowIso, 1);
  }
  if (masteryScore < 0.8) {
    return daysFromNowIso(nowIso, 3);
  }
  return daysFromNowIso(nowIso, 7);
}

function pilotQuestionForIndex(input: {
  chapterId: string;
  questionIndex: number;
  chunkId: string;
  imageRef: string | null;
}): QuizQuestion {
  const questionNumber = String(input.questionIndex + 1).padStart(3, '0');
  const stems = [
    'Which FAST view best evaluates hepatorenal free fluid?',
    'A positive FAST in trauma most strongly suggests which finding?',
    'Which FAST window is used to evaluate pericardial effusion?',
    'Which patient state most supports repeating FAST serially?',
  ];

  const choiceSets = [
    ['RUQ (Morison pouch)', 'Apical four-chamber', 'Popliteal fossa', 'Thyroid bed'],
    ['Intra-abdominal free fluid', 'Pleural effusion only', 'Hydronephrosis', 'Portal venous gas'],
    ['Subxiphoid cardiac view', 'Transvaginal view', 'Supraclavicular view', 'Ocular view'],
    ['Ongoing hypotension after initial negative exam', 'Stable ankle sprain', 'Isolated rash', 'Chronic tinnitus'],
  ];

  const explanations = [
    'Morison pouch in RUQ is the classic FAST location for detecting free intraperitoneal fluid.',
    'FAST is designed to identify pathologic free fluid in trauma contexts.',
    'The subxiphoid window is used to rapidly evaluate pericardial fluid in FAST.',
    'If shock persists, repeating FAST can capture evolving free fluid missed early.',
  ];

  const setIndex = input.questionIndex % stems.length;
  return {
    questionId: `${input.chapterId}-pilot-q${questionNumber}`,
    chapterId: input.chapterId,
    stem: stems[setIndex],
    choices: choiceSets[setIndex],
    correctChoice: 'A',
    explanation: explanations[setIndex],
    sourceChunkIds: [input.chunkId],
    sourceId: null,
    topic: 'fast',
    difficulty: 'medium',
    imageRef: input.questionIndex === 0 ? input.imageRef : null,
    imageDescription: null,
  };
}

export class D1StudyStore implements StudyStore {
  constructor(private readonly db: D1Database) {}

  async createSource(
    input: UploadSourceInput,
  ): Promise<{ sourceId: string; objectKey: string; uploadUrl: string; expiresAt: string }> {
    const nowIso = timestampIso();
    const sourceId = generateId();
    const objectKey = `sources/uploads/${sourceId}-${sanitizeFilename(input.filename)}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    await this.db
      .prepare(
        `INSERT INTO source
          (id, chapter_id, object_key, filename, content_type, byte_size, sha256, status, source_label, parse_confidence, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, 'registered', ?7, NULL, ?8, ?8)`,
      )
      .bind(
        sourceId,
        input.chapterId ?? null,
        objectKey,
        input.filename,
        input.contentType,
        input.sha256 ?? null,
        input.sourceLabel ?? null,
        nowIso,
      )
      .run();

    return {
      sourceId,
      objectKey,
      uploadUrl: `r2://clawstudydata/${objectKey}`,
      expiresAt,
    };
  }

  async completeSource(sourceId: string): Promise<{ ingestJobId: string; status: 'queued' }> {
    const nowIso = timestampIso();

    const source = await this.db
      .prepare('SELECT id FROM source WHERE id = ?1 LIMIT 1')
      .bind(sourceId)
      .first<{ id: string }>();

    if (!source) {
      throw new Error('source_not_found');
    }

    await this.db
      .prepare(`UPDATE source SET status = 'uploaded', updated_at = ?2 WHERE id = ?1`)
      .bind(sourceId, nowIso)
      .run();

    const ingestJobId = generateId();
    await this.db
      .prepare(
        `INSERT INTO ingest_job
          (id, source_id, status, attempt_count, started_at, completed_at, error_code, error_detail, created_at, updated_at)
         VALUES (?1, ?2, 'queued', 0, NULL, NULL, NULL, NULL, ?3, ?3)`,
      )
      .bind(ingestJobId, sourceId, nowIso)
      .run();

    return {
      ingestJobId,
      status: 'queued',
    };
  }

  async getSourceByChapterId(chapterId: string): Promise<{ sourceId: string; ingestStatus: string | null; questionCount: number } | null> {
    const source = await this.db
      .prepare(
        `SELECT s.id as source_id,
                (SELECT ij.status FROM ingest_job ij WHERE ij.source_id = s.id ORDER BY ij.created_at DESC LIMIT 1) as ingest_status,
                (SELECT COUNT(*) FROM question q WHERE q.chapter_id = ?1) as question_count
         FROM source s
         WHERE s.chapter_id = ?1
         ORDER BY s.created_at DESC
         LIMIT 1`,
      )
      .bind(chapterId)
      .first<{ source_id: string; ingest_status: string | null; question_count: number }>();

    if (!source) return null;
    return {
      sourceId: source.source_id,
      ingestStatus: source.ingest_status,
      questionCount: Number(source.question_count ?? 0),
    };
  }

  async getSourceStatus(sourceId: string): Promise<SourceRecord | null> {
    const source = await this.db
      .prepare(
        `SELECT id, chapter_id, status, object_key, parse_confidence
         FROM source
         WHERE id = ?1
         LIMIT 1`,
      )
      .bind(sourceId)
      .first<{
        id: string;
        chapter_id: string | null;
        status: 'registered' | 'uploaded' | 'ingested' | 'failed';
        object_key: string;
        parse_confidence: number | null;
      }>();

    if (!source) {
      return null;
    }

    const ingest = await this.db
      .prepare(
        `SELECT status, error_code
         FROM ingest_job
         WHERE source_id = ?1
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .bind(sourceId)
      .first<{ status: 'queued' | 'processing' | 'completed' | 'failed'; error_code: string | null }>();

    const chunkCountRow = await this.db
      .prepare('SELECT COUNT(*) as count FROM chunk WHERE source_id = ?1')
      .bind(sourceId)
      .first<{ count: number }>();

    return {
      sourceId,
      chapterId: source.chapter_id,
      uploadStatus: source.status,
      ingestStatus: ingest?.status ?? null,
      objectKey: source.object_key,
      parseConfidence: source.parse_confidence,
      chunkCount: Number(chunkCountRow?.count ?? 0),
      errorCode: ingest?.error_code ?? null,
    };
  }

  async getOrCreateSession(input: {
    chapterId: string;
    userId: string;
    telegramUserId: string | null;
    telegramChatId: string | null;
    nowIso: string;
  }): Promise<QuizSession> {
    await this.db
      .prepare(
        `UPDATE quiz_session
         SET status = 'paused', updated_at = ?3
         WHERE user_id = ?1
           AND status = 'active'
           AND chapter_id <> ?2`,
      )
      .bind(input.userId, input.chapterId, input.nowIso)
      .run();

    const existing = await this.db
      .prepare(
        `SELECT id, user_id, chapter_id, status, current_question_index, last_question_id, current_question_presented_at, telegram_user_id, telegram_chat_id
         FROM quiz_session
         WHERE user_id = ?1
           AND chapter_id = ?2
           AND status = 'active'
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .bind(input.userId, input.chapterId)
      .first<{
        id: string;
        user_id: string;
        chapter_id: string;
        status: 'active' | 'completed' | 'paused';
        current_question_index: number;
        last_question_id: string | null;
        current_question_presented_at: string | null;
        telegram_user_id: string | null;
        telegram_chat_id: string | null;
      }>();

    if (existing) {
      return {
        sessionId: existing.id,
        userId: existing.user_id,
        chapterId: existing.chapter_id,
        status: existing.status,
        currentQuestionIndex: Number(existing.current_question_index),
        lastQuestionId: existing.last_question_id,
        currentQuestionPresentedAt: existing.current_question_presented_at,
        telegramUserId: existing.telegram_user_id,
        telegramChatId: existing.telegram_chat_id,
      };
    }

    const sessionId = generateId();
    await this.db
      .prepare(
        `INSERT INTO quiz_session
          (id, user_id, chapter_id, status, current_question_index, last_question_id, current_question_presented_at, telegram_user_id, telegram_chat_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'active', 0, NULL, NULL, ?4, ?5, ?6, ?6)`,
      )
      .bind(sessionId, input.userId, input.chapterId, input.telegramUserId, input.telegramChatId, input.nowIso)
      .run();

    return {
      sessionId,
      userId: input.userId,
      chapterId: input.chapterId,
      status: 'active',
      currentQuestionIndex: 0,
      lastQuestionId: null,
      currentQuestionPresentedAt: null,
      telegramUserId: input.telegramUserId,
      telegramChatId: input.telegramChatId,
    };
  }

  async getSessionById(sessionId: string): Promise<QuizSession | null> {
    const row = await this.db
      .prepare(
        `SELECT id, user_id, chapter_id, status, current_question_index, last_question_id, current_question_presented_at, telegram_user_id, telegram_chat_id
         FROM quiz_session
         WHERE id = ?1
         LIMIT 1`,
      )
      .bind(sessionId)
      .first<{
        id: string;
        user_id: string;
        chapter_id: string;
        status: 'active' | 'completed' | 'paused';
        current_question_index: number;
        last_question_id: string | null;
        current_question_presented_at: string | null;
        telegram_user_id: string | null;
        telegram_chat_id: string | null;
      }>();

    if (!row) {
      return null;
    }

    return {
      sessionId: row.id,
      userId: row.user_id,
      chapterId: row.chapter_id,
      status: row.status,
      currentQuestionIndex: Number(row.current_question_index),
      lastQuestionId: row.last_question_id,
      currentQuestionPresentedAt: row.current_question_presented_at,
      telegramUserId: row.telegram_user_id,
      telegramChatId: row.telegram_chat_id,
    };
  }

  async getActiveSessionByUser(userId: string): Promise<QuizSession | null> {
    const row = await this.db
      .prepare(
        `SELECT id, user_id, chapter_id, status, current_question_index, last_question_id, current_question_presented_at, telegram_user_id, telegram_chat_id
         FROM quiz_session
         WHERE user_id = ?1
           AND status = 'active'
         ORDER BY updated_at DESC
         LIMIT 1`,
      )
      .bind(userId)
      .first<{
        id: string;
        user_id: string;
        chapter_id: string;
        status: 'active' | 'completed' | 'paused';
        current_question_index: number;
        last_question_id: string | null;
        current_question_presented_at: string | null;
        telegram_user_id: string | null;
        telegram_chat_id: string | null;
      }>();

    if (!row) {
      return null;
    }

    return {
      sessionId: row.id,
      userId: row.user_id,
      chapterId: row.chapter_id,
      status: row.status,
      currentQuestionIndex: Number(row.current_question_index),
      lastQuestionId: row.last_question_id,
      currentQuestionPresentedAt: row.current_question_presented_at,
      telegramUserId: row.telegram_user_id,
      telegramChatId: row.telegram_chat_id,
    };
  }

  async getQuestionByIndex(chapterId: string, questionIndex: number): Promise<QuizQuestion | null> {
    const row = await this.db
      .prepare(
        `SELECT id, chapter_id, stem, choices_json, correct_choice, explanation, source_chunk_ids_json, source_id, topic, difficulty, image_ref, image_description
         FROM question
         WHERE chapter_id = ?1
         ORDER BY created_at ASC, id ASC
         LIMIT 1 OFFSET ?2`,
      )
      .bind(chapterId, questionIndex)
      .first<{
        id: string;
        chapter_id: string;
        stem: string;
        choices_json: string;
        correct_choice: Choice;
        explanation: string;
        source_chunk_ids_json: string;
        source_id: string | null;
        topic: string | null;
        difficulty: string | null;
        image_ref: string | null;
        image_description: string | null;
      }>();

    if (!row) {
      return null;
    }

    return {
      questionId: row.id,
      chapterId: row.chapter_id,
      stem: row.stem,
      choices: safeJsonParseChoices(row.choices_json),
      correctChoice: row.correct_choice,
      explanation: row.explanation,
      sourceChunkIds: safeJsonParseStringArray(row.source_chunk_ids_json),
      sourceId: row.source_id,
      topic: row.topic ?? 'unknown',
      difficulty: row.difficulty ?? 'medium',
      imageRef: row.image_ref,
      imageDescription: row.image_description ?? null,
    };
  }

  async getQuestionById(questionId: string): Promise<QuizQuestion | null> {
    const row = await this.db
      .prepare(
        `SELECT id, chapter_id, stem, choices_json, correct_choice, explanation, source_chunk_ids_json, source_id, topic, difficulty, image_ref, image_description
         FROM question
         WHERE id = ?1
         LIMIT 1`,
      )
      .bind(questionId)
      .first<{
        id: string;
        chapter_id: string;
        stem: string;
        choices_json: string;
        correct_choice: Choice;
        explanation: string;
        source_chunk_ids_json: string;
        source_id: string | null;
        topic: string | null;
        difficulty: string | null;
        image_ref: string | null;
        image_description: string | null;
      }>();

    if (!row) {
      return null;
    }

    return {
      questionId: row.id,
      chapterId: row.chapter_id,
      stem: row.stem,
      choices: safeJsonParseChoices(row.choices_json),
      correctChoice: row.correct_choice,
      explanation: row.explanation,
      sourceChunkIds: safeJsonParseStringArray(row.source_chunk_ids_json),
      sourceId: row.source_id,
      topic: row.topic ?? 'unknown',
      difficulty: row.difficulty ?? 'medium',
      imageRef: row.image_ref,
      imageDescription: row.image_description ?? null,
    };
  }

  async getChunkContexts(chunkIds: string[]): Promise<ChunkContext[]> {
    const ids = chunkIds.filter((id) => typeof id === 'string' && id.trim().length > 0);
    if (ids.length === 0) {
      return [];
    }

    const placeholders = ids.map((_value, index) => `?${index + 1}`).join(', ');
    const rows = await this.db
      .prepare(
        `SELECT id, source_id, topic_tag, text, chunk_index
         FROM chunk
         WHERE id IN (${placeholders})`,
      )
      .bind(...ids)
      .all<{
        id: string;
        source_id: string | null;
        topic_tag: string | null;
        text: string;
        chunk_index: number;
      }>();

    const byId = new Map<string, ChunkContext>();
    for (const row of rows.results ?? []) {
      byId.set(row.id, {
        chunkId: row.id,
        sourceId: row.source_id,
        topicTag: row.topic_tag,
        text: row.text,
      });
    }

    return ids
      .map((id) => byId.get(id))
      .filter((row): row is ChunkContext => Boolean(row));
  }

  async recordAttempt(input: {
    sessionId: string;
    questionId: string;
    selectedChoice: Choice;
    isCorrect: boolean;
    responseTimeSeconds: number;
    confidence: number | null;
    idempotencyKey: string;
    nowIso: string;
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO question_attempt
          (id, session_id, question_id, selected_choice, is_correct, response_time_seconds, confidence, idempotency_key, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      )
      .bind(
        generateId(),
        input.sessionId,
        input.questionId,
        input.selectedChoice,
        input.isCorrect ? 1 : 0,
        input.responseTimeSeconds,
        input.confidence,
        input.idempotencyKey,
        input.nowIso,
      )
      .run();
  }

  async recomputeProgress(input: {
    userId: string;
    chapterId: string;
    nowIso: string;
  }): Promise<ChapterProgress> {
    const counts = await this.db
      .prepare(
        `SELECT
           COUNT(*) as answered,
           COALESCE(SUM(qa.is_correct), 0) as correct
         FROM question_attempt qa
         INNER JOIN quiz_session qs ON qs.id = qa.session_id
         WHERE qs.user_id = ?1
           AND qs.chapter_id = ?2`,
      )
      .bind(input.userId, input.chapterId)
      .first<{ answered: number; correct: number }>();

    const answered = Number(counts?.answered ?? 0);
    const correct = Number(counts?.correct ?? 0);
    const accuracy = answered > 0 ? correct / answered : 0;

    await this.db
      .prepare(
        `INSERT INTO chapter_progress
          (user_id, chapter_id, answered, correct, accuracy, last_question_at, next_review_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?6)
         ON CONFLICT(user_id, chapter_id) DO UPDATE SET
           answered = excluded.answered,
           correct = excluded.correct,
           accuracy = excluded.accuracy,
           last_question_at = excluded.last_question_at,
           updated_at = excluded.updated_at`,
      )
      .bind(input.userId, input.chapterId, answered, correct, accuracy, input.nowIso)
      .run();

    return {
      userId: input.userId,
      chapterId: input.chapterId,
      questionsAnswered: answered,
      questionsCorrect: correct,
      accuracy,
      updatedAt: input.nowIso,
    };
  }

  async recomputeQuestionProgress(input: {
    userId: string;
    questionId: string;
    nowIso: string;
  }): Promise<QuestionProgress | null> {
    const row = await this.db
      .prepare(
        `SELECT
           q.chapter_id AS chapter_id,
           q.source_id AS source_id,
           COALESCE(q.topic, 'unknown') AS topic,
           COUNT(*) AS answered,
           COALESCE(SUM(qa.is_correct), 0) AS correct,
           AVG(qa.response_time_seconds) AS avg_response_time_seconds,
           AVG(qa.confidence) AS confidence_avg,
           MAX(qa.created_at) AS last_answered_at
         FROM question_attempt qa
         INNER JOIN quiz_session qs ON qs.id = qa.session_id
         INNER JOIN question q ON q.id = qa.question_id
         WHERE qs.user_id = ?1
           AND qa.question_id = ?2`,
      )
      .bind(input.userId, input.questionId)
      .first<{
        chapter_id: string;
        source_id: string | null;
        topic: string;
        answered: number;
        correct: number;
        avg_response_time_seconds: number | null;
        confidence_avg: number | null;
        last_answered_at: string | null;
      }>();

    const answered = Number(row?.answered ?? 0);
    if (!row || answered === 0) {
      return null;
    }

    const correct = Number(row.correct ?? 0);
    const accuracy = answered > 0 ? correct / answered : 0;
    const avgResponseTimeSeconds = row.avg_response_time_seconds === null ? null : Number(row.avg_response_time_seconds);
    const confidenceAvg = row.confidence_avg === null ? null : Number(row.confidence_avg);

    await this.db
      .prepare(
        `INSERT INTO question_progress
          (user_id, question_id, chapter_id, source_id, topic, answered, correct, accuracy, avg_response_time_seconds, confidence_avg, last_answered_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT(user_id, question_id) DO UPDATE SET
           chapter_id = excluded.chapter_id,
           source_id = excluded.source_id,
           topic = excluded.topic,
           answered = excluded.answered,
           correct = excluded.correct,
           accuracy = excluded.accuracy,
           avg_response_time_seconds = excluded.avg_response_time_seconds,
           confidence_avg = excluded.confidence_avg,
           last_answered_at = excluded.last_answered_at,
           updated_at = excluded.updated_at`,
      )
      .bind(
        input.userId,
        input.questionId,
        row.chapter_id,
        row.source_id,
        row.topic,
        answered,
        correct,
        accuracy,
        avgResponseTimeSeconds,
        confidenceAvg,
        row.last_answered_at,
        input.nowIso,
      )
      .run();

    return {
      userId: input.userId,
      questionId: input.questionId,
      chapterId: row.chapter_id,
      sourceId: row.source_id,
      topic: row.topic,
      questionsAnswered: answered,
      questionsCorrect: correct,
      accuracy,
      avgResponseTimeSeconds,
      confidenceAvg,
      lastAnsweredAt: row.last_answered_at,
      updatedAt: input.nowIso,
    };
  }

  async recomputePdfProgress(input: {
    userId: string;
    sourceId: string;
    nowIso: string;
  }): Promise<PdfProgress | null> {
    const row = await this.db
      .prepare(
        `SELECT
           q.source_id AS source_id,
           MIN(q.chapter_id) AS chapter_id,
           COUNT(*) AS answered,
           COALESCE(SUM(qa.is_correct), 0) AS correct,
           AVG(qa.response_time_seconds) AS avg_response_time_seconds,
           AVG(qa.confidence) AS confidence_avg,
           MAX(qa.created_at) AS last_answered_at
         FROM question_attempt qa
         INNER JOIN quiz_session qs ON qs.id = qa.session_id
         INNER JOIN question q ON q.id = qa.question_id
         WHERE qs.user_id = ?1
           AND q.source_id = ?2`,
      )
      .bind(input.userId, input.sourceId)
      .first<{
        source_id: string;
        chapter_id: string | null;
        answered: number;
        correct: number;
        avg_response_time_seconds: number | null;
        confidence_avg: number | null;
        last_answered_at: string | null;
      }>();

    const answered = Number(row?.answered ?? 0);
    if (!row || answered === 0) {
      return null;
    }

    const correct = Number(row.correct ?? 0);
    const accuracy = answered > 0 ? correct / answered : 0;
    const avgResponseTimeSeconds = row.avg_response_time_seconds === null ? null : Number(row.avg_response_time_seconds);
    const confidenceAvg = row.confidence_avg === null ? null : Number(row.confidence_avg);

    await this.db
      .prepare(
        `INSERT INTO pdf_progress
          (user_id, source_id, chapter_id, answered, correct, accuracy, avg_response_time_seconds, confidence_avg, last_answered_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(user_id, source_id) DO UPDATE SET
           chapter_id = excluded.chapter_id,
           answered = excluded.answered,
           correct = excluded.correct,
           accuracy = excluded.accuracy,
           avg_response_time_seconds = excluded.avg_response_time_seconds,
           confidence_avg = excluded.confidence_avg,
           last_answered_at = excluded.last_answered_at,
           updated_at = excluded.updated_at`,
      )
      .bind(
        input.userId,
        row.source_id,
        row.chapter_id,
        answered,
        correct,
        accuracy,
        avgResponseTimeSeconds,
        confidenceAvg,
        row.last_answered_at,
        input.nowIso,
      )
      .run();

    return {
      userId: input.userId,
      sourceId: row.source_id,
      chapterId: row.chapter_id,
      questionsAnswered: answered,
      questionsCorrect: correct,
      accuracy,
      avgResponseTimeSeconds,
      confidenceAvg,
      lastAnsweredAt: row.last_answered_at,
      updatedAt: input.nowIso,
    };
  }

  async recomputeTopicMastery(input: {
    userId: string;
    topic: string;
    nowIso: string;
  }): Promise<TopicMastery | null> {
    const row = await this.db
      .prepare(
        `SELECT
           COUNT(*) AS answered,
           COALESCE(SUM(qa.is_correct), 0) AS correct,
           AVG(qa.response_time_seconds) AS avg_response_time_seconds,
           AVG(
             CASE
               WHEN qa.confidence IS NULL THEN NULL
               WHEN qa.is_correct = 1 THEN (1 - qa.confidence)
               ELSE qa.confidence
             END
           ) AS confidence_mismatch_score,
           MAX(qa.created_at) AS last_answered_at
         FROM question_attempt qa
         INNER JOIN quiz_session qs ON qs.id = qa.session_id
         INNER JOIN question q ON q.id = qa.question_id
         WHERE qs.user_id = ?1
           AND COALESCE(q.topic, 'unknown') = ?2`,
      )
      .bind(input.userId, input.topic)
      .first<{
        answered: number;
        correct: number;
        avg_response_time_seconds: number | null;
        confidence_mismatch_score: number | null;
        last_answered_at: string | null;
      }>();

    const answered = Number(row?.answered ?? 0);
    if (!row || answered === 0) {
      return null;
    }

    const correct = Number(row.correct ?? 0);
    const accuracy = answered > 0 ? correct / answered : 0;
    const avgResponseTimeSeconds = row.avg_response_time_seconds === null ? null : Number(row.avg_response_time_seconds);
    const confidenceMismatchScore = clamp01(Number(row.confidence_mismatch_score ?? 0));
    const speedScore = avgResponseTimeSeconds === null ? 0.5 : clamp01(1 - avgResponseTimeSeconds / 60);
    const masteryScore = clamp01(accuracy * 0.75 + speedScore * 0.2 - confidenceMismatchScore * 0.15);
    const nextReviewAt = nextReviewForMastery(input.nowIso, masteryScore);

    await this.db
      .prepare(
        `INSERT INTO topic_mastery
          (user_id, topic, answered, correct, accuracy, avg_response_time_seconds, confidence_mismatch_score, mastery_score, weakness_rank, last_answered_at, next_review_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, ?10, ?11)
         ON CONFLICT(user_id, topic) DO UPDATE SET
           answered = excluded.answered,
           correct = excluded.correct,
           accuracy = excluded.accuracy,
           avg_response_time_seconds = excluded.avg_response_time_seconds,
           confidence_mismatch_score = excluded.confidence_mismatch_score,
           mastery_score = excluded.mastery_score,
           last_answered_at = excluded.last_answered_at,
           next_review_at = excluded.next_review_at,
           updated_at = excluded.updated_at`,
      )
      .bind(
        input.userId,
        input.topic,
        answered,
        correct,
        accuracy,
        avgResponseTimeSeconds,
        confidenceMismatchScore,
        masteryScore,
        row.last_answered_at,
        nextReviewAt,
        input.nowIso,
      )
      .run();

    const existingRank = await this.db
      .prepare(
        `SELECT weakness_rank
         FROM topic_mastery
         WHERE user_id = ?1
           AND topic = ?2
         LIMIT 1`,
      )
      .bind(input.userId, input.topic)
      .first<{ weakness_rank: number | null }>();

    return {
      userId: input.userId,
      topic: input.topic,
      questionsAnswered: answered,
      questionsCorrect: correct,
      accuracy,
      avgResponseTimeSeconds,
      confidenceMismatchScore,
      masteryScore,
      weaknessRank: existingRank?.weakness_rank ?? null,
      lastAnsweredAt: row.last_answered_at,
      nextReviewAt,
      updatedAt: input.nowIso,
    };
  }

  async refreshTopicWeaknessRanks(userId: string): Promise<void> {
    const rows = await this.db
      .prepare(
        `SELECT topic
         FROM topic_mastery
         WHERE user_id = ?1
         ORDER BY mastery_score ASC, accuracy ASC, answered DESC, topic ASC`,
      )
      .bind(userId)
      .all<{ topic: string }>();

    let rank = 1;
    for (const row of rows.results ?? []) {
      await this.db
        .prepare(
          `UPDATE topic_mastery
           SET weakness_rank = ?3
           WHERE user_id = ?1
             AND topic = ?2`,
        )
        .bind(userId, row.topic, rank)
        .run();
      rank += 1;
    }
  }

  async updateSessionPointer(input: {
    sessionId: string;
    questionIndex: number;
    lastQuestionId: string | null;
    currentQuestionPresentedAt: string | null;
    nowIso: string;
  }): Promise<void> {
    await this.db
      .prepare(
        `UPDATE quiz_session
         SET current_question_index = ?2,
             last_question_id = ?3,
             current_question_presented_at = ?4,
             updated_at = ?5
         WHERE id = ?1`,
      )
      .bind(
        input.sessionId,
        input.questionIndex,
        input.lastQuestionId,
        input.currentQuestionPresentedAt,
        input.nowIso,
      )
      .run();
  }

  async listProgress(userId: string): Promise<ChapterProgress[]> {
    const result = await this.db
      .prepare(
        `SELECT user_id, chapter_id, answered, correct, accuracy, updated_at
         FROM chapter_progress
         WHERE user_id = ?1
         ORDER BY chapter_id ASC`,
      )
      .bind(userId)
      .all<{
        user_id: string;
        chapter_id: string;
        answered: number;
        correct: number;
        accuracy: number;
        updated_at: string;
      }>();

    return (result.results ?? []).map((row) => ({
      userId: row.user_id,
      chapterId: row.chapter_id,
      questionsAnswered: Number(row.answered),
      questionsCorrect: Number(row.correct),
      accuracy: Number(row.accuracy),
      updatedAt: row.updated_at,
    }));
  }

  async listPdfProgress(userId: string): Promise<PdfProgress[]> {
    const rows = await this.db
      .prepare(
        `SELECT user_id, source_id, chapter_id, answered, correct, accuracy, avg_response_time_seconds, confidence_avg, last_answered_at, updated_at
         FROM pdf_progress
         WHERE user_id = ?1
         ORDER BY accuracy ASC, source_id ASC`,
      )
      .bind(userId)
      .all<{
        user_id: string;
        source_id: string;
        chapter_id: string | null;
        answered: number;
        correct: number;
        accuracy: number;
        avg_response_time_seconds: number | null;
        confidence_avg: number | null;
        last_answered_at: string | null;
        updated_at: string;
      }>();

    return (rows.results ?? []).map((row) => ({
      userId: row.user_id,
      sourceId: row.source_id,
      chapterId: row.chapter_id,
      questionsAnswered: Number(row.answered),
      questionsCorrect: Number(row.correct),
      accuracy: Number(row.accuracy),
      avgResponseTimeSeconds: row.avg_response_time_seconds === null ? null : Number(row.avg_response_time_seconds),
      confidenceAvg: row.confidence_avg === null ? null : Number(row.confidence_avg),
      lastAnsweredAt: row.last_answered_at,
      updatedAt: row.updated_at,
    }));
  }

  async listQuestionProgress(userId: string): Promise<QuestionProgress[]> {
    const rows = await this.db
      .prepare(
        `SELECT user_id, question_id, chapter_id, source_id, topic, answered, correct, accuracy, avg_response_time_seconds, confidence_avg, last_answered_at, updated_at
         FROM question_progress
         WHERE user_id = ?1
         ORDER BY updated_at DESC, question_id ASC`,
      )
      .bind(userId)
      .all<{
        user_id: string;
        question_id: string;
        chapter_id: string;
        source_id: string | null;
        topic: string;
        answered: number;
        correct: number;
        accuracy: number;
        avg_response_time_seconds: number | null;
        confidence_avg: number | null;
        last_answered_at: string | null;
        updated_at: string;
      }>();

    return (rows.results ?? []).map((row) => ({
      userId: row.user_id,
      questionId: row.question_id,
      chapterId: row.chapter_id,
      sourceId: row.source_id,
      topic: row.topic,
      questionsAnswered: Number(row.answered),
      questionsCorrect: Number(row.correct),
      accuracy: Number(row.accuracy),
      avgResponseTimeSeconds: row.avg_response_time_seconds === null ? null : Number(row.avg_response_time_seconds),
      confidenceAvg: row.confidence_avg === null ? null : Number(row.confidence_avg),
      lastAnsweredAt: row.last_answered_at,
      updatedAt: row.updated_at,
    }));
  }

  async listTopicMastery(userId: string): Promise<TopicMastery[]> {
    const rows = await this.db
      .prepare(
        `SELECT user_id, topic, answered, correct, accuracy, avg_response_time_seconds, confidence_mismatch_score, mastery_score, weakness_rank, last_answered_at, next_review_at, updated_at
         FROM topic_mastery
         WHERE user_id = ?1
         ORDER BY CASE WHEN weakness_rank IS NULL THEN 999999 ELSE weakness_rank END ASC, topic ASC`,
      )
      .bind(userId)
      .all<{
        user_id: string;
        topic: string;
        answered: number;
        correct: number;
        accuracy: number;
        avg_response_time_seconds: number | null;
        confidence_mismatch_score: number;
        mastery_score: number;
        weakness_rank: number | null;
        last_answered_at: string | null;
        next_review_at: string | null;
        updated_at: string;
      }>();

    return (rows.results ?? []).map((row) => ({
      userId: row.user_id,
      topic: row.topic,
      questionsAnswered: Number(row.answered),
      questionsCorrect: Number(row.correct),
      accuracy: Number(row.accuracy),
      avgResponseTimeSeconds: row.avg_response_time_seconds === null ? null : Number(row.avg_response_time_seconds),
      confidenceMismatchScore: Number(row.confidence_mismatch_score),
      masteryScore: Number(row.mastery_score),
      weaknessRank: row.weakness_rank,
      lastAnsweredAt: row.last_answered_at,
      nextReviewAt: row.next_review_at,
      updatedAt: row.updated_at,
    }));
  }

  async listRecentAttempts(userId: string, limit: number): Promise<QuestionAttemptRecord[]> {
    const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 50;
    const rows = await this.db
      .prepare(
        `SELECT
           qs.user_id AS user_id,
           qa.session_id AS session_id,
           qa.question_id AS question_id,
           q.chapter_id AS chapter_id,
           q.source_id AS source_id,
           COALESCE(q.topic, 'unknown') AS topic,
           qa.selected_choice AS selected_choice,
           qa.is_correct AS is_correct,
           qa.response_time_seconds AS response_time_seconds,
           qa.confidence AS confidence,
           qa.created_at AS created_at
         FROM question_attempt qa
         INNER JOIN quiz_session qs ON qs.id = qa.session_id
         INNER JOIN question q ON q.id = qa.question_id
         WHERE qs.user_id = ?1
         ORDER BY qa.created_at DESC
         LIMIT ?2`,
      )
      .bind(userId, safeLimit)
      .all<{
        user_id: string;
        session_id: string;
        question_id: string;
        chapter_id: string;
        source_id: string | null;
        topic: string;
        selected_choice: Choice;
        is_correct: number;
        response_time_seconds: number;
        confidence: number | null;
        created_at: string;
      }>();

    return (rows.results ?? []).map((row) => ({
      userId: row.user_id,
      sessionId: row.session_id,
      questionId: row.question_id,
      chapterId: row.chapter_id,
      sourceId: row.source_id,
      topic: row.topic,
      selectedChoice: row.selected_choice,
      isCorrect: Number(row.is_correct) === 1,
      responseTimeSeconds: Number(row.response_time_seconds),
      confidence: row.confidence === null ? null : Number(row.confidence),
      createdAt: row.created_at,
    }));
  }

  async getDashboard(): Promise<{
    questionsTotal: number;
    attemptsTotal: number;
    sessionsActive: number;
    chapterCacheReady: number;
    chapterCacheDegraded: number;
    chapterCacheEmpty: number;
  }> {
    const questionsTotalRow = await this.db.prepare('SELECT COUNT(*) as count FROM question').first<{ count: number }>();
    const attemptsTotalRow = await this.db
      .prepare('SELECT COUNT(*) as count FROM question_attempt')
      .first<{ count: number }>();
    const sessionsActiveRow = await this.db
      .prepare("SELECT COUNT(*) as count FROM quiz_session WHERE status = 'active'")
      .first<{ count: number }>();

    const cacheRows = await this.db
      .prepare('SELECT chapter_id, COUNT(*) as count FROM question GROUP BY chapter_id')
      .all<{ chapter_id: string; count: number }>();
    const chapterUniverseRows = await this.db
      .prepare(
        `SELECT chapter_id
         FROM source
         WHERE chapter_id IS NOT NULL
         UNION
         SELECT chapter_id
         FROM question`,
      )
      .all<{ chapter_id: string }>();

    let chapterCacheReady = 0;
    let chapterCacheDegraded = 0;
    for (const row of cacheRows.results ?? []) {
      const count = Number(row.count);
      if (count >= 20) {
        chapterCacheReady += 1;
      } else if (count > 0) {
        chapterCacheDegraded += 1;
      }
    }
    const chapterUniverseCount = (chapterUniverseRows.results ?? []).length;
    const chapterCacheEmpty = Math.max(chapterUniverseCount - chapterCacheReady - chapterCacheDegraded, 0);

    return {
      questionsTotal: Number(questionsTotalRow?.count ?? 0),
      attemptsTotal: Number(attemptsTotalRow?.count ?? 0),
      sessionsActive: Number(sessionsActiveRow?.count ?? 0),
      chapterCacheReady,
      chapterCacheDegraded,
      chapterCacheEmpty,
    };
  }

  async seedPilotChapter(input: {
    chapterId: string;
    sourceObjectKey: string;
    imageObjectKey: string | null;
    questionCount: number;
    nowIso: string;
  }): Promise<{ chapterId: string; questionCount: number; imageQuestionCount: number }> {
    const existingChapterSourceIds = await this.db
      .prepare('SELECT id FROM source WHERE chapter_id = ?1')
      .bind(input.chapterId)
      .all<{ id: string }>();
    const sourceIds = (existingChapterSourceIds.results ?? []).map((row) => row.id);

    await this.db
      .prepare(
        `DELETE FROM question_attempt
         WHERE session_id IN (
           SELECT id FROM quiz_session WHERE chapter_id = ?1
         )`,
      )
      .bind(input.chapterId)
      .run();
    await this.db.prepare('DELETE FROM quiz_session WHERE chapter_id = ?1').bind(input.chapterId).run();
    await this.db.prepare('DELETE FROM chapter_progress WHERE chapter_id = ?1').bind(input.chapterId).run();
    await this.db.prepare('DELETE FROM question_progress WHERE chapter_id = ?1').bind(input.chapterId).run();
    await this.db.prepare('DELETE FROM question WHERE chapter_id = ?1').bind(input.chapterId).run();
    if (sourceIds.length > 0) {
      const placeholders = sourceIds.map((_value, index) => `?${index + 1}`).join(', ');
      const chunkDelete = this.db.prepare(
        `DELETE FROM chunk
         WHERE source_id IN (${placeholders})`,
      );
      const ingestDelete = this.db.prepare(
        `DELETE FROM ingest_job
         WHERE source_id IN (${placeholders})`,
      );
      const sourceDelete = this.db.prepare(
        `DELETE FROM source
         WHERE id IN (${placeholders})`,
      );
      const pdfProgressDelete = this.db.prepare(
        `DELETE FROM pdf_progress
         WHERE source_id IN (${placeholders})`,
      );
      await chunkDelete.bind(...sourceIds).run();
      await ingestDelete.bind(...sourceIds).run();
      await pdfProgressDelete.bind(...sourceIds).run();
      await sourceDelete.bind(...sourceIds).run();
    }

    const sourceId = generateId();
    await this.db
      .prepare(
        `INSERT INTO source
          (id, chapter_id, object_key, filename, content_type, byte_size, sha256, status, source_label, parse_confidence, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'application/pdf', 0, NULL, 'ingested', 'pilot-seed', 0.9, ?5, ?5)`,
      )
      .bind(
        sourceId,
        input.chapterId,
        input.sourceObjectKey,
        input.sourceObjectKey.split('/').pop() ?? `${input.chapterId}.pdf`,
        input.nowIso,
      )
      .run();

    const imageRef = input.imageObjectKey ? `r2://clawstudydata/${input.imageObjectKey}` : null;
    for (let index = 0; index < input.questionCount; index += 1) {
      const chunkId = `${input.chapterId}-pilot-chunk-${index + 1}`;
      await this.db
        .prepare(
          `INSERT INTO chunk
            (id, source_id, chunk_index, text, topic_tag, token_count, quality_score, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, 'fast', 120, 0.85, ?5, ?5)`,
        )
        .bind(
          chunkId,
          sourceId,
          index,
          `Pilot chunk ${index + 1} extracted for ${input.chapterId} from ${input.sourceObjectKey}.`,
          input.nowIso,
        )
        .run();

      const pilotQuestion = pilotQuestionForIndex({
        chapterId: input.chapterId,
        questionIndex: index,
        chunkId,
        imageRef,
      });

      await this.db
        .prepare(
          `INSERT INTO question
            (id, chapter_id, source_id, topic, difficulty, source_chunk_ids_json, stem, choices_json, correct_choice, explanation, image_ref, quality_score, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 0.8, ?12, ?12)`,
        )
        .bind(
          pilotQuestion.questionId,
          pilotQuestion.chapterId,
          sourceId,
          pilotQuestion.topic ?? 'fast',
          pilotQuestion.difficulty ?? 'medium',
          JSON.stringify(pilotQuestion.sourceChunkIds),
          pilotQuestion.stem,
          JSON.stringify(pilotQuestion.choices),
          pilotQuestion.correctChoice,
          pilotQuestion.explanation,
          pilotQuestion.imageRef,
          input.nowIso,
        )
        .run();
    }

    return {
      chapterId: input.chapterId,
      questionCount: input.questionCount,
      imageQuestionCount: imageRef ? 1 : 0,
    };
  }
}

interface InMemoryState {
  sources: Map<string, SourceRecord>;
  sourceById: Map<string, {
    filename: string;
    contentType: string;
    sha256: string | null;
    sourceLabel: string | null;
  }>;
  ingestJobs: Map<string, { sourceId: string; status: 'queued' | 'processing' | 'completed' | 'failed'; errorCode: string | null }>;
  sessions: Map<string, QuizSession>;
  questions: QuizQuestion[];
  chunks: Map<string, ChunkContext>;
  attempts: Array<{
    userId: string;
    sessionId: string;
    questionId: string;
    chapterId: string;
    sourceId: string | null;
    topic: string;
    selectedChoice: Choice;
    isCorrect: boolean;
    responseTimeSeconds: number;
    confidence: number | null;
    idempotencyKey: string;
    createdAt: string;
  }>;
  chapterProgress: Map<string, ChapterProgress>;
  pdfProgress: Map<string, PdfProgress>;
  questionProgress: Map<string, QuestionProgress>;
  topicMastery: Map<string, TopicMastery>;
}

export class InMemoryStudyStore implements StudyStore {
  private readonly state: InMemoryState;

  constructor(seedQuestions: QuizQuestion[] = []) {
    this.state = {
      sources: new Map(),
      sourceById: new Map(),
      ingestJobs: new Map(),
      sessions: new Map(),
      questions: [...seedQuestions],
      chunks: new Map(),
      attempts: [],
      chapterProgress: new Map(),
      pdfProgress: new Map(),
      questionProgress: new Map(),
      topicMastery: new Map(),
    };

    for (const question of seedQuestions) {
      for (const chunkId of question.sourceChunkIds) {
        if (this.state.chunks.has(chunkId)) {
          continue;
        }
        this.state.chunks.set(chunkId, {
          chunkId,
          sourceId: question.sourceId ?? null,
          topicTag: question.topic ?? null,
          text: `${question.stem} ${question.explanation}`,
        });
      }
    }
  }

  async createSource(
    input: UploadSourceInput,
  ): Promise<{ sourceId: string; objectKey: string; uploadUrl: string; expiresAt: string }> {
    const sourceId = generateId();
    const objectKey = `sources/uploads/${sourceId}-${sanitizeFilename(input.filename)}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    this.state.sources.set(sourceId, {
      sourceId,
      chapterId: input.chapterId ?? null,
      uploadStatus: 'registered',
      ingestStatus: null,
      objectKey,
      parseConfidence: null,
      chunkCount: 0,
      errorCode: null,
    });

    this.state.sourceById.set(sourceId, {
      filename: input.filename,
      contentType: input.contentType,
      sha256: input.sha256 ?? null,
      sourceLabel: input.sourceLabel ?? null,
    });

    return {
      sourceId,
      objectKey,
      uploadUrl: `r2://clawstudydata/${objectKey}`,
      expiresAt,
    };
  }

  async completeSource(sourceId: string): Promise<{ ingestJobId: string; status: 'queued' }> {
    const source = this.state.sources.get(sourceId);
    if (!source) {
      throw new Error('source_not_found');
    }

    const ingestJobId = generateId();
    source.uploadStatus = 'uploaded';
    source.ingestStatus = 'queued';
    this.state.ingestJobs.set(ingestJobId, {
      sourceId,
      status: 'queued',
      errorCode: null,
    });

    return {
      ingestJobId,
      status: 'queued',
    };
  }

  async getSourceStatus(sourceId: string): Promise<SourceRecord | null> {
    return this.state.sources.get(sourceId) ?? null;
  }

  async getSourceByChapterId(chapterId: string): Promise<{ sourceId: string; ingestStatus: string | null; questionCount: number } | null> {
    for (const [sourceId, source] of this.state.sources.entries()) {
      if (source.chapterId === chapterId) {
        return { sourceId, ingestStatus: source.ingestStatus ?? null, questionCount: 0 };
      }
    }
    return null;
  }

  async getOrCreateSession(input: {
    chapterId: string;
    userId: string;
    telegramUserId: string | null;
    telegramChatId: string | null;
    nowIso: string;
  }): Promise<QuizSession> {
    for (const session of this.state.sessions.values()) {
      if (session.userId === input.userId && session.status === 'active' && session.chapterId !== input.chapterId) {
        session.status = 'paused';
      }
    }

    for (const session of this.state.sessions.values()) {
      if (session.userId === input.userId && session.chapterId === input.chapterId && session.status === 'active') {
        return session;
      }
    }

    const session: QuizSession = {
      sessionId: generateId(),
      userId: input.userId,
      chapterId: input.chapterId,
      status: 'active',
      currentQuestionIndex: 0,
      lastQuestionId: null,
      currentQuestionPresentedAt: null,
      telegramUserId: input.telegramUserId,
      telegramChatId: input.telegramChatId,
    };
    this.state.sessions.set(session.sessionId, session);
    return session;
  }

  async getSessionById(sessionId: string): Promise<QuizSession | null> {
    return this.state.sessions.get(sessionId) ?? null;
  }

  async getActiveSessionByUser(userId: string): Promise<QuizSession | null> {
    const sessions = [...this.state.sessions.values()]
      .filter((session) => session.userId === userId && session.status === 'active')
      .sort((a, b) => b.currentQuestionIndex - a.currentQuestionIndex);
    return sessions[0] ?? null;
  }

  async getQuestionByIndex(chapterId: string, questionIndex: number): Promise<QuizQuestion | null> {
    const chapterQuestions = this.state.questions.filter((question) => question.chapterId === chapterId);
    return chapterQuestions[questionIndex] ?? null;
  }

  async getQuestionById(questionId: string): Promise<QuizQuestion | null> {
    return this.state.questions.find((question) => question.questionId === questionId) ?? null;
  }

  async getChunkContexts(chunkIds: string[]): Promise<ChunkContext[]> {
    const output: ChunkContext[] = [];
    for (const chunkId of chunkIds) {
      const chunk = this.state.chunks.get(chunkId);
      if (chunk) {
        output.push(chunk);
      }
    }
    return output;
  }

  async recordAttempt(input: {
    sessionId: string;
    questionId: string;
    selectedChoice: Choice;
    isCorrect: boolean;
    responseTimeSeconds: number;
    confidence: number | null;
    idempotencyKey: string;
    nowIso: string;
  }): Promise<void> {
    const session = this.state.sessions.get(input.sessionId);
    const question = this.state.questions.find((candidate) => candidate.questionId === input.questionId);
    const userId = session?.userId ?? 'unknown-user';
    const chapterId = question?.chapterId ?? session?.chapterId ?? 'unknown-chapter';
    this.state.attempts.push({
      userId,
      sessionId: input.sessionId,
      questionId: input.questionId,
      chapterId,
      sourceId: question?.sourceId ?? null,
      topic: question?.topic ?? 'unknown',
      selectedChoice: input.selectedChoice,
      isCorrect: input.isCorrect,
      responseTimeSeconds: input.responseTimeSeconds,
      confidence: input.confidence,
      idempotencyKey: input.idempotencyKey,
      createdAt: input.nowIso,
    });
  }

  async recomputeProgress(input: {
    userId: string;
    chapterId: string;
    nowIso: string;
  }): Promise<ChapterProgress> {
    const sessionIds = [...this.state.sessions.values()]
      .filter((session) => session.userId === input.userId && session.chapterId === input.chapterId)
      .map((session) => session.sessionId);

    const attempts = this.state.attempts.filter((attempt) => sessionIds.includes(attempt.sessionId));
    const questionsAnswered = attempts.length;
    const questionsCorrect = attempts.filter((attempt) => attempt.isCorrect).length;
    const accuracy = questionsAnswered > 0 ? questionsCorrect / questionsAnswered : 0;

    const progress: ChapterProgress = {
      userId: input.userId,
      chapterId: input.chapterId,
      questionsAnswered,
      questionsCorrect,
      accuracy,
      updatedAt: input.nowIso,
    };

    this.state.chapterProgress.set(`${input.userId}::${input.chapterId}`, progress);
    return progress;
  }

  async recomputeQuestionProgress(input: {
    userId: string;
    questionId: string;
    nowIso: string;
  }): Promise<QuestionProgress | null> {
    const attempts = this.state.attempts.filter((attempt) => attempt.userId === input.userId && attempt.questionId === input.questionId);
    const questionsAnswered = attempts.length;
    if (questionsAnswered === 0) {
      return null;
    }

    const question = this.state.questions.find((candidate) => candidate.questionId === input.questionId);
    const questionsCorrect = attempts.filter((attempt) => attempt.isCorrect).length;
    const accuracy = questionsAnswered > 0 ? questionsCorrect / questionsAnswered : 0;
    const avgResponseTimeSeconds = questionsAnswered > 0
      ? attempts.reduce((sum, attempt) => sum + attempt.responseTimeSeconds, 0) / questionsAnswered
      : null;
    const confidenceAttempts = attempts.filter((attempt) => attempt.confidence !== null);
    const confidenceAvg = confidenceAttempts.length > 0
      ? confidenceAttempts.reduce((sum, attempt) => sum + Number(attempt.confidence), 0) / confidenceAttempts.length
      : null;
    const lastAnsweredAt = attempts.at(-1)?.createdAt ?? null;

    const progress: QuestionProgress = {
      userId: input.userId,
      questionId: input.questionId,
      chapterId: question?.chapterId ?? attempts[0].chapterId,
      sourceId: question?.sourceId ?? attempts[0].sourceId ?? null,
      topic: question?.topic ?? attempts[0].topic,
      questionsAnswered,
      questionsCorrect,
      accuracy,
      avgResponseTimeSeconds,
      confidenceAvg,
      lastAnsweredAt,
      updatedAt: input.nowIso,
    };

    this.state.questionProgress.set(`${input.userId}::${input.questionId}`, progress);
    return progress;
  }

  async recomputePdfProgress(input: {
    userId: string;
    sourceId: string;
    nowIso: string;
  }): Promise<PdfProgress | null> {
    const attempts = this.state.attempts.filter((attempt) => attempt.userId === input.userId && attempt.sourceId === input.sourceId);
    const questionsAnswered = attempts.length;
    if (questionsAnswered === 0) {
      return null;
    }

    const questionsCorrect = attempts.filter((attempt) => attempt.isCorrect).length;
    const accuracy = questionsAnswered > 0 ? questionsCorrect / questionsAnswered : 0;
    const avgResponseTimeSeconds = attempts.reduce((sum, attempt) => sum + attempt.responseTimeSeconds, 0) / questionsAnswered;
    const confidenceAttempts = attempts.filter((attempt) => attempt.confidence !== null);
    const confidenceAvg = confidenceAttempts.length > 0
      ? confidenceAttempts.reduce((sum, attempt) => sum + Number(attempt.confidence), 0) / confidenceAttempts.length
      : null;
    const chapterId = attempts[0].chapterId;
    const lastAnsweredAt = attempts.at(-1)?.createdAt ?? null;

    const progress: PdfProgress = {
      userId: input.userId,
      sourceId: input.sourceId,
      chapterId,
      questionsAnswered,
      questionsCorrect,
      accuracy,
      avgResponseTimeSeconds,
      confidenceAvg,
      lastAnsweredAt,
      updatedAt: input.nowIso,
    };
    this.state.pdfProgress.set(`${input.userId}::${input.sourceId}`, progress);
    return progress;
  }

  async recomputeTopicMastery(input: {
    userId: string;
    topic: string;
    nowIso: string;
  }): Promise<TopicMastery | null> {
    const attempts = this.state.attempts.filter((attempt) => attempt.userId === input.userId && attempt.topic === input.topic);
    const questionsAnswered = attempts.length;
    if (questionsAnswered === 0) {
      return null;
    }

    const questionsCorrect = attempts.filter((attempt) => attempt.isCorrect).length;
    const accuracy = questionsAnswered > 0 ? questionsCorrect / questionsAnswered : 0;
    const avgResponseTimeSeconds = attempts.reduce((sum, attempt) => sum + attempt.responseTimeSeconds, 0) / questionsAnswered;
    const mismatchAttempts = attempts.filter((attempt) => attempt.confidence !== null);
    const confidenceMismatchScore = mismatchAttempts.length > 0
      ? clamp01(
          mismatchAttempts.reduce((sum, attempt) => {
            const confidenceValue = Number(attempt.confidence);
            if (attempt.isCorrect) {
              return sum + (1 - confidenceValue);
            }
            return sum + confidenceValue;
          }, 0) / mismatchAttempts.length,
        )
      : 0;
    const speedScore = clamp01(1 - avgResponseTimeSeconds / 60);
    const masteryScore = clamp01(accuracy * 0.75 + speedScore * 0.2 - confidenceMismatchScore * 0.15);
    const lastAnsweredAt = attempts.at(-1)?.createdAt ?? null;

    const mastery: TopicMastery = {
      userId: input.userId,
      topic: input.topic,
      questionsAnswered,
      questionsCorrect,
      accuracy,
      avgResponseTimeSeconds,
      confidenceMismatchScore,
      masteryScore,
      weaknessRank: null,
      lastAnsweredAt,
      nextReviewAt: nextReviewForMastery(input.nowIso, masteryScore),
      updatedAt: input.nowIso,
    };
    this.state.topicMastery.set(`${input.userId}::${input.topic}`, mastery);
    return mastery;
  }

  async refreshTopicWeaknessRanks(userId: string): Promise<void> {
    const rows = [...this.state.topicMastery.values()]
      .filter((topic) => topic.userId === userId)
      .sort((a, b) => {
        if (a.masteryScore !== b.masteryScore) {
          return a.masteryScore - b.masteryScore;
        }
        if (a.accuracy !== b.accuracy) {
          return a.accuracy - b.accuracy;
        }
        if (a.questionsAnswered !== b.questionsAnswered) {
          return b.questionsAnswered - a.questionsAnswered;
        }
        return a.topic.localeCompare(b.topic);
      });

    let rank = 1;
    for (const row of rows) {
      row.weaknessRank = rank;
      rank += 1;
    }
  }

  async updateSessionPointer(input: {
    sessionId: string;
    questionIndex: number;
    lastQuestionId: string | null;
    currentQuestionPresentedAt: string | null;
    nowIso: string;
  }): Promise<void> {
    const session = this.state.sessions.get(input.sessionId);
    if (!session) {
      return;
    }

    session.currentQuestionIndex = input.questionIndex;
    session.lastQuestionId = input.lastQuestionId;
    session.currentQuestionPresentedAt = input.currentQuestionPresentedAt;
  }

  async listProgress(userId: string): Promise<ChapterProgress[]> {
    return [...this.state.chapterProgress.values()].filter((progress) => progress.userId === userId);
  }

  async listPdfProgress(userId: string): Promise<PdfProgress[]> {
    return [...this.state.pdfProgress.values()]
      .filter((progress) => progress.userId === userId)
      .sort((a, b) => {
        if (a.accuracy !== b.accuracy) {
          return a.accuracy - b.accuracy;
        }
        return a.sourceId.localeCompare(b.sourceId);
      });
  }

  async listQuestionProgress(userId: string): Promise<QuestionProgress[]> {
    return [...this.state.questionProgress.values()]
      .filter((progress) => progress.userId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async listTopicMastery(userId: string): Promise<TopicMastery[]> {
    return [...this.state.topicMastery.values()]
      .filter((topic) => topic.userId === userId)
      .sort((a, b) => {
        const aRank = a.weaknessRank ?? Number.MAX_SAFE_INTEGER;
        const bRank = b.weaknessRank ?? Number.MAX_SAFE_INTEGER;
        if (aRank !== bRank) {
          return aRank - bRank;
        }
        return a.topic.localeCompare(b.topic);
      });
  }

  async listRecentAttempts(userId: string, limit: number): Promise<QuestionAttemptRecord[]> {
    const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 50;
    const sessionsById = this.state.sessions;
    return [...this.state.attempts]
      .filter((attempt) => attempt.userId === userId || sessionsById.get(attempt.sessionId)?.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, safeLimit)
      .map((attempt) => ({
        userId: attempt.userId,
        sessionId: attempt.sessionId,
        questionId: attempt.questionId,
        chapterId: attempt.chapterId,
        sourceId: attempt.sourceId,
        topic: attempt.topic,
        selectedChoice: attempt.selectedChoice,
        isCorrect: attempt.isCorrect,
        responseTimeSeconds: attempt.responseTimeSeconds,
        confidence: attempt.confidence,
        createdAt: attempt.createdAt,
      }));
  }

  async getDashboard(): Promise<{
    questionsTotal: number;
    attemptsTotal: number;
    sessionsActive: number;
    chapterCacheReady: number;
    chapterCacheDegraded: number;
    chapterCacheEmpty: number;
  }> {
    const questionsByChapter = new Map<string, number>();
    for (const question of this.state.questions) {
      questionsByChapter.set(question.chapterId, (questionsByChapter.get(question.chapterId) ?? 0) + 1);
    }

    let chapterCacheReady = 0;
    let chapterCacheDegraded = 0;
    for (const questionCount of questionsByChapter.values()) {
      if (questionCount >= 20) {
        chapterCacheReady += 1;
      } else if (questionCount > 0) {
        chapterCacheDegraded += 1;
      }
    }
    const chapterUniverse = new Set<string>();
    for (const question of this.state.questions) {
      chapterUniverse.add(question.chapterId);
    }
    for (const source of this.state.sources.values()) {
      if (source.chapterId) {
        chapterUniverse.add(source.chapterId);
      }
    }
    const chapterCacheEmpty = Math.max(chapterUniverse.size - chapterCacheReady - chapterCacheDegraded, 0);

    return {
      questionsTotal: this.state.questions.length,
      attemptsTotal: this.state.attempts.length,
      sessionsActive: [...this.state.sessions.values()].filter((session) => session.status === 'active').length,
      chapterCacheReady,
      chapterCacheDegraded,
      chapterCacheEmpty,
    };
  }

  async seedPilotChapter(input: {
    chapterId: string;
    sourceObjectKey: string;
    imageObjectKey: string | null;
    questionCount: number;
    nowIso: string;
  }): Promise<{ chapterId: string; questionCount: number; imageQuestionCount: number }> {
    const sourceIdsToDelete: string[] = [];
    for (const [sourceId, source] of this.state.sources.entries()) {
      if (source.chapterId === input.chapterId) {
        sourceIdsToDelete.push(sourceId);
        this.state.sources.delete(sourceId);
      }
    }
    if (sourceIdsToDelete.length > 0) {
      const sourceIdSet = new Set(sourceIdsToDelete);
      for (const [chunkId, chunk] of this.state.chunks.entries()) {
        if (sourceIdSet.has(chunk.sourceId ?? '')) {
          this.state.chunks.delete(chunkId);
        }
      }
    }

    const sourceId = generateId();
    const sessionIdsToDelete = [...this.state.sessions.values()]
      .filter((session) => session.chapterId === input.chapterId)
      .map((session) => session.sessionId);
    const sessionIdSet = new Set(sessionIdsToDelete);
    this.state.attempts = this.state.attempts.filter((attempt) => !sessionIdSet.has(attempt.sessionId));
    for (const sessionId of sessionIdsToDelete) {
      this.state.sessions.delete(sessionId);
    }
    for (const key of this.state.chapterProgress.keys()) {
      if (key.endsWith(`::${input.chapterId}`)) {
        this.state.chapterProgress.delete(key);
      }
    }
    for (const [key, progress] of this.state.questionProgress.entries()) {
      if (progress.chapterId === input.chapterId) {
        this.state.questionProgress.delete(key);
      }
    }
    for (const [key, progress] of this.state.pdfProgress.entries()) {
      if (progress.chapterId === input.chapterId) {
        this.state.pdfProgress.delete(key);
      }
    }
    for (const [key, topic] of this.state.topicMastery.entries()) {
      if (topic.topic === 'fast') {
        this.state.topicMastery.delete(key);
      }
    }

    this.state.sources.set(sourceId, {
      sourceId,
      chapterId: input.chapterId,
      uploadStatus: 'ingested',
      ingestStatus: 'completed',
      objectKey: input.sourceObjectKey,
      parseConfidence: 0.9,
      chunkCount: input.questionCount,
      errorCode: null,
    });

    this.state.questions = this.state.questions.filter((question) => question.chapterId !== input.chapterId);
    const imageRef = input.imageObjectKey ? `r2://clawstudydata/${input.imageObjectKey}` : null;
    for (let index = 0; index < input.questionCount; index += 1) {
      const chunkId = `${input.chapterId}-pilot-chunk-${index + 1}`;
      this.state.chunks.set(chunkId, {
        chunkId,
        sourceId,
        topicTag: 'fast',
        text: `Pilot chunk ${index + 1} extracted for ${input.chapterId} from ${input.sourceObjectKey}.`,
      });
      const seeded = pilotQuestionForIndex({
        chapterId: input.chapterId,
        questionIndex: index,
        chunkId,
        imageRef,
      });
      seeded.sourceId = sourceId;
      seeded.topic = 'fast';
      seeded.difficulty = 'medium';
      this.state.questions.push(seeded);
    }

    return {
      chapterId: input.chapterId,
      questionCount: input.questionCount,
      imageQuestionCount: imageRef ? 1 : 0,
    };
  }

  seedQuestions(questions: QuizQuestion[]): void {
    this.state.questions.push(...questions);
  }
}
