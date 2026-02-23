import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { InMemoryStudyStore } from '../src/store';
import { InMemoryIdempotencyStore } from '../src/idempotency';
import { deriveTelegramIdempotencyKey } from '../src/telegram-idempotency';
import type { QuizQuestion } from '../src/types';

function buildSeedQuestions(): QuizQuestion[] {
  return [
    {
      questionId: 'q-fast-1',
      chapterId: 'us-01',
      stem: 'FAST finding most suggestive of hemoperitoneum?',
      choices: ['A. Free fluid in Morison pouch', 'B. Comet tails', 'C. Pleural sliding', 'D. Hydronephrosis'],
      correctChoice: 'A',
      explanation: 'Morison pouch free fluid is classic in positive FAST.',
      sourceChunkIds: ['chunk-1'],
      sourceId: 'src-fast',
      topic: 'fast',
      difficulty: 'medium',
      imageRef: 'r2://clawstudydata/figures/fast-1.jpg',
    },
    {
      questionId: 'q-fast-2',
      chapterId: 'us-01',
      stem: 'FAST views include which window?',
      choices: ['A. RUQ', 'B. Femoral vein', 'C. Thyroid', 'D. Temporal bone'],
      correctChoice: 'A',
      explanation: 'Standard FAST includes RUQ, LUQ, pelvis, and cardiac windows.',
      sourceChunkIds: ['chunk-2'],
      sourceId: 'src-fast',
      topic: 'fast',
      difficulty: 'medium',
      imageRef: null,
    },
  ];
}

function makeApp() {
  const store = new InMemoryStudyStore(buildSeedQuestions());
  const idempotencyStore = new InMemoryIdempotencyStore();
  const app = createApp({ store, idempotencyStore });
  return { app };
}

