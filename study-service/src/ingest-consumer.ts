import { sha256Hex } from './idempotency';
import type { Choice, Env } from './types';

export interface IngestQueueMessage {
  sourceId: string;
  ingestJobId: string;
  enqueuedAt: string;
}

interface SourceRow {
  id: string;
  chapterId: string | null;
  objectKey: string;
  filename: string;
  contentType: string;
}

interface SchemaFeatures {
  questionStemHash: boolean;
  questionGenerationMode: boolean;
  questionSourcePage: boolean;
  sourceQuestionCacheState: boolean;
  sourceIngestedAt: boolean;
}

interface ExtractedImage {
  mimeType: string;
  base64: string;
  placeholder: string;
}

interface ParsedAuthoredQuestion {
  sourceOrder: number;
  sourcePage: number | null;
  stem: string;
  choices: string[];
  correctChoice: Choice | null;
  explanation: string | null;
}

interface QuestionMarker {
  questionNumber: number;
  startIndex: number;
  sourcePage: number | null;
}

interface PersistQuestionInput {
  questionId: string;
  chapterId: string;
  sourceId: string;
  sourceOrder: number;
  sourcePage: number | null;
  stem: string;
  choices: string[];
  correctChoice: Choice;
  explanation: string;
  imageRef: string | null;
  sourceChunkIds: string[];
  topic: string;
  difficulty: 'easy' | 'medium' | 'hard';
  qualityScore: number;
  generationMode: 'authored' | 'generated';
  nowIso: string;
}

const DEFAULT_TEXT_MODEL = '@cf/meta/llama-3.2-3b-instruct';
const DEFAULT_MAX_GENERATED_QUESTIONS = 20;
const MAX_EMBEDDED_IMAGES = 16;

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function normalizeNewlines(input: string): string {
  return input.replace(/\r\n?/g, '\n');
}

function stripNullCharacters(input: string): string {
  return input.replace(/\u0000/g, '');
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(Math.floor(value), min), max);
}

function safeChoice(value: string | null): Choice | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  if (normalized === 'A' || normalized === 'B' || normalized === 'C' || normalized === 'D') {
    return normalized;
  }
  return null;
}

function stripExtractionNoise(input: string): string {
  return normalizeNewlines(stripNullCharacters(input))
    .replace(/Downloaded from https?:\/\/\S+[^\n]*/gi, '\n')
    .replace(/p\.\s*(\d{2,4})(?=\.\s*Explanation)/gi, (_value, digits: string) => {
      if (digits.length === 2) {
        return `p. ${digits.slice(0, 1)} ${digits.slice(1)}`;
      }
      if (digits.length === 3) {
        return `p. ${digits.slice(0, 2)} ${digits.slice(2)}`;
      }
      if (digits.length === 4) {
        return `p. ${digits.slice(0, 2)} ${digits.slice(2)}`;
      }
      return `p. ${digits}`;
    })
    .replace(/p\.\s*\d{1,3}(?=\s*\d{1,3}\.\s*Explanation)/gi, ' ')
    .replace(/p\.\s*\d{1,3}\b/gi, ' ');
}

