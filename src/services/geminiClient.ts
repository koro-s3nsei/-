import { db, DEFAULT_SETTINGS } from '../db/dexie';
import { decryptLocalSecret } from '../lib/cryptoVault';
import { generateId } from '../lib/utils';
import type {
  CommitmentCategory,
  IngestionResult,
  ProjectDecompositionResult,
} from '../types/models';
import {
  buildOfflineBlueprintSvg,
  parseScheduleTextOffline,
  runOfflineProjectDecomposition,
  runOfflineStrictIngestion,
} from './offlineFallbackEngine';

/**
 * Direct Client-Side Gemini REST Client (100% Native fetch, zero SDK/proxy dependency).
 * Connects directly to Google's official v1beta endpoint using the user's locally
 * encrypted BYOK key and configurable Model ID (default: gemini-2.5-flash).
 * Automatically degrades to OfflineFallbackEngine when offline or unconfigured.
 */

export const DEFAULT_GEMINI_MODEL_ID = DEFAULT_SETTINGS.geminiModelId ?? 'gemini-2.5-flash';

interface GeminiRestErrorPayload {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

interface GeminiRestSuccessPayload {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
}

interface GeminiRequestConfig {
  prompt: string;
  systemInstruction?: string;
  responseMimeType?: string;
  responseSchema?: Record<string, unknown>;
}

async function getActiveCredentials(): Promise<{
  apiKey: string;
  modelId: string;
} | null> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return null;
  }
  const settings = await db.appSettings.get('singleton');
  const apiKey = await decryptLocalSecret(settings?.encryptedApiKey, settings?.apiKeyIv);
  if (!apiKey || apiKey.trim().length < 10) {
    return null;
  }
  const modelId = (settings?.geminiModelId || DEFAULT_GEMINI_MODEL_ID).trim();
  return {
    apiKey: apiKey.trim(),
    modelId: modelId || DEFAULT_GEMINI_MODEL_ID,
  };
}

export async function callGeminiDirectFetch(
  apiKey: string,
  modelName: string,
  config: GeminiRequestConfig
): Promise<string> {
  const cleanModel = (modelName || DEFAULT_GEMINI_MODEL_ID).trim().replace(/^models\//, '');
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    cleanModel
  )}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;

  const body: Record<string, unknown> = {
    contents: [
      {
        role: 'user',
        parts: [{ text: config.prompt }],
      },
    ],
  };

  if (config.systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: config.systemInstruction }],
    };
  }

  if (config.responseMimeType || config.responseSchema) {
    const generationConfig: Record<string, unknown> = {};
    if (config.responseMimeType) {
      generationConfig.responseMimeType = config.responseMimeType;
    }
    if (config.responseSchema) {
      generationConfig.responseSchema = config.responseSchema;
    }
    body.generationConfig = generationConfig;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const rawText = await response.text();
  let parsed: (GeminiRestSuccessPayload & GeminiRestErrorPayload) | null = null;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const googleMessage = parsed?.error?.message;
    const googleStatus = parsed?.error?.status;
    if (googleMessage) {
      throw new Error(
        `Google API (${response.status}${googleStatus ? ` ${googleStatus}` : ''}): ${googleMessage}`
      );
    }
    throw new Error(`HTTP ${response.status}: ${rawText.slice(0, 220) || response.statusText}`);
  }

  const parts = parsed?.candidates?.[0]?.content?.parts ?? [];
  const combinedText = parts
    .map((p) => (typeof p.text === 'string' ? p.text : ''))
    .join('')
    .trim();

  if (!combinedText) {
    throw new Error('أعاد النموذج استجابة فارغة بدون نص.');
  }

  return combinedText;
}

export async function hasConfiguredApiKey(): Promise<boolean> {
  const settings = await db.appSettings.get('singleton');
  return Boolean(settings?.encryptedApiKey && settings?.apiKeyIv);
}

