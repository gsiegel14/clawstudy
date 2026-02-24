export type Choice = 'A' | 'B' | 'C' | 'D';

export interface Env {
  // Cloudflare bindings
  DB: D1Database;
  STUDY_ASSETS: R2Bucket;
  AI?: Ai;
  INGEST_QUEUE?: Queue;
  // Vars (wrangler.jsonc vars section)
  SCHEMA_VERSION?: string;
  INGEST_TEXT_MODEL?: string;
  INGEST_GENERATED_QUESTION_COUNT?: string;
  CF_AI_GATEWAY_MODEL?: string;
  EXAM_DATE?: string;
  // Secrets
  STUDY_SERVICE_TOKEN?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TWILIO_AUTH_TOKEN?: string;
  STUDY_AGENT_ENABLED?: string;
  CLOUDFLARE_AI_GATEWAY_API_KEY?: string;
  CF_AI_GATEWAY_ACCOUNT_ID?: string;
  CF_AI_GATEWAY_GATEWAY_ID?: string;
  STUDY_AGENT_BASE_URL?: string;
}

export interface SourceRecord {
  sourceId: string;
  chapterId: string | null;
  uploadStatus: 'registered' | 'uploaded' | 'ingested' | 'failed';
  ingestStatus: 'queued' | 'processing' | 'completed' | 'failed' | null;
  objectKey: string;
  parseConfidence: number | null;
  chunkCount: number;
  errorCode: string | null;
}

export interface UploadSourceInput {
  filename: string;
  contentType: string;
  sha256?: string;
  sourceLabel?: string;
  chapterId?: string;
}

export interface QuizQuestion {
  questionId: string;
  chapterId: string;
  stem: string;
  choices: string[];
  correctChoice: Choice;
  explanation: string;
  sourceChunkIds: string[];
  sourceId?: string | null;
  topic?: string;
  difficulty?: string | null;
  imageRef: string | null;
}

export interface QuizSession {
  sessionId: string;
  userId: string;
  chapterId: string;
  status: 'active' | 'completed' | 'paused';
  currentQuestionIndex: number;
  lastQuestionId: string | null;
  currentQuestionPresentedAt: string | null;
  telegramUserId: string | null;
  telegramChatId: string | null;
}

export interface ChapterProgress {
  userId: string;
  chapterId: string;
  questionsAnswered: number;
  questionsCorrect: number;
  accuracy: number;
  updatedAt: string;
}

export interface PdfProgress {
  userId: string;
  sourceId: string;
  chapterId: string | null;
  questionsAnswered: number;
  questionsCorrect: number;
  accuracy: number;
  avgResponseTimeSeconds: number | null;
  confidenceAvg: number | null;
  lastAnsweredAt: string | null;
  updatedAt: string;
}

export interface QuestionProgress {
  userId: string;
  questionId: string;
  chapterId: string;
  sourceId: string | null;
  topic: string;
  questionsAnswered: number;
  questionsCorrect: number;
  accuracy: number;
  avgResponseTimeSeconds: number | null;
  confidenceAvg: number | null;
  lastAnsweredAt: string | null;
  updatedAt: string;
}

export interface TopicMastery {
  userId: string;
  topic: string;
  questionsAnswered: number;
  questionsCorrect: number;
  accuracy: number;
  avgResponseTimeSeconds: number | null;
  confidenceMismatchScore: number;
  masteryScore: number;
  weaknessRank: number | null;
  lastAnsweredAt: string | null;
  nextReviewAt: string | null;
  updatedAt: string;
}

export interface QuestionAttemptRecord {
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
  createdAt: string;
}

export interface ChunkContext {
  chunkId: string;
  sourceId: string | null;
  topicTag: string | null;
  text: string;
}

export interface StudyStore {
  createSource(input: UploadSourceInput): Promise<{ sourceId: string; objectKey: string; uploadUrl: string; expiresAt: string }>;
  completeSource(sourceId: string): Promise<{ ingestJobId: string; status: 'queued' }>;
  getSourceStatus(sourceId: string): Promise<SourceRecord | null>;
  getOrCreateSession(input: {
    chapterId: string;
    userId: string;
    telegramUserId: string | null;
    telegramChatId: string | null;
    nowIso: string;
  }): Promise<QuizSession>;
  getSessionById(sessionId: string): Promise<QuizSession | null>;
  getActiveSessionByUser(userId: string): Promise<QuizSession | null>;
  getQuestionByIndex(chapterId: string, questionIndex: number): Promise<QuizQuestion | null>;
  getQuestionById(questionId: string): Promise<QuizQuestion | null>;
  getChunkContexts(chunkIds: string[]): Promise<ChunkContext[]>;
  recordAttempt(input: {
    sessionId: string;
    questionId: string;
    selectedChoice: Choice;
    isCorrect: boolean;
    responseTimeSeconds: number;
    confidence: number | null;
    idempotencyKey: string;
    nowIso: string;
  }): Promise<void>;
  recomputeProgress(input: { userId: string; chapterId: string; nowIso: string }): Promise<ChapterProgress>;
  recomputeQuestionProgress(input: { userId: string; questionId: string; nowIso: string }): Promise<QuestionProgress | null>;
  recomputePdfProgress(input: { userId: string; sourceId: string; nowIso: string }): Promise<PdfProgress | null>;
  recomputeTopicMastery(input: { userId: string; topic: string; nowIso: string }): Promise<TopicMastery | null>;
  refreshTopicWeaknessRanks(userId: string): Promise<void>;
  updateSessionPointer(input: {
    sessionId: string;
    questionIndex: number;
    lastQuestionId: string | null;
    currentQuestionPresentedAt: string | null;
    nowIso: string;
  }): Promise<void>;
  listProgress(userId: string): Promise<ChapterProgress[]>;
  listPdfProgress(userId: string): Promise<PdfProgress[]>;
  listQuestionProgress(userId: string): Promise<QuestionProgress[]>;
  listTopicMastery(userId: string): Promise<TopicMastery[]>;
  listRecentAttempts(userId: string, limit: number): Promise<QuestionAttemptRecord[]>;
  getDashboard(): Promise<{
    questionsTotal: number;
    attemptsTotal: number;
    sessionsActive: number;
    chapterCacheReady: number;
    chapterCacheDegraded: number;
    chapterCacheEmpty: number;
  }>;
  seedPilotChapter(input: {
    chapterId: string;
    sourceObjectKey: string;
    imageObjectKey: string | null;
    questionCount: number;
    nowIso: string;
  }): Promise<{
    chapterId: string;
    questionCount: number;
    imageQuestionCount: number;
  }>;
}

export interface IdempotencyRecord {
  requestHash: string;
  statusCode: number;
  responseJson: string;
}

export interface IdempotencyStore {
  get(idempotencyKey: string, endpoint: string): Promise<IdempotencyRecord | null>;
  put(input: {
    idempotencyKey: string;
    endpoint: string;
    requestHash: string;
    statusCode: number;
    responseJson: string;
    nowIso: string;
    ttlSeconds: number;
  }): Promise<void>;
}