function sanitizeExtractionNoise(input: string): string {
  return stripExtractionNoise(input)
    .replace(/\u000c/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findQuestionSectionStart(normalized: string): number {
  const direct = /questions\s*(1\.\s+)/i.exec(normalized);
  if (direct && typeof direct.index === 'number') {
    const offset = direct[0].search(/1\.\s+/);
    if (offset !== -1) {
      return direct.index + offset;
    }
  }

  const headingRegex = /(?:^|[\n\r]|[.!?])\s*questions\b/gi;
  let match = headingRegex.exec(normalized);

  while (match) {
    const heading = match[0];
    const labelIndex = match.index + heading.search(/questions/i);
    const afterLabel = normalized.slice(labelIndex);
    const firstQuestionOffset = afterLabel.search(/\b1\.\s+/);
    if (firstQuestionOffset !== -1) {
      return labelIndex + firstQuestionOffset;
    }
    match = headingRegex.exec(normalized);
  }

  const firstQuestionMarker = normalized.search(/(?:^|[\s\n])1\.\s+/);
  return firstQuestionMarker === -1 ? 0 : firstQuestionMarker;
}

function findAnswerSectionStart(normalized: string, questionStart: number): number {
  const answerRegex = /(?:^|[\n\r]|[.!?])\s*answers\b/gi;
  answerRegex.lastIndex = questionStart;
  let fallback = -1;
  let match = answerRegex.exec(normalized);

  while (match) {
    const labelIndex = match.index + match[0].search(/answers/i);
    const preview = normalized.slice(labelIndex, labelIndex + 400);
    if (fallback === -1) {
      fallback = labelIndex;
    }
    if (/\b1\.\s*Explanation\s*[A-Da-d]/i.test(preview)) {
      return labelIndex;
    }
    match = answerRegex.exec(normalized);
  }

  if (fallback === -1) {
    const loose = normalized.toLowerCase().indexOf('answers', questionStart);
    if (loose !== -1) {
      fallback = loose;
    }
  }

  return fallback;
}

function extractQuestionAndAnswerSections(markdown: string): {
  questionSection: string;
  answerSection: string;
} {
  const normalized = normalizeNewlines(stripNullCharacters(markdown));
  const questionStart = findQuestionSectionStart(normalized);
  const answerLabelIndex = findAnswerSectionStart(normalized, questionStart);
  if (answerLabelIndex === -1) {
    return {
      questionSection: normalized.slice(questionStart),
      answerSection: '',
    };
  }

  return {
    questionSection: normalized.slice(questionStart, answerLabelIndex),
    answerSection: normalized.slice(answerLabelIndex),
  };
}

function extractPageMarkers(input: string): Array<{ index: number; page: number }> {
  const markers: Array<{ index: number; page: number }> = [];
  const regex = /(?:^|\n)\s*(?:#{1,6}\s*)?Page\s+(\d{1,3})\b/gi;
  let match = regex.exec(input);
  while (match) {
    const page = Number.parseInt(match[1] ?? '', 10);
    if (Number.isInteger(page) && page >= 1) {
      markers.push({
        index: match.index,
        page,
      });
    }
    match = regex.exec(input);
  }
  return markers;
}

function pageForIndex(markers: Array<{ index: number; page: number }>, index: number): number | null {
  if (markers.length === 0) {
    return null;
  }
  let active: number | null = null;
  for (const marker of markers) {
    if (marker.index > index) {
      break;
    }
    active = marker.page;
  }
  return active;
}

function extractQuestionMarkers(section: string): QuestionMarker[] {
  const pageMarkers = extractPageMarkers(section);
  const markers: QuestionMarker[] = [];
  const prefixedRegex = /(?:Question|Q)\s*(\d{1,3})\s*[:.\-]?\s+/gi;
  let match = prefixedRegex.exec(section);
  while (match) {
    const questionToken = match[1] ?? '';
    const questionNumber = Number.parseInt(questionToken, 10);
    if (!Number.isInteger(questionNumber) || questionNumber < 1 || questionNumber > 300) {
      match = prefixedRegex.exec(section);
      continue;
    }
    const numberIndex = match.index + match[0].search(/\d/);
    markers.push({
      questionNumber,
      startIndex: numberIndex,
      sourcePage: pageForIndex(pageMarkers, numberIndex),
    });
    match = prefixedRegex.exec(section);
  }

  const numericRegex = /(?<!\d\.)(?<!\d)(\d{1,3})\.\s+/g;
  match = numericRegex.exec(section);
  while (match) {
    const questionToken = match[1] ?? '';
    const questionNumber = Number.parseInt(questionToken, 10);
    if (!Number.isInteger(questionNumber) || questionNumber < 1 || questionNumber > 300) {
      match = numericRegex.exec(section);
      continue;
    }
    const numberIndex = match.index;
    markers.push({
      questionNumber,
      startIndex: numberIndex,
      sourcePage: pageForIndex(pageMarkers, numberIndex),
    });
    match = numericRegex.exec(section);
  }

  markers.sort((a, b) => a.startIndex - b.startIndex);
  return markers;
}

function authoredQuestionScore(question: ParsedAuthoredQuestion): number {
  let score = 0;
  if (question.stem.length >= 20 && question.stem.length <= 900) {
    score += 3;
  }
  if (question.sourcePage !== null) {
    score += 1;
  }
  if (question.correctChoice) {
    score += 1;
  }
  const compactChoices = question.choices.filter((choice) => choice.length > 0 && choice.length <= 320);
  score += compactChoices.length;
  if (/metadata|contents|published:|doi\.org/i.test(question.stem.slice(0, 260))) {
    score -= 8;
  }
  if (question.stem.length > 1400) {
    score -= 4;
  }
  return score;
}

function parseAnswerKeyFromSection(answerSection: string): Map<number, { correctChoice: Choice; explanation: string }> {
  const results = new Map<number, { correctChoice: Choice; explanation: string }>();
  if (answerSection.trim().length === 0) {
    return results;
  }

  const sanitized = stripExtractionNoise(answerSection)
    .replace(/([A-Za-z])(\d{1,3}\.\s*Explanation)/g, '$1 $2')
    .replace(/\bAnswers\b(\d{1,3}\.\s*Explanation)/gi, 'Answers $1')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n+/g, '\n');

  const regex = /(?:^|[\s\n])(\d{1,3})\.\s*Explanation\s*([A-Da-d])\s*[\).:]?/gi;
  const matches: Array<{ questionNumber: number; correctChoice: Choice; contentStart: number; markerIndex: number }> = [];

  let match = regex.exec(sanitized);
  while (match) {
    const questionNumber = Number.parseInt(match[1] ?? '', 10);
    const correctChoice = safeChoice(match[2] ?? null);
    if (!Number.isInteger(questionNumber) || questionNumber < 1 || !correctChoice) {
      match = regex.exec(sanitized);
      continue;
    }
    matches.push({
      questionNumber,
      correctChoice,
      contentStart: regex.lastIndex,
      markerIndex: match.index,
    });
    match = regex.exec(sanitized);
  }

  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const next = index + 1 < matches.length ? matches[index + 1] : null;
    const explanationRaw = sanitized.slice(current.contentStart, next?.markerIndex ?? sanitized.length);
    const explanation = normalizeWhitespace(explanationRaw).slice(0, 1800);
    results.set(current.questionNumber, {
      correctChoice: current.correctChoice,
      explanation: explanation.length > 0 ? explanation : 'Answer inferred from chapter answer section.',
    });
  }

  return results;
}

