import { normalizeChoice } from './validation';

export type TelegramIntent =
  | { type: 'start'; chapterId: string }
  | { type: 'q1'; chapterId: string }
  | { type: 'answer'; choice: 'A' | 'B' | 'C' | 'D' }
  | { type: 'unknown' };

const CHAPTER_NAME_ALIASES: Array<{ chapterId: string; aliases: string[] }> = [
  { chapterId: 'us-01', aliases: ['fast'] },
  { chapterId: 'us-02', aliases: ['focused echo'] },
  { chapterId: 'us-03', aliases: ['physics and knobology', 'physics'] },
  { chapterId: 'us-04', aliases: ['resuscitative us', 'resuscitative ultrasound'] },
  { chapterId: 'us-05', aliases: ['thoracic ultrasound', 'thoracic'] },
  { chapterId: 'us-06', aliases: ['aorta'] },
  { chapterId: 'us-07', aliases: ['hepatobiliary'] },
  { chapterId: 'us-08', aliases: ['renal'] },
  { chapterId: 'us-09', aliases: ['pregnancy'] },
  { chapterId: 'us-10', aliases: ['gynecologic', 'gyn'] },
  { chapterId: 'us-11', aliases: ['soft tissue'] },
  { chapterId: 'us-12', aliases: ['ocular'] },
  { chapterId: 'us-13', aliases: ['procedural us', 'procedural ultrasound', 'procedural'] },
  { chapterId: 'us-14', aliases: ['airway and ent', 'airway', 'ent'] },
  { chapterId: 'us-15', aliases: ['dvt and vte', 'dvt', 'vte'] },
  { chapterId: 'us-16', aliases: ['testicular'] },
  { chapterId: 'us-17', aliases: ['bowel and appendix', 'bowel', 'appendix'] },
  { chapterId: 'us-18', aliases: ['msk'] },
];

function firstSentence(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return '';
  }
  const match = trimmed.match(/(.+?[.!?])(\s|$)/);
  if (match && match[1]) {
    return match[1].trim();
  }
  return trimmed;
}

function trimToLength(input: string, maxLength: number): string {
  if (input.length <= maxLength) {
    return input;
  }
  return `${input.slice(0, maxLength - 1).trim()}…`;
}

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function chapterIdFromNumber(numberText: string): string | null {
  const value = Number.parseInt(numberText, 10);
  if (!Number.isInteger(value) || value < 1 || value > 99) {
    return null;
  }
  return `us-${String(value).padStart(2, '0')}`;
}

function detectChapterId(text: string): string | null {
  const explicitUs = text.match(/\bus[\s-]?([0-9]{1,2})\b/);
  if (explicitUs && explicitUs[1]) {
    return chapterIdFromNumber(explicitUs[1]);
  }

  const chapterNumber = text.match(/\bchapter\s+([0-9]{1,2})\b/);
  if (chapterNumber && chapterNumber[1]) {
    return chapterIdFromNumber(chapterNumber[1]);
  }

  for (const chapter of CHAPTER_NAME_ALIASES) {
    for (const alias of chapter.aliases) {
      if (text.includes(alias)) {
        return chapter.chapterId;
      }
    }
  }

  return null;
}

export function parseTelegramIntent(rawText: string): TelegramIntent {
  const text = normalizeText(rawText);
  const detectedChapterId = detectChapterId(text);
  const chapterId = detectedChapterId ?? 'us-01';

  const hasStartVerb = /\b(start|begin)\b/.test(text) || text.startsWith('/start');
  const isChapterKeywordOnly = detectedChapterId !== null && !/\b(question|q)\s*1\b/.test(text);
  const isStartIntent = hasStartVerb || text === 'start' || text === 'begin' || isChapterKeywordOnly;

  if (isStartIntent) {
    return { type: 'start', chapterId };
  }

  if (/\bquestion\s*1\b/.test(text) || /\bq\s*1\b/.test(text)) {
    return { type: 'q1', chapterId };
  }

  const choice = normalizeChoice(rawText);
  if (choice) {
    return { type: 'answer', choice };
  }

  return { type: 'unknown' };
}

export function buildQuestionText(input: {
  questionNumber: number;
  stem: string;
  choices: string[];
}): string {
  const choiceLines = input.choices.map((choice, index) => {
    const prefix = ['A', 'B', 'C', 'D'][index] ?? `${index + 1}`;
    return `${prefix}. ${choice}`;
  });

  return [`Question ${input.questionNumber}`, input.stem, ...choiceLines].join('\n');
}

export function buildImageDescription(input: {
  imageRef: string | null;
  stem: string;
  explanation: string;
}): string | null {
  if (!input.imageRef) {
    return null;
  }

  const fromExplanation = firstSentence(input.explanation);
  if (fromExplanation.length > 0) {
    return trimToLength(fromExplanation, 220);
  }

  const fromStem = firstSentence(input.stem);
  if (fromStem.length > 0) {
    return trimToLength(`Ultrasound figure context: ${fromStem}`, 220);
  }

  return 'Ultrasound figure context is relevant to this question.';
}

export function buildAnswerFeedback(input: {
  isCorrect: boolean;
  explanation: string;
  progress: { questionsAnswered: number; questionsCorrect: number; accuracy: number };
}): string {
  const pct = (input.progress.accuracy * 100).toFixed(0);
  return [
    input.isCorrect ? 'Correct.' : 'Incorrect.',
    input.explanation,
    `Progress: ${input.progress.questionsCorrect}/${input.progress.questionsAnswered} (${pct}%)`,
  ].join('\n');
}
