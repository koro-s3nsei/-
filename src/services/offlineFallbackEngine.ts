import type {
  CommitmentCategory,
  IngestionResult,
  LogicalErrorSpan,
  ProjectDecompositionResult,
} from '../types/models';
import { generateId } from '../lib/utils';

/**
 * Deterministic Offline Fallback Engine.
 * Works 100% locally with zero network dependency or API quota consumption.
 */

const CONTRADICTION_RULES: Array<{
  pattern: RegExp;
  reason: string;
  suggestedFix: string;
}> = [
  {
    pattern: /(?:25|26|27|28|30|40|48)\s*(?:ساعة|ساعات)\s*(?:في اليوم|يومياً|باليوم)?/gi,
    reason: 'تجاوز منطقي لساعات اليوم (اليوم 24 ساعة فقط ولا يمكن تخصيص أكثر من 14 ساعة عمل فعلي).',
    suggestedFix: 'عدّل المدة إلى 4-6 ساعات تنفيذ مركزة يومياً.',
  },
  {
    pattern: /(?:بدون\s*نوم|بلا\s*نوم|لن\s*أنام|ما\s*أنام)/gi,
    reason: 'خطأ في الاستدامة التشغيلية؛ إلغاء النوم يؤدي لانهيار التركيز خلال 24 ساعة.',
    suggestedFix: 'ثبّت نافذة نوم لا تقل عن 7 ساعات في جدول الالتزامات.',
  },
  {
    pattern: /(?:في\s*نفس\s*الوقت|بنفس\s*اللحظة|بالتوازي\s*تماماً)/gi,
    reason: 'تعارض تركيز؛ تنفيذ مهمتين معرفيتين في نفس اللحظة يخفض الجودة بنسبة 40%.',
    suggestedFix: 'افصل المهمتين إلى خطوتين متعاقبتين في نافذتي فراغ مختلفتين.',
  },
  {
    pattern: /(?:أمس|البارحة)\s*(?:سأبدأ|سأنجز|أنجز)/gi,
    reason: 'تضارب زمني؛ لا يمكن جدولة مهمة تنفيذية جديدة في تاريخ سابق.',
    suggestedFix: 'اضبط تاريخ البدء على اليوم أو أقرب نافذة فراغ متاحة.',
  },
  {
    pattern: /(?:كل\s*شيء|جميع\s*المهام|كامل\s*المشروع)\s*(?:في\s*ساعة|خلال\s*ساعة|اليوم\s*فقط|دفعة\s*واحدة)/gi,
    reason: 'تقدير زمني غير واقعي يؤدي للشلل والتسويف الفوري.',
    suggestedFix: 'قسّم النطاق إلى خطوات جزئية مدة كل منها 15 إلى 30 دقيقة.',
  },
  {
    pattern: /(?:سأحاول|ربما|إن\s*شاء\s*الله\s*لاحقاً|بعدين|وقت\s*ثاني)/gi,
    reason: 'صياغة غير ملزمة تفتح باب التسويف ولا تحدد إجراءً قابلاً للقياس.',
    suggestedFix: 'حوّل العبارة إلى فعل أمر تنفيذي محدد المدة والمخرجات.',
  },
];

function cleanLineToActionPoint(line: string): string {
  return line
    .replace(/^[-•*0-9.)\s]+/, '')
    .replace(/^(أريد أن|أبغى|أحتاج أن|لازم|سأحاول أن|أفكر في)\s+/i, '')
    .trim();
}

export function runOfflineStrictIngestion(rawText: string): IngestionResult {
  const normalized = rawText.trim();
  const logicalErrors: LogicalErrorSpan[] = [];
  const seenSegments = new Set<string>();

  for (const rule of CONTRADICTION_RULES) {
    const matches = normalized.match(rule.pattern);
    if (matches) {
      for (const m of matches) {
        const key = m.trim();
        if (!key || seenSegments.has(key)) continue;
        seenSegments.add(key);
        logicalErrors.push({
          id: generateId(),
          originalSegment: key,
          reason: rule.reason,
          suggestedFix: rule.suggestedFix,
        });
      }
    }
  }

  // Split raw text into direct actionable sentences
  const rawSegments = normalized
    .split(/[\n.!؟؛،]+/)
    .map(cleanLineToActionPoint)
    .filter((s) => s.length >= 4);

  const actionPoints =
    rawSegments.length > 0
      ? rawSegments.slice(0, 10)
      : [normalized.length > 0 ? normalized : 'تحديد المخرج التنفيذي الأول للمهمة'];

  const extraIdeas = [
    'تحديد معيار انتهاء رقمي واضح لكل خطوة قبل بدء المؤقت.',
    'تجميع الأدوات والملفات المطلوبة في مجلد واحد قبل أول نافذة فراغ.',
    'تخصيص 10 دقائق مراجعة في نهاية اليوم لتحديث حالة الخطوات المنجزة.',
  ];

  return {
    actionPoints,
    logicalErrors,
    extraIdeas,
    processingEngine: 'offline-local',
  };
}