export async function testGeminiConnection(
  plainApiKey?: string,
  overrideModelId?: string
): Promise<{
  ok: boolean;
  message: string;
}> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { ok: false, message: 'لا يوجد اتصال بالإنترنت حالياً.' };
  }

  const settings = await db.appSettings.get('singleton');
  let keyToUse = plainApiKey?.trim() || '';
  if (!keyToUse) {
    keyToUse = (await decryptLocalSecret(settings?.encryptedApiKey, settings?.apiKeyIv)) ?? '';
  }

  if (!keyToUse || keyToUse.length < 10) {
    return {
      ok: false,
      message: 'أدخل مفتاح Gemini API في الحقل أو احفظه أولاً لاختبار الاتصال.',
    };
  }

  const modelId = (
    overrideModelId ||
    settings?.geminiModelId ||
    DEFAULT_GEMINI_MODEL_ID
  ).trim();

  try {
    const reply = await callGeminiDirectFetch(keyToUse, modelId, {
      prompt: 'أجب بكلمة واحدة فقط: جاهز',
    });
    return {
      ok: true,
      message: `تم الاتصال المباشر بنجاح بالنموذج ${modelId} (الرد: ${reply.slice(0, 32)})`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'فشل الاتصال المباشر بـ Google API';
    return { ok: false, message: msg };
  }
}

export async function ingestWithStrictProtocol(rawText: string): Promise<{
  result: IngestionResult;
  usedFallbackNotice?: string;
}> {
  const creds = await getActiveCredentials();
  if (!creds) {
    return {
      result: runOfflineStrictIngestion(rawText),
      usedFallbackNotice: 'تم التنقيح عبر المحرك المحلي (بدون مفتاح API أو دون اتصال).',
    };
  }

  try {
    const jsonText = await callGeminiDirectFetch(creds.apiKey, creds.modelId, {
      prompt: `حلل المدخل التالي وفق البروتوكول الصارم:\n\n${rawText}`,
      systemInstruction:
        'أنت محرك تنقيح تنفيذي صارم باللغة العربية. يُمنع منعاً باتاً كتابة أي مقدمات ترحيبية أو شروحات مطولة أو إيموجيات. أخرج فقط نقاطاً تنفيذية مباشرة وحادة، واكتشف أي أخطاء منطقية أو تقنية أو زمنية بذكر المقطع الحرفي من النص الأصلي (originalSegment) وسبب مختصر جداً (reason) وتصحيح مباشر (suggestedFix)، بالإضافة إلى 3 أفكار إضافية عملية مختصرة للغاية.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          actionPoints: {
            type: 'ARRAY',
            items: { type: 'STRING' },
          },
          logicalErrors: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                originalSegment: { type: 'STRING' },
                reason: { type: 'STRING' },
                suggestedFix: { type: 'STRING' },
              },
              required: ['originalSegment', 'reason', 'suggestedFix'],
            },
          },
          extraIdeas: {
            type: 'ARRAY',
            items: { type: 'STRING' },
          },
        },
        required: ['actionPoints', 'logicalErrors', 'extraIdeas'],
      },
    });

    const parsed = JSON.parse(jsonText);
    const actionPoints: string[] = Array.isArray(parsed.actionPoints)
      ? parsed.actionPoints.map((x: unknown) => String(x).trim()).filter(Boolean)
      : [];
    const logicalErrors = Array.isArray(parsed.logicalErrors)
      ? parsed.logicalErrors
          .filter(
            (e: Record<string, unknown>) =>
              typeof e?.originalSegment === 'string' && e.originalSegment.trim().length > 0
          )
          .map((e: Record<string, unknown>) => ({
            id: generateId(),
            originalSegment: String(e.originalSegment).trim(),
            reason: String(e.reason ?? '').trim(),
            suggestedFix: String(e.suggestedFix ?? '').trim(),
          }))
      : [];
    const extraIdeas: string[] = Array.isArray(parsed.extraIdeas)
      ? parsed.extraIdeas.map((x: unknown) => String(x).trim()).filter(Boolean)
      : [];

    if (actionPoints.length === 0) {
      return {
        result: runOfflineStrictIngestion(rawText),
        usedFallbackNotice: 'استجابة غير مكتملة؛ تم التبديل للمحرك المحلي الاحتياطي.',
      };
    }

    return {
      result: {
        actionPoints,
        logicalErrors,
        extraIdeas,
        processingEngine: creds.modelId,
      },
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : '';
    return {
      result: runOfflineStrictIngestion(rawText),
      usedFallbackNotice: `تعذر الاتصال بـ ${creds.modelId} (${errMsg || 'خطأ شبكة'})؛ تم تفعيل المحرك المحلي تلقائياً.`,
    };
  }
}

