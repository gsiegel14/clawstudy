import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { InMemoryStudyStore } from '../src/store';
import { buildImageDescription, parseTelegramIntent } from '../src/telegram';
import type { QuizQuestion } from '../src/types';

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

describe('telegram intent parser', () => {
  it('parses start and q1 variants', () => {
    expect(parseTelegramIntent('lets start fast').type).toBe('start');
    expect(parseTelegramIntent("let's start fast").type).toBe('start');
    expect(parseTelegramIntent('lets start fast peds').type).toBe('start');
    expect(parseTelegramIntent('fast peds').type).toBe('start');
    expect(parseTelegramIntent('lets start with the fast chapter').type).toBe('start');
    expect(parseTelegramIntent('lets start with the fast chaper').type).toBe('start');
    expect(parseTelegramIntent('/start fast').type).toBe('start');
    expect(parseTelegramIntent('question 1').type).toBe('q1');
    expect(parseTelegramIntent('q1').type).toBe('q1');
    expect(parseTelegramIntent('question1').type).toBe('q1');
    expect(parseTelegramIntent('q 1').type).toBe('q1');
    const chapterTwoStart = parseTelegramIntent('start chapter 2');
    expect(chapterTwoStart.type).toBe('start');
    if (chapterTwoStart.type === 'start') {
      expect(chapterTwoStart.chapterId).toBe('us-02');
    }
    const chapterTwoQ1 = parseTelegramIntent('question 1 us-02');
    expect(chapterTwoQ1.type).toBe('q1');
    if (chapterTwoQ1.type === 'q1') {
      expect(chapterTwoQ1.chapterId).toBe('us-02');
    }
  });

  it('parses answer choices', () => {
    const intentA = parseTelegramIntent('A');
    const intentTwo = parseTelegramIntent('2');
    expect(intentA.type).toBe('answer');
    if (intentA.type === 'answer') {
      expect(intentA.choice).toBe('A');
    }
    expect(intentTwo.type).toBe('answer');
    if (intentTwo.type === 'answer') {
      expect(intentTwo.choice).toBe('B');
    }
  });
});

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
    const app = createApp({ store });

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
