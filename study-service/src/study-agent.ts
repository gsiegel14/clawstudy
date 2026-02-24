import type { Env } from './types';

export interface AgentMissSnapshot {
  questionId: string;
  chapterId: string;
  sourceId: string | null;
  topic: string;
  selectedChoice: 'A' | 'B' | 'C' | 'D';
  correctChoice: 'A' | 'B' | 'C' | 'D';
  stem: string;
  explanation: string;
  createdAt: string;
}

export interface AgentHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

export type AgentSkillId =
  | 'list_folders'
  | 'select_folder'
  | 'list_pdfs'
  | 'open_pdf'
  | 'review_chapter'
  | 'question_one'
  | 'resume_chapter'
  | 'queue_ingest'
  | 'ingest_status'
  | 'review_misses'
  | 'review_last_miss'
  | 'direct_reply';

export type AgentRouteDecision =
  | { route: 'chat'; message: string }
  | { route: 'misses'; limit: number }
  | { route: 'last_miss' }
  | { route: 'folders' }
  | { route: 'folder'; folderQuery: string }
  | { route: 'pdfs' }
  | { route: 'pdf'; pdfQuery: string }
  | { route: 'ingest'; chapterId: string | null; chapterName: string | null }
  | { route: 'ingest_status'; chapterId: string | null; chapterName: string | null }
  | { route: 'start'; chapterId: string | null; chapterName: string | null }
  | { route: 'question'; chapterId: string | null; chapterName: string | null; questionNumber: number }
  | { route: 'q1'; chapterId: string | null; chapterName: string | null }
  | { route: 'resume'; chapterId: string | null; chapterName: string | null }
  | { route: 'upload_pdf'; label: string | null };

export interface AgentPlannerInput {
  env: Env;
  nowIso: string;
  userId: string;
  userText: string;
  selectedFolder: string | null;
  activeSession: {
    chapterId: string | null;
    questionIndex: number | null;
  };
  recentMisses: AgentMissSnapshot[];
  history: AgentHistoryTurn[];
  examDate: string | null;
  topicWeaknesses: string[];
  topicsReviewDueCount: number;
}

export type AgentPlanner = (input: AgentPlannerInput) => Promise<AgentRouteDecision | null>;

const DEFAULT_WORKERS_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const DEFAULT_AGENT_MODEL = `workers-ai/${DEFAULT_WORKERS_AI_MODEL}`;
const DEFAULT_CHAT_LIMIT = 800;

function isTruthy(input: string | undefined): boolean {
  if (!input) {
    return false;
  }
  const normalized = input.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function normalizeChapterId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().toLowerCase();

  // us-XX (Emergency & Clinical Ultrasound)
  const usMatch = trimmed.match(/^us[\s-]?([0-9]{1,2})$/);
  if (usMatch?.[1]) {
    const n = Number.parseInt(usMatch[1], 10);
    if (n >= 1 && n <= 99) return `us-${String(n).padStart(2, '0')}`;
  }

  // gp-XX (Gottlieb POCUS)
  const gpMatch = trimmed.match(/^gp[\s-]?([0-9]{1,2})$/);
  if (gpMatch?.[1]) {
    const n = Number.parseInt(gpMatch[1], 10);
    if (n >= 1 && n <= 99) return `gp-${String(n).padStart(2, '0')}`;
  }

  // acep-XX (ACEP Course)
  const acepMatch = trimmed.match(/^acep[\s-]?([0-9]{1,2})$/);
  if (acepMatch?.[1]) {
    const n = Number.parseInt(acepMatch[1], 10);
    if (n >= 1 && n <= 99) return `acep-${String(n).padStart(2, '0')}`;
  }

  return null;
}