describe('study-service contract tests', () => {
  it('requires Idempotency-Key for write endpoints', async () => {
    const { app } = makeApp();
    const response = await app.request(
      'http://localhost/v1/quiz/session/start',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          schema_version: '1.0.0',
          chapter_id: 'us-01',
          telegram_user_id: '123',
          telegram_chat_id: '123',
          telegram_chat_type: 'private',
        }),
      },
      { SCHEMA_VERSION: '1.0.0' } as never,
    );

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: { code: string } };
    expect(payload.error.code).toBe('MISSING_IDEMPOTENCY_KEY');
  });

  it('starts session and serves first question idempotently', async () => {
    const { app } = makeApp();

    const body = {
      schema_version: '1.0.0',
      chapter_id: 'us-01',
      telegram_user_id: '123',
      telegram_chat_id: '123',
      telegram_chat_type: 'private',
    };

    const first = await app.request(
      'http://localhost/v1/quiz/session/start',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'idem-start-1',
        },
        body: JSON.stringify(body),
      },
      { SCHEMA_VERSION: '1.0.0' } as never,
    );

    expect(first.status).toBe(200);
    const firstPayload = (await first.json()) as {
      session_id: string;
      question: { question_id: string };
      cache_state: string;
    };

    expect(firstPayload.session_id).toBeTruthy();
    expect(firstPayload.question.question_id).toBe('q-fast-1');
    expect(firstPayload.cache_state).toBe('question_cache_degraded');

    const second = await app.request(
      'http://localhost/v1/quiz/session/start',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'idem-start-1',
        },
        body: JSON.stringify(body),
      },
      { SCHEMA_VERSION: '1.0.0' } as never,
    );

    const secondPayload = (await second.json()) as { session_id: string; question: { question_id: string } };
    expect(second.status).toBe(200);
    expect(secondPayload.session_id).toBe(firstPayload.session_id);
    expect(secondPayload.question.question_id).toBe('q-fast-1');
  });

  it('rejects idempotency-key reuse with different payload', async () => {
    const { app } = makeApp();

    await app.request(
      'http://localhost/v1/quiz/session/start',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'idem-start-conflict',
        },
        body: JSON.stringify({
          schema_version: '1.0.0',
          chapter_id: 'us-01',
          telegram_user_id: '123',
          telegram_chat_id: '123',
          telegram_chat_type: 'private',
        }),
      },
      { SCHEMA_VERSION: '1.0.0' } as never,
    );

    const conflict = await app.request(
      'http://localhost/v1/quiz/session/start',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'idem-start-conflict',
        },
        body: JSON.stringify({
          schema_version: '1.0.0',
          chapter_id: 'us-02',
          telegram_user_id: '123',
          telegram_chat_id: '123',
          telegram_chat_type: 'private',
        }),
      },
      { SCHEMA_VERSION: '1.0.0' } as never,
    );

    expect(conflict.status).toBe(409);
    const payload = (await conflict.json()) as { error: { code: string } };
    expect(payload.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('records answer, returns explanation, progress, and next question', async () => {
    const { app } = makeApp();

    const start = await app.request(
      'http://localhost/v1/quiz/session/start',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'idem-start-answer-flow',
        },
        body: JSON.stringify({
          schema_version: '1.0.0',
          chapter_id: 'us-01',
          telegram_user_id: '555',
          telegram_chat_id: '555',
          telegram_chat_type: 'private',
        }),
      },
      { SCHEMA_VERSION: '1.0.0' } as never,
    );

    const startPayload = (await start.json()) as {
      session_id: string;
      question: { question_id: string };
    };

    const answer = await app.request(
      `http://localhost/v1/quiz/session/${startPayload.session_id}/answer`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'idem-answer-1',
        },
        body: JSON.stringify({
          schema_version: '1.0.0',
          question_id: startPayload.question.question_id,
          selected_choice: 'A',
          response_time_seconds: 1.8,
        }),
      },
      { SCHEMA_VERSION: '1.0.0' } as never,
    );

    expect(answer.status).toBe(200);
    const payload = (await answer.json()) as {
      is_correct: boolean;
      explanation: string;
      progress: { questions_answered: number; questions_correct: number; accuracy: number };
      next_question: { question_id: string } | null;
    };

    expect(payload.is_correct).toBe(true);
    expect(payload.explanation.length).toBeGreaterThan(0);
    expect(payload.explanation).toContain('Deep Dive from chapter context:');
    expect(payload.progress.questions_answered).toBe(1);
    expect(payload.progress.questions_correct).toBe(1);
    expect(payload.progress.accuracy).toBe(1);
    expect(payload.next_question?.question_id).toBe('q-fast-2');
  });

  it('returns per-pdf and per-question memory in progress endpoint', async () => {
    const { app } = makeApp();

    const start = await app.request(
      'http://localhost/v1/quiz/session/start',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'idem-start-memory-view',
        },
        body: JSON.stringify({
          schema_version: '1.0.0',
          chapter_id: 'us-01',
          telegram_user_id: '999',
          telegram_chat_id: '999',
          telegram_chat_type: 'private',
        }),
      },
      { SCHEMA_VERSION: '1.0.0' } as never,
    );
    const startPayload = (await start.json()) as {
      session_id: string;
      question: { question_id: string };
    };

    await app.request(
      `http://localhost/v1/quiz/session/${startPayload.session_id}/answer`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'idem-answer-memory-view',
        },
        body: JSON.stringify({
          schema_version: '1.0.0',
          question_id: startPayload.question.question_id,
          selected_choice: 'A',
          response_time_seconds: 2.2,
          confidence: 0.85,
        }),
      },
      { SCHEMA_VERSION: '1.0.0' } as never,
    );

    const progressResponse = await app.request(
      'http://localhost/v1/progress/tg:user:999',
      {
        method: 'GET',
      },
      { SCHEMA_VERSION: '1.0.0' } as never,
    );

    expect(progressResponse.status).toBe(200);
    const payload = (await progressResponse.json()) as {
      pdfs: Array<{ source_id: string; questions_answered: number }>;
      questions: Array<{ question_id: string; questions_answered: number }>;
      recent_attempts: Array<{ question_id: string; confidence: number | null }>;
      topics: Array<{ topic: string; mastery_score: number }>;
    };

    expect(payload.pdfs[0]?.source_id).toBe('src-fast');
    expect(payload.pdfs[0]?.questions_answered).toBe(1);
    expect(payload.questions[0]?.question_id).toBe('q-fast-1');
    expect(payload.questions[0]?.questions_answered).toBe(1);
    expect(payload.recent_attempts[0]?.question_id).toBe('q-fast-1');
    expect(payload.recent_attempts[0]?.confidence).toBe(0.85);
    expect(payload.topics[0]?.topic).toBe('fast');
    expect(typeof payload.topics[0]?.mastery_score).toBe('number');
  });

  it('derives deterministic telegram idempotency keys', () => {
    const startKey = deriveTelegramIdempotencyKey({
      chatId: 42,
      messageId: 77,
      intent: 'start',
      chapterId: 'us-01',
    });

    const q1Key = deriveTelegramIdempotencyKey({
      chatId: 42,
      messageId: 77,
      intent: 'q1',
      chapterId: 'us-01',
    });

    const answerKey = deriveTelegramIdempotencyKey({
      chatId: 42,
      messageId: 77,
      intent: 'answer',
      sessionId: 'sess-1',
      questionId: 'q-1',
    });

    expect(startKey).toBe('tg:42:77:start:us-01');
    expect(q1Key).toBe('tg:42:77:q1:us-01');
    expect(answerKey).toBe('tg:42:77:answer:sess-1:q-1');
  });
});
