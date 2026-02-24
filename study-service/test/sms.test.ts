import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { InMemoryStudyStore } from '../src/store';
import { InMemoryIdempotencyStore } from '../src/idempotency';
import type { QuizQuestion } from '../src/types';
import type { AgentPlanner } from '../src/study-agent';

const mockStartPlanner: AgentPlanner = async () => ({ route: 'start', chapterId: 'us-01' });

function seedQuestions(): QuizQuestion[] {
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
      imageRef: null,
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

describe('sms webhook route', () => {
  it('starts a FAST session and responds with question text', async () => {
    const app = createApp({
      store: new InMemoryStudyStore(seedQuestions()),
      idempotencyStore: new InMemoryIdempotencyStore(),
      agentPlanner: mockStartPlanner,
    });

    const body = new URLSearchParams({
      Body: 'lets start fast',
      From: '+15555550123',
      To: '+15555550999',
      MessageSid: 'SM-start-1',
    });

    const response = await app.request(
      'http://localhost/v1/channel/sms/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      },
      { SCHEMA_VERSION: '1.0.0' } as never,
    );

    expect(response.status).toBe(200);
    const xml = await response.text();
    expect(xml).toContain('<Response>');
    expect(xml).toContain('Question 1');
    expect(xml).toContain('FAST finding most suggestive');
  });

  it('processes answer and returns feedback plus next question', async () => {
    const app = createApp({
      store: new InMemoryStudyStore(seedQuestions()),
      idempotencyStore: new InMemoryIdempotencyStore(),
      agentPlanner: mockStartPlanner,
    });

    const startBody = new URLSearchParams({
      Body: 'lets start with the fast chapter',
      From: '+15555550124',
      To: '+15555550999',
      MessageSid: 'SM-start-2',
    });

    await app.request(
      'http://localhost/v1/channel/sms/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: startBody,
      },
      { SCHEMA_VERSION: '1.0.0' } as never,
    );

    const answerBody = new URLSearchParams({
      Body: 'A',
      From: '+15555550124',
      To: '+15555550999',
      MessageSid: 'SM-answer-1',
    });

    const answer = await app.request(
      'http://localhost/v1/channel/sms/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: answerBody,
      },
      { SCHEMA_VERSION: '1.0.0' } as never,
    );

    expect(answer.status).toBe(200);
    const xml = await answer.text();
    expect(xml).toContain('Correct.');
    expect(xml).toContain('Progress: 1/1 (100%)');
    expect(xml).toContain('Question 2');
  });
});