// US chapter keyword map for fuzzy name resolution
const US_CHAPTER_KEYWORDS: Array<{ id: string; keywords: string[] }> = [
  { id: 'us-01', keywords: ['fast exam', 'fast', 'focused assessment', 'trauma scan'] },
  { id: 'us-02', keywords: ['focused echo', 'focused cardiac', 'echo', 'cardiac', 'echocardiography'] },
  { id: 'us-03', keywords: ['physics', 'knobology', 'transducer', 'machine settings'] },
  { id: 'us-04', keywords: ['resuscitative', 'resus', 'cardiac arrest', 'cpr ultrasound'] },
  { id: 'us-05', keywords: ['thoracic', 'lung', 'pneumothorax', 'pleural effusion', 'pulmonary'] },
  { id: 'us-06', keywords: ['aorta', 'aortic', 'aneurysm', 'aaa', 'abdominal aorta'] },
  { id: 'us-07', keywords: ['hepatobiliary', 'liver', 'gallbladder', 'biliary', 'hepatic'] },
  { id: 'us-08', keywords: ['renal', 'kidney', 'hydronephrosis', 'ureter', 'urinary'] },
  { id: 'us-09', keywords: ['pregnancy', 'ob', 'obstetric', 'fetal', 'uterus', 'ectopic', 'intrauterine'] },
  { id: 'us-10', keywords: ['gynecologic', 'gynecology', 'gyn', 'pelvic', 'ovary', 'ovarian'] },
  { id: 'us-11', keywords: ['soft tissue', 'abscess', 'cellulitis', 'skin infection', 'foreign body'] },
  { id: 'us-12', keywords: ['ocular', 'eye', 'optic nerve', 'retina', 'orbital'] },
  { id: 'us-13', keywords: ['procedural', 'procedure', 'central line', 'nerve block', 'guided procedure'] },
  { id: 'us-14', keywords: ['airway', 'ent', 'throat', 'neck', 'trachea', 'larynx'] },
  { id: 'us-15', keywords: ['dvt', 'vte', 'deep vein', 'thrombosis', 'venous', 'clot'] },
  { id: 'us-16', keywords: ['testicular', 'testicle', 'scrotal', 'scrotum', 'epididymis'] },
  { id: 'us-17', keywords: ['bowel', 'appendix', 'appendicitis', 'intestine', 'gi', 'gastrointestinal'] },
  { id: 'us-18', keywords: ['msk', 'musculoskeletal', 'muscle', 'tendon', 'bone', 'joint', 'fracture'] },
];

export function resolveChapterIdFromName(query: string): string | null {
  if (!query || query.trim().length === 0) return null;
  const q = query.toLowerCase().trim();

  // Direct ID format first
  const directId = normalizeChapterId(q);
  if (directId) return directId;

  // "chapter N" or bare number → us-NN
  const numMatch = q.match(/(?:chapter\s+)?([0-9]{1,2})(?:\s|$|[^0-9])/);
  if (numMatch?.[1]) {
    const n = Number.parseInt(numMatch[1], 10);
    if (n >= 1 && n <= 18) return `us-${String(n).padStart(2, '0')}`;
  }

  // Keyword match — longest match wins
  let bestId: string | null = null;
  let bestScore = 0;
  for (const entry of US_CHAPTER_KEYWORDS) {
    for (const keyword of entry.keywords) {
      if (q.includes(keyword) && keyword.length > bestScore) {
        bestScore = keyword.length;
        bestId = entry.id;
      }
    }
  }
  return bestId;
}

function trimToLength(input: string, maxLength: number): string {
  if (input.length <= maxLength) {
    return input;
  }
  return `${input.slice(0, maxLength - 1).trim()}...`;
}

function coerceString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function coerceQuestionNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
    return null;
  }
  return parsed;
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
    // fall through and attempt a bounded object extraction
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  const candidate = trimmed.slice(firstBrace, lastBrace + 1);
  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
}

function extractContent(rawContent: unknown): string {
  if (typeof rawContent === 'string') {
    return rawContent;
  }
  if (!Array.isArray(rawContent)) {
    return '';
  }

  const segments = rawContent
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const asRecord = item as Record<string, unknown>;
      if (typeof asRecord.text === 'string') {
        return asRecord.text;
      }
      if (asRecord.text && typeof asRecord.text === 'object') {
        const textObj = asRecord.text as Record<string, unknown>;
        if (typeof textObj.value === 'string') {
          return textObj.value;
        }
      }
      return null;
    })
    .filter((value): value is string => Boolean(value && value.trim().length > 0));

  return segments.join('\n').trim();
}