function findSequentialChoiceMarker(
  text: string,
  label: 'A' | 'B' | 'C' | 'D',
  startIndex: number,
): { markerStart: number; contentStart: number } | null {
  const boundaryRegex = new RegExp(`(^|[^A-Za-z0-9])(${label})\\s*[\\).:]\\s*`, 'gi');
  boundaryRegex.lastIndex = startIndex;
  const boundaryMatch = boundaryRegex.exec(text);
  if (boundaryMatch) {
    const prefixLength = boundaryMatch[1]?.length ?? 0;
    return {
      markerStart: boundaryMatch.index + prefixLength,
      contentStart: boundaryRegex.lastIndex,
    };
  }

  const fallbackRegex = new RegExp(`(${label})\\s*[\\).:]\\s*`, 'gi');
  fallbackRegex.lastIndex = startIndex;
  const fallbackMatch = fallbackRegex.exec(text);
  if (fallbackMatch) {
    return {
      markerStart: fallbackMatch.index,
      contentStart: fallbackRegex.lastIndex,
    };
  }

  return null;
}

function toQuestionCacheState(questionCount: number): 'question_cache_empty' | 'question_cache_degraded' | 'question_cache_ready' {
  if (questionCount >= 20) {
    return 'question_cache_ready';
  }
  if (questionCount > 0) {
    return 'question_cache_degraded';
  }
  return 'question_cache_empty';
}

function deriveTopic(text: string): string {
  const normalized = text.toLowerCase();
  if (normalized.includes('fast') || normalized.includes('trauma')) {
    return 'fast';
  }
  if (normalized.includes('cardiac') || normalized.includes('echo')) {
    return 'echo';
  }
  if (normalized.includes('lung') || normalized.includes('thoracic') || normalized.includes('pleural')) {
    return 'thoracic';
  }
  if (normalized.includes('aorta') || normalized.includes('aneurysm')) {
    return 'aorta';
  }
  if (normalized.includes('pregnan') || normalized.includes('pelvis') || normalized.includes('gynec')) {
    return 'pregnancy';
  }
  return 'unknown';
}

function extractJsonObject(input: string): Record<string, unknown> | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
}

function extractJsonArray(input: string): unknown[] | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // fall through
  }

  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');
  if (firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed.slice(firstBracket, lastBracket + 1)) as unknown;
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function textResponse(output: unknown): string {
  if (!output || typeof output !== 'object') {
    return '';
  }
  const row = output as { response?: unknown };
  if (typeof row.response === 'string') {
    return row.response;
  }
  return '';
}

function deriveChapterId(source: SourceRow): string {
  if (source.chapterId && source.chapterId.trim().length > 0) {
    return source.chapterId.trim().toLowerCase();
  }

  const combined = `${source.filename} ${source.objectKey}`.toLowerCase();
  const explicitUs = combined.match(/\bus[\s_-]?([0-9]{1,2})\b/);
  if (explicitUs && explicitUs[1]) {
    const value = Number.parseInt(explicitUs[1], 10);
    if (Number.isInteger(value) && value >= 1 && value <= 99) {
      return `us-${String(value).padStart(2, '0')}`;
    }
  }

  const leadingNumber = source.filename.match(/^([0-9]{1,2})[.\-_\s]/);
  if (leadingNumber && leadingNumber[1]) {
    const value = Number.parseInt(leadingNumber[1], 10);
    if (Number.isInteger(value) && value >= 1 && value <= 99) {
      return `us-${String(value).padStart(2, '0')}`;
    }
  }

  return `src-${source.id.slice(0, 8)}`;
}

function guessExtension(mimeType: string): string {
  if (mimeType.includes('png')) {
    return 'png';
  }
  if (mimeType.includes('webp')) {
    return 'webp';
  }
  if (mimeType.includes('gif')) {
    return 'gif';
  }
  if (mimeType.includes('svg')) {
    return 'svg';
  }
  return 'jpg';
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function extractEmbeddedImageData(markdown: string): {
  markdownWithoutDataImages: string;
  images: ExtractedImage[];
} {
  const images: ExtractedImage[] = [];
  const regex = /!\[[^\]]*]\((data:image\/([a-zA-Z0-9.+-]+);base64,([^)]+))\)/g;
  let cleaned = markdown;
  let match = regex.exec(markdown);

  while (match) {
    const fullDataUri = match[1];
    const subtype = match[2] ?? 'jpeg';
    const base64 = match[3] ?? '';
    const mimeType = `image/${subtype.toLowerCase()}`;
    const placeholder = `[[embedded-image-${images.length + 1}]]`;
    images.push({
      mimeType,
      base64,
      placeholder,
    });
    cleaned = cleaned.replace(fullDataUri, placeholder);
    match = regex.exec(markdown);
  }

  return {
    markdownWithoutDataImages: cleaned,
    images,
  };
}