export function runOfflineProjectDecomposition(
  actionPoints: string[],
  rawTitleHint?: string
): ProjectDecompositionResult {
  const cleanPoints = actionPoints.filter((p) => p.trim().length > 0);
  const firstPoint = cleanPoints[0] ?? rawTitleHint ?? 'مشروع تنفيذي جديد';
  const projectTitle =
    firstPoint.length > 48 ? `${firstPoint.slice(0, 48).trim()}...` : firstPoint;

  // Group points into 1 to 3 logical parent tasks
  const chunkSize = Math.max(1, Math.ceil(cleanPoints.length / Math.min(3, Math.max(1, cleanPoints.length))));
  const tasks: ProjectDecompositionResult['tasks'] = [];

  for (let i = 0; i < cleanPoints.length; i += chunkSize) {
    const slice = cleanPoints.slice(i, i + chunkSize);
    const taskIndex = tasks.length + 1;

    const microSteps = slice.map((point) => {
      const durationMinutes = point.length > 70 ? 30 : 20;
      return {
        title: point,
        durationMinutes,
        parts: [
          `التهيئة السريعة (3 دقائق): افتح بيئة العمل المطلوبة لتنفيذ «${point}» وأغلق جميع النوافذ المشتتة.`,
          `التنفيذ الجوهري: أنجز المسودة الأولى المباشرة لـ «${point}» دون توقف للتعديل المبكر.`,
          `التحقق والإغلاق: راجع المخرج النهائي لـ «${point}» واحفظ النتيجة قبل الانتقال للخطوة التالية.`,
        ],
      };
    });

    tasks.push({
      title:
        taskIndex === 1
          ? 'المرحلة الأولى: التأسيس والتنفيذ المباشر'
          : taskIndex === 2
            ? 'المرحلة الثانية: البناء والتكامل'
            : `المرحلة ${taskIndex}: المراجعة والإتمام`,
      estimatedMinutes: microSteps.reduce((sum, m) => sum + m.durationMinutes, 0),
      microSteps,
    });
  }

  return {
    projectTitle,
    objective: `تنفيذ ${cleanPoints.length} نقاط عمل محددة عبر خطوات جزئية مقسمة مسبقاً.`,
    tasks,
    processingEngine: 'offline-local',
  };
}