function normalizeDecision(raw: Record<string, unknown>): AgentRouteDecision | null {
  const actionRaw = coerceString(raw.action) ?? coerceString(raw.route);
  if (!actionRaw) {
    return null;
  }
  const action = actionRaw.toLowerCase();

  // chapter_name is the LLM's free-text chapter reference (e.g. "focused echo")
  // chapter_id is the preferred exact format (e.g. "us-02")
  const rawChapterId = raw.chapter_id ?? raw.chapterId;
  const chapterId = normalizeChapterId(rawChapterId);
  const chapterName =
    coerceString(raw.chapter_name ?? raw.chapterName) ??
    (chapterId === null && rawChapterId !== undefined ? coerceString(rawChapterId) : null);

  if (action === 'skill' || action === 'run_skill' || action === 'execute_skill') {
    const skillRaw = coerceString(raw.skill_id) ?? coerceString(raw.skillId);
    if (!skillRaw) {
      return null;
    }
    const skill = skillRaw.toLowerCase() as AgentSkillId;
    const folderQuery = coerceString(raw.folder_query) ?? coerceString(raw.folderQuery) ?? coerceString(raw.query);
    const pdfQuery = coerceString(raw.pdf_query) ?? coerceString(raw.pdfQuery) ?? coerceString(raw.query);
    const message = coerceString(raw.message) ?? coerceString(raw.reply);
    const limitValue = Number(raw.limit);
    const limit = Number.isFinite(limitValue) ? Math.max(1, Math.min(10, Math.floor(limitValue))) : 5;

    if (skill === 'list_folders') return { route: 'folders' };
    if (skill === 'select_folder') {
      if (!folderQuery) return null;
      return { route: 'folder', folderQuery };
    }
    if (skill === 'list_pdfs') return { route: 'pdfs' };
    if (skill === 'open_pdf') {
      if (!pdfQuery) return null;
      return { route: 'pdf', pdfQuery };
    }
    if (skill === 'review_chapter') return { route: 'start', chapterId, chapterName };
    if (skill === 'question_one') return { route: 'q1', chapterId, chapterName };
    if (skill === 'resume_chapter') return { route: 'resume', chapterId, chapterName };
    if (skill === 'queue_ingest') return { route: 'ingest', chapterId, chapterName };
    if (skill === 'ingest_status') return { route: 'ingest_status', chapterId, chapterName };
    if (skill === 'review_misses') return { route: 'misses', limit };
    if (skill === 'review_last_miss') return { route: 'last_miss' };
    if (skill === 'direct_reply') {
      if (!message) return null;
      return { route: 'chat', message: trimToLength(message, DEFAULT_CHAT_LIMIT) };
    }
    return null;
  }

  if (action === 'chat' || action === 'reply') {
    const message = coerceString(raw.message) ?? coerceString(raw.reply) ?? null;
    if (!message) return null;
    return { route: 'chat', message: trimToLength(message, DEFAULT_CHAT_LIMIT) };
  }

  if (action === 'misses' || action === 'summarize_misses') {
    const limitValue = Number(raw.limit);
    const limit = Number.isFinite(limitValue) ? Math.max(1, Math.min(10, Math.floor(limitValue))) : 5;
    return { route: 'misses', limit };
  }

  if (action === 'last_miss' || action === 'explain_last_miss') {
    return { route: 'last_miss' };
  }

  if (action === 'folders') return { route: 'folders' };

  if (action === 'folder') {
    const folderQuery = coerceString(raw.folder_query) ?? coerceString(raw.folderQuery) ?? null;
    if (!folderQuery) return null;
    return { route: 'folder', folderQuery };
  }

  if (action === 'pdfs') return { route: 'pdfs' };

  if (action === 'pdf' || action === 'start_pdf' || action === 'read_pdf') {
    const pdfQuery = coerceString(raw.pdf_query) ?? coerceString(raw.pdfQuery) ?? null;
    if (!pdfQuery) return null;
    return { route: 'pdf', pdfQuery };
  }

  if (action === 'ingest' || action === 'reingest' || action === 'parse_pdf' || action === 'process') {
    return { route: 'ingest', chapterId, chapterName };
  }

  if (action === 'ingest_status' || action === 'status_ingest') {
    return { route: 'ingest_status', chapterId, chapterName };
  }

  if (action === 'start' || action === 'study' || action === 'review') {
    return { route: 'start', chapterId, chapterName };
  }

  if (action === 'question') {
    const questionNumber =
      coerceQuestionNumber(raw.question_number) ??
      coerceQuestionNumber(raw.questionNumber) ??
      coerceQuestionNumber(raw.index);
    if (!questionNumber) return null;
    if (questionNumber === 1) return { route: 'q1', chapterId, chapterName };
    return { route: 'question', chapterId, chapterName, questionNumber };
  }

  if (action === 'q1' || action === 'question_1') {
    return { route: 'q1', chapterId, chapterName };
  }

  if (action === 'resume' || action === 'continue') {
    return { route: 'resume', chapterId, chapterName };
  }

  return null;
}