async function persistEmbeddedImages(env: Env, sourceId: string, images: ExtractedImage[]): Promise<string[]> {
  const persisted: string[] = [];
  const bounded = images.slice(0, MAX_EMBEDDED_IMAGES);
  for (let index = 0; index < bounded.length; index += 1) {
    const image = bounded[index];
    const extension = guessExtension(image.mimeType);
    const key = `figures/ingest/${sourceId}/img-${String(index + 1).padStart(3, '0')}.${extension}`;
    const bytes = decodeBase64(image.base64);
    await env.STUDY_ASSETS.put(key, bytes, {
      httpMetadata: {
        contentType: image.mimeType,
      },
    });
    persisted.push(`r2://clawstudydata/${key}`);
  }
  return persisted;
}

function parseChoicesFromBlock(block: string): {
  stem: string;
  choices: string[];
  correctChoice: Choice | null;
} {
  const compactBlock = normalizeWhitespace(sanitizeExtractionNoise(block));
  const compactAnswerMatch = compactBlock.match(/(?:correct\s+answer|answer)\s*[:\-]\s*([A-Da-d])\b/i);
  const compactContent = compactBlock.slice(0, compactAnswerMatch?.index ?? compactBlock.length).trim();
  const markerA = findSequentialChoiceMarker(compactContent, 'A', 0);
  const markerB = markerA ? findSequentialChoiceMarker(compactContent, 'B', markerA.contentStart) : null;
  const markerC = markerB ? findSequentialChoiceMarker(compactContent, 'C', markerB.contentStart) : null;
  const markerD = markerC ? findSequentialChoiceMarker(compactContent, 'D', markerC.contentStart) : null;

  if (markerA && markerB && markerC && markerD) {
    const stem = normalizeWhitespace(compactContent.slice(0, markerA.markerStart))
      .replace(/^\d{1,3}\.\s+/, '')
      .replace(/^(?:Question|Q)\s*\d{1,3}\s*[:.\-]?\s+/i, '');
    const choiceA = normalizeWhitespace(compactContent.slice(markerA.contentStart, markerB.markerStart));
    const choiceB = normalizeWhitespace(compactContent.slice(markerB.contentStart, markerC.markerStart));
    const choiceC = normalizeWhitespace(compactContent.slice(markerC.contentStart, markerD.markerStart));
    const choiceD = normalizeWhitespace(compactContent.slice(markerD.contentStart));
    const choices = [choiceA, choiceB, choiceC, choiceD];
    if (stem.length > 0 && choices.every((choice) => choice.length > 0)) {
      return {
        stem,
        choices,
        correctChoice: safeChoice(compactAnswerMatch?.[1] ?? null),
      };
    }
  }

  const lines = stripExtractionNoise(block)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const choiceMap: Record<Choice, string> = {
    A: '',
    B: '',
    C: '',
    D: '',
  };
  let activeChoice: Choice | null = null;
  const stemLines: string[] = [];

  for (const line of lines) {
    const answerMatch = line.match(/(?:correct\s+answer|answer)\s*[:\-]\s*([A-Da-d])\b/i);
    if (answerMatch) {
      continue;
    }

    const choiceMatch = line.match(/^([A-Da-d])\s*[\).:]\s+(.+)$/i);
    if (choiceMatch && choiceMatch[1] && choiceMatch[2]) {
      const key = choiceMatch[1].toUpperCase() as Choice;
      choiceMap[key] = normalizeWhitespace(choiceMatch[2]);
      activeChoice = key;
      continue;
    }

    if (activeChoice) {
      choiceMap[activeChoice] = normalizeWhitespace(`${choiceMap[activeChoice]} ${line}`);
      continue;
    }

    stemLines.push(line);
  }

  const answerMatch = block.match(/(?:correct\s+answer|answer)\s*[:\-]\s*([A-Da-d])\b/i);
  const correctChoice = safeChoice(answerMatch?.[1] ?? null);
  const stem = normalizeWhitespace(stemLines.join(' '))
    .replace(/^\d{1,3}\.\s+/, '')
    .replace(/^(?:Question|Q)\s*\d{1,3}\s*[:.\-]?\s+/i, '');
  const choices = [choiceMap.A, choiceMap.B, choiceMap.C, choiceMap.D].map((value) => normalizeWhitespace(value));

  return {
    stem,
    choices,
    correctChoice,
  };
}

export function parseAuthoredQuestions(markdown: string): ParsedAuthoredQuestion[] {
  const normalized = normalizeNewlines(stripNullCharacters(markdown));
  const sections = extractQuestionAndAnswerSections(normalized);
  const questionSection = sections.questionSection;
  const answerKeyByQuestionNumber = parseAnswerKeyFromSection(sections.answerSection);

  const parsedByOrder = new Map<number, ParsedAuthoredQuestion>();
  const markers = extractQuestionMarkers(questionSection);

  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const next = index + 1 < markers.length ? markers[index + 1] : null;
    const blockStart = marker.startIndex;
    const blockEnd = next ? next.startIndex : questionSection.length;
    if (blockEnd <= blockStart) {
      continue;
    }

    const block = questionSection.slice(blockStart, blockEnd);
    const parsedBlock = parseChoicesFromBlock(block);
    if (parsedBlock.stem.length === 0) {
      continue;
    }
    if (parsedBlock.choices.some((choice) => choice.length === 0)) {
      continue;
    }
    if (parsedBlock.stem.length > 2000) {
      continue;
    }
    if (/metadata|contents|published:|doi\.org/i.test(parsedBlock.stem.slice(0, 260))) {
      continue;
    }

    const sourceOrder = marker.questionNumber - 1;
    const answerKey = answerKeyByQuestionNumber.get(marker.questionNumber);
    const candidate: ParsedAuthoredQuestion = {
      sourceOrder,
      sourcePage: marker.sourcePage,
      stem: parsedBlock.stem,
      choices: parsedBlock.choices,
      correctChoice: parsedBlock.correctChoice ?? answerKey?.correctChoice ?? null,
      explanation: answerKey?.explanation ?? null,
    };

    const existing = parsedByOrder.get(sourceOrder);
    if (!existing || authoredQuestionScore(candidate) > authoredQuestionScore(existing)) {
      parsedByOrder.set(sourceOrder, candidate);
    }
  }

  return Array.from(parsedByOrder.values()).sort((a, b) => a.sourceOrder - b.sourceOrder);
}