export function parseScheduleTextOffline(ocrOrRawText: string): Array<{
  label: string;
  category: CommitmentCategory;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
}> {
  const lines = ocrOrRawText
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const timeRangeRegex = /(\d{1,2})[:.](\d{2})\s*(?:-|–|إلى|الى|to|حتى)\s*(\d{1,2})[:.](\d{2})/i;
  const extracted: Array<{
    label: string;
    category: CommitmentCategory;
    daysOfWeek: number[];
    startTime: string;
    endTime: string;
  }> = [];

  for (const line of lines) {
    const match = line.match(timeRangeRegex);
    if (!match) continue;
    const sh = String(Math.min(23, parseInt(match[1], 10))).padStart(2, '0');
    const sm = String(Math.min(59, parseInt(match[2], 10))).padStart(2, '0');
    const eh = String(Math.min(23, parseInt(match[3], 10))).padStart(2, '0');
    const em = String(Math.min(59, parseInt(match[4], 10))).padStart(2, '0');

    const cleanedLabel = line.replace(timeRangeRegex, '').replace(/[-:|]/g, ' ').trim();
    const label = cleanedLabel.length >= 2 ? cleanedLabel.slice(0, 40) : 'التزام مستخرج من الجدول';

    let category: CommitmentCategory = 'other';
    if (/نوم|sleep/i.test(label)) category = 'sleep';
    else if (/دوام|عمل|شغل|اجتماع|work/i.test(label)) category = 'work';
    else if (/محاضرة|جامعة|دراسة|كورس|مذاكرة|class|lecture/i.test(label)) category = 'study';
    else if (/رياضة|غداء|عائلة|شخصي/i.test(label)) category = 'personal';

    const daysOfWeek: number[] = [];
    if (/الأحد|الاحد|sun/i.test(line)) daysOfWeek.push(0);
    if (/الإثنين|الاثنين|mon/i.test(line)) daysOfWeek.push(1);
    if (/الثلاثاء|tue/i.test(line)) daysOfWeek.push(2);
    if (/الأربعاء|الاربعاء|wed/i.test(line)) daysOfWeek.push(3);
    if (/الخميس|thu/i.test(line)) daysOfWeek.push(4);
    if (/الجمعة|fri/i.test(line)) daysOfWeek.push(5);
    if (/السبت|sat/i.test(line)) daysOfWeek.push(6);

    extracted.push({
      label,
      category,
      daysOfWeek: daysOfWeek.length > 0 ? daysOfWeek : [0, 1, 2, 3, 4],
      startTime: `${sh}:${sm}`,
      endTime: `${eh}:${em}`,
    });
  }

  return extracted;
}

/**
 * Generates a crisp architectural blueprint SVG illustration on demand (works 100% offline).
 */
export function buildOfflineBlueprintSvg(projectTitle: string, taskTitles: string[]): string {
  const safeTitle = projectTitle.replace(/[<>&"']/g, '').slice(0, 34);
  const nodes = taskTitles.slice(0, 3).map((t) => t.replace(/[<>&"']/g, '').slice(0, 26));
  while (nodes.length < 3) {
    nodes.push(`مرحلة تنفيذ ${nodes.length + 1}`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 240" fill="none">
  <rect width="640" height="240" rx="12" fill="#0F131A"/>
  <path d="M0 40H640M0 80H640M0 120H640M0 160H640M0 200H640M80 0V240M160 0V240M240 0V240M320 0V240M400 0V240M480 0V240M560 0V240" stroke="#1E2634" stroke-width="1"/>
  <rect x="24" y="20" width="592" height="44" rx="8" fill="#151B26" stroke="#2D3A4F" stroke-width="1.2"/>
  <text x="596" y="47" text-anchor="end" fill="#F3F5F8" font-family="IBM Plex Sans Arabic, sans-serif" font-size="14" font-weight="600">${safeTitle}</text>
  <line x1="210" y1="148" x2="248" y2="148" stroke="#3B82F6" stroke-width="2" stroke-dasharray="4 4"/>
  <line x1="418" y1="148" x2="456" y2="148" stroke="#3B82F6" stroke-width="2" stroke-dasharray="4 4"/>
  <rect x="444" y="102" width="172" height="94" rx="8" fill="#151B26" stroke="#3B82F6" stroke-width="1.5"/>
  <text x="600" y="128" text-anchor="end" fill="#60A5FA" font-family="JetBrains Mono, monospace" font-size="11">STEP 01</text>
  <text x="600" y="156" text-anchor="end" fill="#E2E8F0" font-family="IBM Plex Sans Arabic, sans-serif" font-size="12">${nodes[0]}</text>
  <rect x="234" y="102" width="172" height="94" rx="8" fill="#151B26" stroke="#334155" stroke-width="1.5"/>
  <text x="390" y="128" text-anchor="end" fill="#94A3B8" font-family="JetBrains Mono, monospace" font-size="11">STEP 02</text>
  <text x="390" y="156" text-anchor="end" fill="#E2E8F0" font-family="IBM Plex Sans Arabic, sans-serif" font-size="12">${nodes[1]}</text>
  <rect x="24" y="102" width="172" height="94" rx="8" fill="#151B26" stroke="#16A34A" stroke-width="1.5"/>
  <text x="180" y="128" text-anchor="end" fill="#4ADE80" font-family="JetBrains Mono, monospace" font-size="11">STEP 03</text>
  <text x="180" y="156" text-anchor="end" fill="#E2E8F0" font-family="IBM Plex Sans Arabic, sans-serif" font-size="12">${nodes[2]}</text>
</svg>`;
}