function buildGatewayBaseUrl(env: Env): string | null {
  if (env.STUDY_AGENT_BASE_URL && env.STUDY_AGENT_BASE_URL.trim().length > 0) {
    return env.STUDY_AGENT_BASE_URL.replace(/\/+$/, '');
  }
  if (!env.CF_AI_GATEWAY_ACCOUNT_ID || !env.CF_AI_GATEWAY_GATEWAY_ID) {
    return null;
  }
  return `https://gateway.ai.cloudflare.com/v1/${env.CF_AI_GATEWAY_ACCOUNT_ID}/${env.CF_AI_GATEWAY_GATEWAY_ID}/compat`;
}

function toWorkersAiModel(model: string): string {
  return model.replace(/^workers-ai\//, '');
}

function resolveWorkersAiModel(model: string, env: Env): string {
  const override = env.STUDY_AGENT_WORKERS_AI_MODEL?.trim();
  if (override && override.length > 0) {
    return toWorkersAiModel(override);
  }
  if (model.startsWith('workers-ai/') || model.startsWith('@cf/')) {
    return toWorkersAiModel(model);
  }
  return DEFAULT_WORKERS_AI_MODEL;
}

function buildMissesSummary(misses: AgentMissSnapshot[]): string {
  if (misses.length === 0) {
    return 'none';
  }
  return misses
    .slice(0, 5)
    .map((miss, index) => {
      const stem = trimToLength(miss.stem.replace(/\s+/g, ' ').trim(), 140);
      const explanation = trimToLength(miss.explanation.replace(/\s+/g, ' ').trim(), 140);
      return `${index + 1}) ${miss.questionId} | ${miss.chapterId} | topic=${miss.topic} | selected=${miss.selectedChoice} | correct=${miss.correctChoice}\nstem=${stem}\nexplanation=${explanation}`;
    })
    .join('\n');
}

function historyToText(history: AgentHistoryTurn[]): string {
  if (history.length === 0) {
    return 'none';
  }
  return history
    .slice(-12)
    .map((turn) => `${turn.role.toUpperCase()}: ${trimToLength(turn.content.replace(/\s+/g, ' ').trim(), 300)}`)
    .join('\n');
}

function daysUntil(examDateIso: string, nowIso: string): number | null {
  const exam = Date.parse(examDateIso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(exam) || Number.isNaN(now)) {
    return null;
  }
  return Math.ceil((exam - now) / (1000 * 60 * 60 * 24));
}

export function isStudyAgentEnabled(env: Env): boolean {
  if (isTruthy(env.STUDY_AGENT_ENABLED)) {
    return true;
  }
  if (env.STUDY_AGENT_ENABLED && !isTruthy(env.STUDY_AGENT_ENABLED)) {
    return false;
  }
  const hasGatewaySecrets =
    Boolean(env.CLOUDFLARE_AI_GATEWAY_API_KEY) &&
    Boolean(env.CF_AI_GATEWAY_ACCOUNT_ID) &&
    Boolean(env.CF_AI_GATEWAY_GATEWAY_ID);
  return hasGatewaySecrets;
}

function extractDecisionFromGatewayResponse(data: Record<string, unknown>): Record<string, unknown> | null {
  const choices = Array.isArray(data.choices) ? data.choices : [];
  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== 'object') {
    return null;
  }
  const message = (firstChoice as Record<string, unknown>).message;
  if (!message || typeof message !== 'object') {
    return null;
  }

  const messageContent = extractContent((message as Record<string, unknown>).content);
  return extractJsonObject(messageContent);
}