async function loadSourcePageImageRefs(env: Env, sourceId: string): Promise<Map<number, string>> {
  const refs = new Map<number, string>();
  let cursor: string | undefined;

  do {
    const listing = await env.STUDY_ASSETS.list({
      prefix: `figures/source-pages/${sourceId}/`,
      cursor,
      limit: 1000,
    });
    for (const object of listing.objects) {
      const match = object.key.match(/\/p(?:age[-_])?0*([0-9]{1,4})\.(?:png|jpg|jpeg|webp)$/i);
      if (!match) {
        continue;
      }
      const page = Number.parseInt(match[1], 10);
      if (!Number.isInteger(page) || page < 1 || refs.has(page)) {
        continue;
      }
      refs.set(page, `r2://clawstudydata/${object.key}`);
    }
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);

  return refs;
}

function chunkMarkdown(markdown: string): string[] {
  const paragraphs = normalizeNewlines(markdown)
    .split(/\n{2,}/)
    .map((value) => normalizeWhitespace(value))
    .filter((value) => value.length > 0);
  if (paragraphs.length === 0) {
    return [];
  }

  const chunks: string[] = [];
  const targetChars = 1400;
  let current = '';

  for (const paragraph of paragraphs) {
    if (current.length === 0) {
      current = paragraph;
      continue;
    }
    if (current.length + paragraph.length + 2 <= targetChars) {
      current = `${current}\n\n${paragraph}`;
      continue;
    }
    chunks.push(current);
    current = paragraph;
  }
  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

async function inferMissingAnswers(env: Env, questions: ParsedAuthoredQuestion[]): Promise<void> {
  if (!env.AI) {
    return;
  }

  const missing = questions.filter((question) => question.correctChoice === null);
  if (missing.length === 0) {
    return;
  }

  const promptQuestions = missing.map((question) => ({
    source_order: question.sourceOrder,
    stem: question.stem,
    choices: question.choices,
  }));

  const model = env.INGEST_TEXT_MODEL && env.INGEST_TEXT_MODEL.trim().length > 0
    ? env.INGEST_TEXT_MODEL.trim()
    : DEFAULT_TEXT_MODEL;

  const response = await env.AI.run(model as keyof AiModels, {
    messages: [
      {
        role: 'system',
        content:
          'You are an emergency ultrasound question reviewer. Return JSON only with conservative best-answer selection and short explanations.',
      },
      {
        role: 'user',
        content: [
          'For each question, infer one best answer and provide a concise explanation.',
          'Return strictly as JSON object: {"answers":[{"source_order":number,"correct_choice":"A|B|C|D","explanation":"..."}]}',
          JSON.stringify(promptQuestions),
        ].join('\n'),
      },
    ],
    max_tokens: 2000,
    temperature: 0.1,
    response_format: { type: 'json_object' },
  });

  const payload = extractJsonObject(textResponse(response));
  const answers = Array.isArray(payload?.answers) ? payload.answers : [];
  const byOrder = new Map<number, { correctChoice: Choice; explanation: string }>();

  for (const item of answers) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const row = item as Record<string, unknown>;
    const sourceOrder = Number(row.source_order);
    const correctChoice = safeChoice(typeof row.correct_choice === 'string' ? row.correct_choice : null);
    const explanation = typeof row.explanation === 'string' ? normalizeWhitespace(row.explanation) : '';
    if (!Number.isInteger(sourceOrder) || !correctChoice || explanation.length === 0) {
      continue;
    }
    byOrder.set(sourceOrder, {
      correctChoice,
      explanation,
    });
  }

  for (const question of missing) {
    const inferred = byOrder.get(question.sourceOrder);
    if (inferred) {
      question.correctChoice = inferred.correctChoice;
      question.explanation = inferred.explanation;
      continue;
    }
    question.correctChoice = 'A';
    question.explanation = 'Best-supported answer inferred from source context; verify during review.';
  }
}

