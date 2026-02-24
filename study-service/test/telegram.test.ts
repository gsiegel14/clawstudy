import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { InMemoryStudyStore } from '../src/store';
import { buildImageDescription } from '../src/telegram';
import type { QuizQuestion } from '../src/types';
import type { AgentPlanner } from '../src/study-agent';

const mockStartPlanner: AgentPlanner = async () => ({ route: 'start', chapterId: 'us-01' });

function questionSeed(): QuizQuestion[] {
  return [
    {
      questionId: 'q-fast-1',
      chapterId: 'us-01',
      stem: 'Pilot FAST question 1?',
      choices: ['A one', 'B two', 'C three', 'D four'],
      correctChoice: 'A',
      explanation: 'A is correct for pilot.',
      sourceChunkIds: ['chunk-1'],
      sourceId: 'src-fast',
      topic: 'fast',
      difficulty: 'medium',
      imageRef: null,
    },
    {
      questionId: 'q-fast-2',
      chapterId: 'us-01',
      stem: 'Pilot FAST question 2?',
      choices: ['A one', 'B two', 'C three', 'D four'],
      correctChoice: 'B',
      explanation: 'B is correct for pilot 2.',
      sourceChunkIds: ['chunk-2'],
      sourceId: 'src-fast',
      topic: 'fast',
      difficulty: 'medium',
      imageRef: null,
    },
  ];
}

// Intent routing is handled by the LLM agent (study-agent.ts). See test/study-agent.test.ts.

describe('image description builder', () => {
  it('returns null when question has no image reference', () => {
    const description = buildImageDescription({
      imageRef: null,
      stem: 'Which FAST view is best for RUQ free fluid?',
      explanation: 'Morison pouch is the RUQ view.',
    });
    expect(description).toBeNull();
  });

  it('derives image description from explanation when image exists', () => {
    const description = buildImageDescription({
      imageRef: 'r2://clawstudydata/figures/fast-1.jpg',
      stem: 'Which FAST view is best for RUQ free fluid?',
      explanation: 'Morison pouch free fluid is the classic RUQ FAST finding. Additional details follow.',
    });
    expect(description).toBe('Morison pouch free fluid is the classic RUQ FAST finding.');
  });
});

describe('telegram webhook route', () => {
  it('handles start and answer flow', async () => {
    const store = new InMemoryStudyStore(questionSeed());
    const app = createApp({ store, agentPlanner: mockStartPlanner });

    const startResponse = await app.request(
      'http://localhost/v1/telegram/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          update_id: 1,
          message: {
            message_id: 10,
            text: 'lets start with the fast chapter',
            chat: { id: 100, type: 'private' },
            from: { id: 100 },
          },
        }),
      },
      { SCHEMA_VERSION: '1.0.0' } as never,
    );

    expect(startResponse.status).toBe(200);
    const startPayload = (await startResponse.json()) as { status: string };
    expect(startPayload.status).toBe('sent_question');

    const answerResponse = await app.request(
      'http://localhost/v1/telegram/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          update_id: 2,
          message: {
            message_id: 11,
            text: 'A',
            chat: { id: 100, type: 'private' },
            from: { id: 100 },
          },
        }),
      },
      { SCHEMA_VERSION: '1.0.0' } as never,
    );

    expect(answerResponse.status).toBe(200);
    const answerPayload = (await answerResponse.json()) as { status: string };
    expect(answerPayload.status).toBe('answer_processed');
  });
});