function extractDecisionFromWorkersAiResponse(data: unknown): Record<string, unknown> | null {
  if (typeof data === 'string') {
    return extractJsonObject(data);
  }
  if (!data || typeof data !== 'object') {
    return null;
  }
  const asRecord = data as Record<string, unknown>;
  const responseText =
    coerceString(asRecord.response) ??
    coerceString(asRecord.output_text) ??
    coerceString(asRecord.result) ??
    null;
  if (!responseText) {
    return null;
  }
  return extractJsonObject(responseText);
}

export async function planTelegramAgentRoute(input: AgentPlannerInput): Promise<AgentRouteDecision | null> {
  if (!isStudyAgentEnabled(input.env)) {
    return null;
  }

  const model = input.env.CF_AI_GATEWAY_MODEL && input.env.CF_AI_GATEWAY_MODEL.trim().length > 0
    ? input.env.CF_AI_GATEWAY_MODEL.trim()
    : DEFAULT_AGENT_MODEL;

  const examDate = input.examDate ?? input.env.EXAM_DATE ?? null;
  const daysRemaining = examDate ? daysUntil(examDate, input.nowIso) : null;
  const examContext = examDate
    ? `Exam date: ${examDate}. Days remaining: ${daysRemaining ?? '?'}.`
    : '';
  const weaknessContext =
    input.topicWeaknesses.length > 0
      ? `Weak topics (prioritize): ${input.topicWeaknesses.slice(0, 3).join(', ')}.`
      : '';
  const reviewContext =
    input.topicsReviewDueCount > 0
      ? `Topics due for review today: ${input.topicsReviewDueCount}.`
      : '';

  const systemPrompt = [
    'You are ClawStudy, an emergency medicine board-prep assistant for Telegram and SMS.',
    'Return JSON only — never prose, never markdown.',
    'Understand natural language. The user may say anything. Map their intent to one action.',
    examContext,
    weaknessContext,
    reviewContext,
    '',
    'US chapter catalog (emergency-clinical-ultrasound source):',
    'us-01=FAST, us-02=Focused Echo, us-03=Physics/Knobology, us-04=Resuscitative US,',
    'us-05=Thoracic Ultrasound, us-06=Aorta, us-07=Hepatobiliary, us-08=Renal,',
    'us-09=Pregnancy, us-10=Gynecologic, us-11=Soft Tissue, us-12=Ocular,',
    'us-13=Procedural US, us-14=Airway/ENT, us-15=DVT/VTE, us-16=Testicular,',
    'us-17=Bowel/Appendix, us-18=MSK.',
    'Gottlieb POCUS: gp-01 through gp-31. ACEP Course: acep-01 through acep-23.',
    '',
    'Allowed actions and when to use them:',
    '- ingest: user wants to process/parse/load a NEW chapter not yet ingested, or says "review new chapter X". Extract chapter_id from name. ALWAYS prefer ingest over start for new chapters.',
    '- start: user wants to begin studying/quizzing a chapter that is already loaded (has questions).',
    '- resume: user wants to continue their current session where they left off.',
    '- q1: user wants the first question of a chapter (question number 1).',
    '- question: user asks for a specific question number (include question_number).',
    '- ingest_status: user asks if ingest finished, how many questions were found, or checks progress.',
    '- misses: user asks about wrong answers or wants to review mistakes (include limit 1-10, default 5).',
    '- last_miss: user asks specifically about the most recent mistake.',
    '- chat: greetings, out-of-scope, progress updates, or when no clear action. Always include a helpful next step.',
    '',
    'Rules:',
    '- Match chapter names to chapter_id using the catalog above. "focused echo" → us-02, "cardiac" → us-02, "chapter 5" → us-05, "echo" → us-02.',
    '- When chapter_id cannot be determined, set chapter_name to the user\'s exact chapter phrase.',
    '- Prefer resume over start when active_session is set and user is vague.',
    '- "review new chapter X" or "lets do chapter X" or "ingest X" → use ingest action.',
    '- For chat, mention the exam date, days remaining, or weak topics when relevant.',
    '- Never invent chapter IDs not in the catalog.',
  ]
    .filter((line) => line !== undefined)
    .join('\n');

  const userPrompt = [
    `timestamp_utc=${input.nowIso}`,
    `user_id=${input.userId}`,
    examDate ? `exam_date=${examDate}` : null,
    daysRemaining !== null ? `days_remaining=${daysRemaining}` : null,
    input.topicWeaknesses.length > 0 ? `weak_topics=${input.topicWeaknesses.slice(0, 3).join(',')}` : null,
    input.topicsReviewDueCount > 0 ? `review_due_count=${input.topicsReviewDueCount}` : null,
    `active_session=${input.activeSession.chapterId ? `${input.activeSession.chapterId}@q${(input.activeSession.questionIndex ?? 0) + 1}` : 'none'}`,
    `recent_misses:\n${buildMissesSummary(input.recentMisses)}`,
    `conversation_history:\n${historyToText(input.history)}`,
    `user_message:\n${input.userText}`,
    'JSON schema:',
    '{',
    '  "action": "chat|misses|last_miss|ingest|ingest_status|start|question|q1|resume",',
    '  "message": "required when action=chat",',
    '  "chapter_id": "us-02 style ID from catalog above (preferred)",',
    '  "chapter_name": "set this when chapter_id is unclear, e.g. \\"focused echo\\" or \\"chapter 3\\"",',
    '  "question_number": "required when action=question",',
    '  "limit": "optional integer for misses (1-10, default 5)"',
    '}',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  const payload = {
    model,
    temperature: 0.1,
    max_tokens: 350,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  };

  let decisionRaw: Record<string, unknown> | null = null;

  const apiKey = input.env.CLOUDFLARE_AI_GATEWAY_API_KEY;
  const gatewayBaseUrl = buildGatewayBaseUrl(input.env);
  if (apiKey && apiKey.trim().length > 0 && gatewayBaseUrl) {
    const endpoint = `${gatewayBaseUrl}/chat/completions`;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      'cf-aig-authorization': `Bearer ${apiKey}`,
    };
    const tryGatewayRequest = async (withResponseFormat: boolean): Promise<Record<string, unknown> | null> => {
      const requestPayload = withResponseFormat ? payload : { ...payload, response_format: undefined };
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestPayload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.warn('study_agent_planner_error', {
          status: response.status,
          endpoint,
          body: trimToLength(errorText, 240),
        });
        return null;
      }

      const data = (await response.json()) as Record<string, unknown>;
      return extractDecisionFromGatewayResponse(data);
    };

    decisionRaw = await tryGatewayRequest(true);
    if (!decisionRaw) {
      decisionRaw = await tryGatewayRequest(false);
    }
  }

  if (!decisionRaw && input.env.AI) {
    const workersAiModel = resolveWorkersAiModel(model, input.env);
    const baseAiPayload = {
      messages: payload.messages,
      temperature: payload.temperature,
      max_tokens: payload.max_tokens,
    };

    const tryWorkersAiRequest = async (withResponseFormat: boolean): Promise<Record<string, unknown> | null> => {
      try {
        const aiPayload = withResponseFormat
          ? { ...baseAiPayload, response_format: payload.response_format }
          : baseAiPayload;
        const result = await input.env.AI!.run(workersAiModel as keyof AiModels, aiPayload);
        return extractDecisionFromWorkersAiResponse(result);
      } catch (error) {
        console.warn('study_agent_planner_ai_binding_error', {
          model: workersAiModel,
          withResponseFormat,
          message: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    };

    decisionRaw = await tryWorkersAiRequest(true);
    if (!decisionRaw) {
      decisionRaw = await tryWorkersAiRequest(false);
    }
  }

  if (!decisionRaw) {
    return null;
  }
  return normalizeDecision(decisionRaw);
}