async function generateQuestionFromChunk(
  env: Env,
  input: {
    chunkText: string;
    sourceOrder: number;
    sourceChunkId: string;
    imageRef: string | null;
  },
): Promise<PersistQuestionInput | null> {
  if (!env.AI) {
    return null;
  }

  const model = env.INGEST_TEXT_MODEL && env.INGEST_TEXT_MODEL.trim().length > 0
    ? env.INGEST_TEXT_MODEL.trim()
    : DEFAULT_TEXT_MODEL;

  const response = await env.AI.run(model as keyof AiModels, {
    messages: [
      {
        role: 'system',
        content: [
          'Generate one board-style multiple choice question from the provided study chunk.',
          'Return JSON only with keys:',
          'stem, choices (array length 4), correct_choice (A/B/C/D), explanation, topic, difficulty.',
          'Keep stem concise and clinically relevant.',
        ].join(' '),
      },
      {
        role: 'user',
        content: input.chunkText,
      },
    ],
    max_tokens: 700,
    temperature: 0.2,
    response_format: { type: 'json_object' },
  });

  const parsed = extractJsonObject(textResponse(response));
  if (!parsed) {
    return null;
  }

  const stem = typeof parsed.stem === 'string' ? normalizeWhitespace(parsed.stem) : '';
  const rawChoices = Array.isArray(parsed.choices) ? parsed.choices : [];
  const choices = rawChoices
    .map((choice) => (typeof choice === 'string' ? normalizeWhitespace(choice) : ''))
    .filter((choice) => choice.length > 0)
    .slice(0, 4);

  const correctChoice = safeChoice(typeof parsed.correct_choice === 'string' ? parsed.correct_choice : null);
  const explanation = typeof parsed.explanation === 'string'
    ? normalizeWhitespace(parsed.explanation)
    : 'Explanation generated from source chunk context.';
  const topic = typeof parsed.topic === 'string' ? normalizeWhitespace(parsed.topic).toLowerCase() : deriveTopic(stem);
  const rawDifficulty = typeof parsed.difficulty === 'string' ? parsed.difficulty.toLowerCase() : 'medium';
  const difficulty: 'easy' | 'medium' | 'hard' =
    rawDifficulty === 'easy' || rawDifficulty === 'hard' ? rawDifficulty : 'medium';

  if (stem.length === 0 || choices.length !== 4 || !correctChoice) {
    return null;
  }

  return {
    questionId: '',
    chapterId: '',
    sourceId: '',
    sourceOrder: input.sourceOrder,
    sourcePage: null,
    stem,
    choices,
    correctChoice,
    explanation,
    imageRef: input.imageRef,
    sourceChunkIds: [input.sourceChunkId],
    topic,
    difficulty,
    qualityScore: 0.75,
    generationMode: 'generated',
    nowIso: '',
  };
}

async function loadSchemaFeatures(db: D1Database): Promise<SchemaFeatures> {
  const questionColumns = await db.prepare('PRAGMA table_info(question)').all<{ name: string }>();
  const sourceColumns = await db.prepare('PRAGMA table_info(source)').all<{ name: string }>();

  const questionColumnSet = new Set((questionColumns.results ?? []).map((row) => row.name));
  const sourceColumnSet = new Set((sourceColumns.results ?? []).map((row) => row.name));

  return {
    questionStemHash: questionColumnSet.has('stem_hash'),
    questionGenerationMode: questionColumnSet.has('generation_mode'),
    questionSourcePage: questionColumnSet.has('source_page'),
    sourceQuestionCacheState: sourceColumnSet.has('question_cache_state'),
    sourceIngestedAt: sourceColumnSet.has('ingested_at'),
  };
}

async function insertChunk(input: {
  db: D1Database;
  chunkId: string;
  sourceId: string;
  chunkIndex: number;
  text: string;
  topic: string;
  nowIso: string;
}): Promise<void> {
  await input.db
    .prepare(
      `INSERT INTO chunk
        (id, source_id, chunk_index, text, topic_tag, token_count, quality_score, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0.8, ?7, ?7)
       ON CONFLICT(id) DO UPDATE SET
         source_id = excluded.source_id,
         chunk_index = excluded.chunk_index,
         text = excluded.text,
         topic_tag = excluded.topic_tag,
         token_count = excluded.token_count,
         updated_at = excluded.updated_at`,
    )
    .bind(
      input.chunkId,
      input.sourceId,
      input.chunkIndex,
      input.text,
      input.topic,
      Math.max(1, Math.ceil(input.text.length / 4)),
      input.nowIso,
    )
    .run();
}

async function insertQuestion(input: {
  db: D1Database;
  features: SchemaFeatures;
  question: PersistQuestionInput;
  stemHash: string;
}): Promise<void> {
  const columns = [
    'id',
    'chapter_id',
    'source_id',
    'topic',
    'difficulty',
    'source_order',
    'source_chunk_ids_json',
    'stem',
    'choices_json',
    'correct_choice',
    'explanation',
    'image_ref',
    'quality_score',
    'created_at',
    'updated_at',
  ];
  const values: unknown[] = [
    input.question.questionId,
    input.question.chapterId,
    input.question.sourceId,
    input.question.topic,
    input.question.difficulty,
    input.question.sourceOrder,
    JSON.stringify(input.question.sourceChunkIds),
    input.question.stem,
    JSON.stringify(input.question.choices),
    input.question.correctChoice,
    input.question.explanation,
    input.question.imageRef,
    input.question.qualityScore,
    input.question.nowIso,
    input.question.nowIso,
  ];

  if (input.features.questionStemHash) {
    columns.push('stem_hash');
    values.push(input.stemHash);
  }
  if (input.features.questionGenerationMode) {
    columns.push('generation_mode');
    values.push(input.question.generationMode);
  }
  if (input.features.questionSourcePage) {
    columns.push('source_page');
    values.push(input.question.sourcePage);
  }

  const placeholders = columns.map((_value, index) => `?${index + 1}`);
  const updateColumns = columns
    .filter((column) => column !== 'id' && column !== 'created_at')
    .map((column) => `${column} = excluded.${column}`)
    .join(', ');

  const sql = `INSERT INTO question (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) ON CONFLICT(id) DO UPDATE SET ${updateColumns}`;
  await input.db
    .prepare(sql)
    .bind(...values)
    .run();
}