export async function decomposeProjectPrecomputed(
  actionPoints: string[],
  rawInput: string
): Promise<{
  result: ProjectDecompositionResult;
  usedFallbackNotice?: string;
}> {
  const creds = await getActiveCredentials();
  if (!creds) {
    return {
      result: runOfflineProjectDecomposition(actionPoints, rawInput),
      usedFallbackNotice: 'تم تقسيم الخطوات مسبقاً عبر المحرك المحلي وتخزينها في IndexedDB.',
    };
  }

  try {
    const jsonText = await callGeminiDirectFetch(creds.apiKey, creds.modelId, {
      prompt: `حوّل النقاط التنفيذية التالية إلى مشروع مقسم مسبقاً إلى مهام رئيسية وخطوات فرعية دقيقة، بحيث تُقسم كل خطوة فرعية إلى 3 أجزاء متتالية (parts) تُعرض تدريجياً للمستخدم أثناء التنفيذ:\n\n${actionPoints
        .map((p, i) => `${i + 1}. ${p}`)
        .join('\n')}`,
      systemInstruction:
        'أنت مهندس تخطيط تنفيذي. بدون أي مقدمات أو إيموجيات. سمِّ المشروع بدقة، وقسّمه إلى 2-4 مهام رئيسية، وكل مهمة إلى خطوات فرعية (15 إلى 40 دقيقة لكل خطوة)، وكل خطوة فرعية يجب أن تحتوي على مصفوفة parts مكونة من 3 أجزاء تنفيذية قصيرة ومتدرجة تبدأ بأصغر خطوة ممكنة.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          projectTitle: { type: 'STRING' },
          objective: { type: 'STRING' },
          tasks: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                title: { type: 'STRING' },
                estimatedMinutes: { type: 'INTEGER' },
                microSteps: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      title: { type: 'STRING' },
                      durationMinutes: { type: 'INTEGER' },
                      parts: {
                        type: 'ARRAY',
                        items: { type: 'STRING' },
                      },
                    },
                    required: ['title', 'durationMinutes', 'parts'],
                  },
                },
              },
              required: ['title', 'estimatedMinutes', 'microSteps'],
            },
          },
        },
        required: ['projectTitle', 'objective', 'tasks'],
      },
    });

    const parsed = JSON.parse(jsonText);
    if (!parsed?.projectTitle || !Array.isArray(parsed?.tasks) || parsed.tasks.length === 0) {
      return {
        result: runOfflineProjectDecomposition(actionPoints, rawInput),
        usedFallbackNotice: 'تم التبديل للتقسيم المحلي الاحتياطي.',
      };
    }

    return {
      result: {
        projectTitle: String(parsed.projectTitle).trim(),
        objective: String(parsed.objective ?? '').trim(),
        tasks: parsed.tasks.map((t: Record<string, unknown>) => ({
          title: String(t.title ?? 'مهمة رئيسية').trim(),
          estimatedMinutes: Math.max(10, Number(t.estimatedMinutes) || 30),
          microSteps: Array.isArray(t.microSteps)
            ? t.microSteps.map((ms: Record<string, unknown>) => ({
                title: String(ms.title ?? 'خطوة فرعية').trim(),
                durationMinutes: Math.max(10, Math.min(60, Number(ms.durationMinutes) || 20)),
                parts:
                  Array.isArray(ms.parts) && ms.parts.length > 0
                    ? ms.parts.map((p: unknown) => String(p).trim()).filter(Boolean)
                    : [String(ms.title ?? 'تنفيذ الخطوة').trim()],
              }))
            : [],
        })),
        processingEngine: creds.modelId,
      },
    };
  } catch {
    return {
      result: runOfflineProjectDecomposition(actionPoints, rawInput),
      usedFallbackNotice: 'تم التقسيم المسبق عبر المحرك المحلي لعدم توفر استجابة من API.',
    };
  }
}

