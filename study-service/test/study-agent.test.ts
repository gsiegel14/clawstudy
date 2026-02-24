import { afterEach, describe, expect, it, vi } from 'vitest';
import { planTelegramAgentRoute } from '../src/study-agent';
import type { AgentPlannerInput } from '../src/study-agent';
import type { Env } from '../src/types';

const DEFAULT_LLAMA_MODEL = 'workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast';

function createInput(envOverrides?: Partial<Env>): AgentPlannerInput {
  const env = {
    STUDY_AGENT_ENABLED: 'true',
    CLOUDFLARE_AI_GATEWAY_API_KEY: 'test-api-key',
    CF_AI_GATEWAY_ACCOUNT_ID: 'test-account-id',
    CF_AI_GATEWAY_GATEWAY_ID: 'test-gateway-id',
    ...envOverrides,
  } as unknown as Env;

  return {
    env,
    nowIso: '2026-02-24T18:00:00.000Z',
    userId: 'tg:user:123',
    userText: 'help me continue',
    selectedFolder: null,
    activeSession: {
      chapterId: null,
      questionIndex: null,
    },
    recentMisses: [],
    history: [],
    examDate: null,
    topicWeaknesses: [],
    topicsReviewDueCount: 0,
  };
}

function createPlannerResponse(content = '{"action":"chat","message":"ok"}'): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content,
          },
        },
      ],
    }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    },
  );
}

describe('study agent model routing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses Gemma default model when no override is set', async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => createPlannerResponse());
    vi.stubGlobal('fetch', fetchMock);

    const decision = await planTelegramAgentRoute(createInput());
    expect(decision).toEqual({ route: 'chat', message: 'ok' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0];
    const init = firstCall?.[1] as RequestInit | undefined;
    expect(init).toBeDefined();
    if (!init) {
      throw new Error('expected fetch init payload');
    }
    expect(typeof init.body).toBe('string');
    const payload = JSON.parse(init.body as string) as { model: string };
    expect(payload.model).toBe(DEFAULT_LLAMA_MODEL);
  });

  it('uses CF_AI_GATEWAY_MODEL override when provided', async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => createPlannerResponse());
    vi.stubGlobal('fetch', fetchMock);

    const overrideModel = 'workers-ai/@cf/meta/llama-3.2-3b-instruct';
    const decision = await planTelegramAgentRoute(createInput({ CF_AI_GATEWAY_MODEL: overrideModel }));
    expect(decision).toEqual({ route: 'chat', message: 'ok' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0];
    const init = firstCall?.[1] as RequestInit | undefined;
    expect(init).toBeDefined();
    if (!init) {
      throw new Error('expected fetch init payload');
    }
    expect(typeof init.body).toBe('string');
    const payload = JSON.parse(init.body as string) as { model: string };
    expect(payload.model).toBe(overrideModel);
  });

  it('falls back to Workers AI binding when gateway secrets are unavailable', async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => createPlannerResponse());
    vi.stubGlobal('fetch', fetchMock);

    const aiRunMock = vi.fn(async (..._args: unknown[]) => ({
      response: '{"action":"chat","message":"Use resume to continue your active chapter."}',
    }));

    const decision = await planTelegramAgentRoute(
      createInput({
        CLOUDFLARE_AI_GATEWAY_API_KEY: undefined,
        CF_AI_GATEWAY_ACCOUNT_ID: undefined,
        CF_AI_GATEWAY_GATEWAY_ID: undefined,
        AI: {
          run: aiRunMock,
        } as unknown as Env['AI'],
      }),
    );

    expect(decision).toEqual({
      route: 'chat',
      message: 'Use resume to continue your active chapter.',
    });
    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(aiRunMock).toHaveBeenCalledTimes(1);
    const firstCall = aiRunMock.mock.calls[0];
    expect(firstCall?.[0]).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
  });

  it('uses default Workers AI model when gateway model is non-WorkersAI', async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => createPlannerResponse());
    vi.stubGlobal('fetch', fetchMock);

    const aiRunMock = vi.fn(async (..._args: unknown[]) => ({
      response: '{"action":"chat","message":"I can help you continue where you left off."}',
    }));

    const decision = await planTelegramAgentRoute(
      createInput({
        CF_AI_GATEWAY_MODEL: 'anthropic/claude-haiku-4-5-20251001',
        CLOUDFLARE_AI_GATEWAY_API_KEY: undefined,
        CF_AI_GATEWAY_ACCOUNT_ID: undefined,
        CF_AI_GATEWAY_GATEWAY_ID: undefined,
        AI: {
          run: aiRunMock,
        } as unknown as Env['AI'],
      }),
    );

    expect(decision).toEqual({
      route: 'chat',
      message: 'I can help you continue where you left off.',
    });
    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(aiRunMock).toHaveBeenCalledTimes(1);
    const firstCall = aiRunMock.mock.calls[0];
    expect(firstCall?.[0]).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
  });

  it('normalizes ingest actions from planner output', async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) =>
      createPlannerResponse('{"action":"ingest_status","chapter_id":"us-01"}'),
    );
    vi.stubGlobal('fetch', fetchMock);

    const decision = await planTelegramAgentRoute(createInput());
    expect(decision).toEqual({
      route: 'ingest_status',
      chapterId: 'us-01',
      chapterName: null,
    });
  });

  it('normalizes skill action payloads into deterministic routes', async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) =>
      createPlannerResponse('{"action":"skill","skill_id":"review_chapter","chapter_id":"us-02"}'),
    );
    vi.stubGlobal('fetch', fetchMock);

    const decision = await planTelegramAgentRoute(createInput());
    expect(decision).toEqual({
      route: 'start',
      chapterId: 'us-02',
      chapterName: null,
    });
  });

  it('ignores deprecated parser action responses', async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => createPlannerResponse('{"action":"parser"}'));
    vi.stubGlobal('fetch', fetchMock);

    const decision = await planTelegramAgentRoute(createInput());
    expect(decision).toBeNull();
  });
});