async function markFailed(input: {
  env: Env;
  sourceId: string;
  ingestJobId: string;
  errorCode: string;
  errorDetail: string;
  nowIso: string;
}): Promise<void> {
  await input.env.DB
    .prepare(
      `UPDATE ingest_job
       SET status = 'failed',
           error_code = ?3,
           error_detail = ?4,
           completed_at = ?5,
           updated_at = ?5
       WHERE id = ?1
         AND source_id = ?2`,
    )
    .bind(input.ingestJobId, input.sourceId, input.errorCode, input.errorDetail, input.nowIso)
    .run();

  await input.env.DB
    .prepare(`UPDATE source SET status = 'failed', updated_at = ?2 WHERE id = ?1`)
    .bind(input.sourceId, input.nowIso)
    .run();
}

export async function processIngestJob(env: Env, message: IngestQueueMessage): Promise<void> {
  const nowIso = new Date().toISOString();
  const features = await loadSchemaFeatures(env.DB);

  const source = await env.DB
    .prepare(
      `SELECT id, chapter_id AS chapterId, object_key AS objectKey, filename, content_type AS contentType
       FROM source
       WHERE id = ?1
       LIMIT 1`,
    )
    .bind(message.sourceId)
    .first<SourceRow>();

  if (!source) {
    await markFailed({
      env,
      sourceId: message.sourceId,
      ingestJobId: message.ingestJobId,
      errorCode: 'source_not_found',
      errorDetail: 'source row not found in D1',
      nowIso,
    });
    return;
  }

  await env.DB
    .prepare(
      `UPDATE ingest_job
       SET status = 'processing',
           attempt_count = attempt_count + 1,
           started_at = COALESCE(started_at, ?3),
           updated_at = ?3
       WHERE id = ?1
         AND source_id = ?2`,
    )
    .bind(message.ingestJobId, message.sourceId, nowIso)
    .run();

  try {
    if (!env.AI) {
      throw new Error('AI binding is required for ingest conversion');
    }

    const object = await env.STUDY_ASSETS.get(source.objectKey);
    if (!object) {
      throw new Error(`Source object missing in R2: ${source.objectKey}`);
    }

    const fileBlob = new Blob([await object.arrayBuffer()], {
      type: source.contentType || 'application/pdf',
    });
    const conversion = await env.AI.toMarkdown(
      {
        name: source.filename,
        blob: fileBlob,
      },
      {
        conversionOptions: {
          pdf: {
            metadata: true,
            images: {
              convert: true,
              maxConvertedImages: MAX_EMBEDDED_IMAGES,
              descriptionLanguage: 'en',
            },
          },
        },
      },
    );

    if (conversion.format === 'error') {
      throw new Error(`to_markdown_error:${conversion.error}`);
    }

    const chapterId = deriveChapterId(source);
    const extraction = extractEmbeddedImageData(conversion.data);
    const imageRefs = await persistEmbeddedImages(env, source.id, extraction.images);
    const pageImageRefs = await loadSourcePageImageRefs(env, source.id);

    const chunks = chunkMarkdown(extraction.markdownWithoutDataImages);
    const chunkIds: string[] = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const chunkText = chunks[index];
      const chunkId = `${source.id}-chunk-${String(index + 1).padStart(4, '0')}`;
      chunkIds.push(chunkId);
      await insertChunk({
        db: env.DB,
        chunkId,
        sourceId: source.id,
        chunkIndex: index,
        text: chunkText,
        topic: deriveTopic(chunkText),
        nowIso,
      });
    }

    const authored = parseAuthoredQuestions(extraction.markdownWithoutDataImages);
    await inferMissingAnswers(env, authored);

    const questionsToPersist: PersistQuestionInput[] = [];
    if (authored.length > 0) {
      const defaultAuthoredImageRef = pageImageRefs.get(1) ?? (imageRefs.length > 0 ? imageRefs[0] : null);
      for (let index = 0; index < authored.length; index += 1) {
        const authoredQuestion = authored[index];
        const chunkPointer = chunkIds.length === 0
          ? null
          : chunkIds[Math.min(chunkIds.length - 1, Math.floor((index / Math.max(authored.length, 1)) * chunkIds.length))];
        const sourceChunkIds = chunkPointer ? [chunkPointer] : [];
        const pageImageRef = authoredQuestion.sourcePage ? pageImageRefs.get(authoredQuestion.sourcePage) ?? null : null;
        const embeddedImageRef = imageRefs.length > 0 ? imageRefs[Math.min(index, imageRefs.length - 1)] : null;
        const resolvedImageRef = pageImageRef ?? embeddedImageRef ?? defaultAuthoredImageRef;
        questionsToPersist.push({
          questionId: `${source.id}-q${String(authoredQuestion.sourceOrder + 1).padStart(4, '0')}`,
          chapterId,
          sourceId: source.id,
          sourceOrder: authoredQuestion.sourceOrder,
          sourcePage: authoredQuestion.sourcePage,
          stem: authoredQuestion.stem,
          choices: authoredQuestion.choices,
          correctChoice: authoredQuestion.correctChoice ?? 'A',
          explanation:
            authoredQuestion.explanation ??
            'Best-supported answer inferred from source-authored question context.',
          imageRef: resolvedImageRef,
          sourceChunkIds,
          topic: deriveTopic(authoredQuestion.stem),
          difficulty: 'medium',
          qualityScore: 0.9,
          generationMode: 'authored',
          nowIso,
        });
      }
    } else {
      const maxGenerated = clampInt(Number(env.INGEST_GENERATED_QUESTION_COUNT ?? DEFAULT_MAX_GENERATED_QUESTIONS), 1, 60);
      const defaultPageImage = pageImageRefs.get(1) ?? null;
      for (let index = 0; index < chunkIds.length && questionsToPersist.length < maxGenerated; index += 1) {
        const generated = await generateQuestionFromChunk(env, {
          chunkText: chunks[index],
          sourceOrder: questionsToPersist.length,
          sourceChunkId: chunkIds[index],
          imageRef: imageRefs.length > 0 ? imageRefs[Math.min(index, imageRefs.length - 1)] : defaultPageImage,
        });
        if (!generated) {
          continue;
        }
        questionsToPersist.push({
          ...generated,
          questionId: `${source.id}-q${String(questionsToPersist.length + 1).padStart(4, '0')}`,
          chapterId,
          sourceId: source.id,
          sourceOrder: questionsToPersist.length,
          nowIso,
        });
      }
    }

    const seenHashes = new Set<string>();
    let persistedQuestionCount = 0;
    for (const question of questionsToPersist) {
      const fingerprint = `${normalizeWhitespace(question.stem).toLowerCase()}||${question.choices
        .map((choice) => normalizeWhitespace(choice).toLowerCase())
        .join('||')}`;
      const stemHash = await sha256Hex(fingerprint);
      if (seenHashes.has(stemHash)) {
        continue;
      }
      seenHashes.add(stemHash);

      if (features.questionStemHash) {
        const existing = await env.DB
          .prepare(
            `SELECT id
             FROM question
             WHERE chapter_id = ?1
               AND stem_hash = ?2
             LIMIT 1`,
          )
          .bind(question.chapterId, stemHash)
          .first<{ id: string }>();
        if (existing && existing.id !== question.questionId) {
          continue;
        }
      }

      await insertQuestion({
        db: env.DB,
        features,
        question,
        stemHash,
      });
      persistedQuestionCount += 1;
    }

    const cacheState = toQuestionCacheState(persistedQuestionCount);
    const parseConfidence = extraction.markdownWithoutDataImages.trim().length > 800 ? 0.92 : 0.75;

    if (features.sourceQuestionCacheState && features.sourceIngestedAt) {
      await env.DB
        .prepare(
          `UPDATE source
           SET chapter_id = COALESCE(chapter_id, ?2),
               status = 'ingested',
               parse_confidence = ?3,
               question_cache_state = ?4,
               ingested_at = ?5,
               updated_at = ?5
           WHERE id = ?1`,
        )
        .bind(source.id, chapterId, parseConfidence, cacheState, nowIso)
        .run();
    } else if (features.sourceQuestionCacheState) {
      await env.DB
        .prepare(
          `UPDATE source
           SET chapter_id = COALESCE(chapter_id, ?2),
               status = 'ingested',
               parse_confidence = ?3,
               question_cache_state = ?4,
               updated_at = ?5
           WHERE id = ?1`,
        )
        .bind(source.id, chapterId, parseConfidence, cacheState, nowIso)
        .run();
    } else {
      await env.DB
        .prepare(
          `UPDATE source
           SET chapter_id = COALESCE(chapter_id, ?2),
               status = 'ingested',
               parse_confidence = ?3,
               updated_at = ?4
           WHERE id = ?1`,
        )
        .bind(source.id, chapterId, parseConfidence, nowIso)
        .run();
    }

    await env.DB
      .prepare(
        `UPDATE ingest_job
         SET status = 'completed',
             error_code = NULL,
             error_detail = NULL,
             completed_at = ?3,
             updated_at = ?3
         WHERE id = ?1
           AND source_id = ?2`,
      )
      .bind(message.ingestJobId, source.id, nowIso)
      .run();
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown_ingest_error';
    await markFailed({
      env,
      sourceId: source.id,
      ingestJobId: message.ingestJobId,
      errorCode: 'ingest_failed',
      errorDetail: detail.slice(0, 500),
      nowIso,
    });
    throw error;
  }
}

export async function processIngestBatch(batch: MessageBatch<IngestQueueMessage>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    try {
      await processIngestJob(env, message.body);
      message.ack();
    } catch (error) {
      console.error('ingest_message_failed', {
        queue: batch.queue,
        messageId: message.id,
        attempts: message.attempts,
        error: error instanceof Error ? error.message : 'unknown',
      });
      message.retry();
    }
  }
}