export async function parseScheduleCommitments(ocrText: string): Promise<{
  items: Array<{
    label: string;
    category: CommitmentCategory;
    daysOfWeek: number[];
    startTime: string;
    endTime: string;
  }>;
  engine: string;
}> {
  const creds = await getActiveCredentials();
  if (!creds) {
    return {
      items: parseScheduleTextOffline(ocrText),
      engine: 'offline-local',
    };
  }

  try {
    const jsonText = await callGeminiDirectFetch(creds.apiKey, creds.modelId, {
      prompt: `استخرج جميع الالتزامات الثابتة وأوقاتها من النص التالي (الناتج عن مسح جدول أو كتابة المستخدم):\n\n${ocrText}`,
      systemInstruction:
        'استخرج فقط الأوقات المشغولة بصيغة 24 ساعة (HH:MM) وأيام الأسبوع كأرقام (0 للأحد حتى 6 للسبت). بدون إيموجيات.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          commitments: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                label: { type: 'STRING' },
                category: { type: 'STRING' },
                daysOfWeek: {
                  type: 'ARRAY',
                  items: { type: 'INTEGER' },
                },
                startTime: { type: 'STRING' },
                endTime: { type: 'STRING' },
              },
              required: ['label', 'category', 'daysOfWeek', 'startTime', 'endTime'],
            },
          },
        },
        required: ['commitments'],
      },
    });

    const parsed = JSON.parse(jsonText);
    const validCategories: CommitmentCategory[] = ['work', 'study', 'sleep', 'personal', 'other'];
    const items = Array.isArray(parsed.commitments)
      ? parsed.commitments
          .filter((c: Record<string, unknown>) => c?.startTime && c?.endTime)
          .map((c: Record<string, unknown>) => ({
            label: String(c.label ?? 'التزام مجدول').trim(),
            category: validCategories.includes(c.category as CommitmentCategory)
              ? (c.category as CommitmentCategory)
              : 'other',
            daysOfWeek:
              Array.isArray(c.daysOfWeek) && c.daysOfWeek.length > 0
                ? c.daysOfWeek
                    .map(Number)
                    .filter((d: number) => !Number.isNaN(d) && d >= 0 && d <= 6)
                : [0, 1, 2, 3, 4],
            startTime: String(c.startTime).slice(0, 5),
            endTime: String(c.endTime).slice(0, 5),
          }))
      : [];

    if (items.length === 0) {
      return { items: parseScheduleTextOffline(ocrText), engine: 'offline-local' };
    }

    return { items, engine: creds.modelId };
  } catch {
    return { items: parseScheduleTextOffline(ocrText), engine: 'offline-local' };
  }
}

export async function generateProjectBlueprintSvg(
  projectTitle: string,
  taskTitles: string[]
): Promise<string> {
  const creds = await getActiveCredentials();
  if (!creds) {
    return buildOfflineBlueprintSvg(projectTitle, taskTitles);
  }

  try {
    const rawSvg = await callGeminiDirectFetch(creds.apiKey, creds.modelId, {
      prompt: `أنشئ كود SVG معماري نظيف (viewBox="0 0 640 240") يوضح مخطط تدفق المشروع "${projectTitle}" ومراحله: ${taskTitles.join(' -> ')}. استخدم خلفية #0F131A وشبكة هندسية دقيقة #1E2634 وألوان #3B82F6 و #F3F5F8. أعد عنصر <svg> صالح فقط دون علامات markdown.`,
      systemInstruction:
        'أعد كود SVG خام ونظيف يبدأ بـ <svg وينتهي بـ </svg> بدون أي نص قبله أو بعده وبدون scripts.',
    });
    const match = rawSvg.match(/<svg[\s\S]*<\/svg>/i);
    if (match && !/<script/i.test(match[0])) {
      return match[0];
    }
    return buildOfflineBlueprintSvg(projectTitle, taskTitles);
  } catch {
    return buildOfflineBlueprintSvg(projectTitle, taskTitles);
  }
}
