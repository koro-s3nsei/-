import React, { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  FolderPlus,
  Image as ImageIcon,
  Lightbulb,
  Loader2,
  Mic,
  MicOff,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { db, enqueueSyncChange } from '../../db/dexie';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { generateId, HORIZON_LABELS } from '../../lib/utils';
import {
  decomposeProjectPrecomputed,
  ingestWithStrictProtocol,
} from '../../services/geminiClient';
import { extractTextLocallyFromFile } from '../../services/ocrService';
import { allocateStepsAcrossFreeTime } from '../../services/schedulerEngine';
import type {
  CaptureRecord,
  CaptureSourceType,
  LogicalErrorSpan,
  MicroStepRecord,
  ProjectHorizon,
  ProjectRecord,
  TaskRecord,
} from '../../types/models';
import { Button, Input, Surface, Textarea } from '../ui/primitives';

interface CaptureViewProps {
  onProjectCreated: (projectId: string) => void;
}

const SAMPLE_RAW_INPUT = `أريد بناء واجهة متجر إلكتروني محلي وتصميم قاعدة البيانات وكتابة الاختبارات كلها في ساعة واحدة بالتوازي تماماً، وسأعمل 28 ساعة يومياً بدون نوم حتى أخلص، وربما أراجع التصميم لاحقاً بعدين.
تجهيز مخطط المنتجات والطلبات في IndexedDB.
بناء صفحة عرض المنتجات مع البحث والفلترة الفورية.
إضافة سلة المشتريات وحساب الإجمالي بدقة.`;

export const CaptureView: React.FC<CaptureViewProps> = ({ onProjectCreated }) => {
  const [rawInput, setRawInput] = useState('');
  const [sourceType, setSourceType] = useState<CaptureSourceType>('text');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<{ status: string; progress: number } | null>(
    null
  );
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Active refined draft state
  const [activeCaptureId, setActiveCaptureId] = useState<string | null>(null);
  const [actionPoints, setActionPoints] = useState<string[]>([]);
  const [logicalErrors, setLogicalErrors] = useState<LogicalErrorSpan[]>([]);
  const [extraIdeas, setExtraIdeas] = useState<string[]>([]);
  const [processingEngine, setProcessingEngine] = useState<string>('offline-local');
  const [openErrorId, setOpenErrorId] = useState<string | null>(null);
  const [showExtraIdeas, setShowExtraIdeas] = useState(false);
  const [newManualPoint, setNewManualPoint] = useState('');
  const [selectedHorizon, setSelectedHorizon] = useState<ProjectHorizon>('week');

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const recentCaptures = useLiveQuery(
    () => db.captures.orderBy('createdAt').reverse().limit(6).toArray(),
    []
  );

  const {
    isSupported: isSpeechSupported,
    isListening,
    interimText,
    error: speechError,
    startListening,
    stopListening,
  } = useSpeechRecognition((transcriptChunk) => {
    setSourceType('voice');
    setRawInput((prev) => (prev.trim() ? `${prev.trim()}\n${transcriptChunk}` : transcriptChunk));
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorBanner(null);
    setStatusNotice(null);

    const detectedSource: CaptureSourceType = file.type.startsWith('image/')
      ? 'image'
      : 'document';
    setSourceType(detectedSource);

    try {
      const extracted = await extractTextLocallyFromFile(file, (update) => {
        setOcrProgress(update);
      });
      if (!extracted) {
        setErrorBanner('لم يتم العثور على نص واضح داخل الملف. جرب صورة أوضح أو أضف النص يدوياً.');
      } else {
        setRawInput((prev) => (prev.trim() ? `${prev.trim()}\n\n${extracted}` : extracted));
        setStatusNotice(`تم استخراج النص محلياً من «${file.name}» بدون استهلاك أي حصة API.`);
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'فشل استخراج النص محلياً من الملف.');
    } finally {
      setTimeout(() => setOcrProgress(null), 900);
      e.target.value = '';
    }
  };

  const handleStrictAnalyze = async () => {
    const trimmed = rawInput.trim();
    if (!trimmed) {
      setErrorBanner('أدخل نصاً أو تسجيلاً صوتياً أو ارفع مستنداً أولاً.');
      return;
    }

    setErrorBanner(null);
    setStatusNotice(null);
    setIsAnalyzing(true);
    setOpenErrorId(null);
    setShowExtraIdeas(false);

    try {
      const { result, usedFallbackNotice } = await ingestWithStrictProtocol(trimmed);
      const captureId = generateId();
      const now = new Date().toISOString();

      const record: CaptureRecord = {
        id: captureId,
        sourceType,
        rawInput: trimmed,
        actionPoints: result.actionPoints,
        logicalErrors: result.logicalErrors,
        extraIdeas: result.extraIdeas,
        processingEngine: result.processingEngine,
        createdAt: now,
        updatedAt: now,
      };

      await db.captures.put(record);
      await enqueueSyncChange('captures', captureId, 'upsert', record);

      setActiveCaptureId(captureId);
      setActionPoints(result.actionPoints);
      setLogicalErrors(result.logicalErrors);
      setExtraIdeas(result.extraIdeas);
      setProcessingEngine(result.processingEngine);

      if (usedFallbackNotice) {
        setStatusNotice(usedFallbackNotice);
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'حدث خطأ أثناء التنقيح.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleApplyErrorFix = (errItem: LogicalErrorSpan) => {
    setRawInput((prev) => prev.replace(errItem.originalSegment, errItem.suggestedFix));
    setLogicalErrors((prev) => prev.filter((item) => item.id !== errItem.id));
    setOpenErrorId(null);
  };

  const handleAddManualPoint = () => {
    const val = newManualPoint.trim();
    if (!val) return;
    setActionPoints((prev) => [...prev, val]);
    setNewManualPoint('');
  };

  const handleAddIdeaAsPoint = (idea: string) => {
    if (!actionPoints.includes(idea)) {
      setActionPoints((prev) => [...prev, idea]);
    }
  };

  const handleApproveAndScheduleProject = async () => {
    const validPoints = actionPoints.map((p) => p.trim()).filter(Boolean);
    if (validPoints.length === 0) {
      setErrorBanner('أضف نقطة تنفيذية واحدة على الأقل قبل اعتماد المشروع.');
      return;
    }

    setIsApproving(true);
    setErrorBanner(null);

    try {
      const { result } = await decomposeProjectPrecomputed(validPoints, rawInput);
      const now = new Date().toISOString();
      const projectId = generateId();

      const tasksToSave: TaskRecord[] = [];
      const rawMicroSteps: MicroStepRecord[] = [];
      let globalOrder = 0;

      result.tasks.forEach((taskDraft, taskIdx) => {
        const taskId = generateId();
        tasksToSave.push({
          id: taskId,
          projectId,
          title: taskDraft.title,
          orderIndex: taskIdx,
          status: 'pending',
          estimatedMinutes: taskDraft.estimatedMinutes,
          createdAt: now,
          updatedAt: now,
        });

        taskDraft.microSteps.forEach((stepDraft) => {
          rawMicroSteps.push({
            id: generateId(),
            projectId,
            taskId,
            title: stepDraft.title,
            parts:
              stepDraft.parts.length > 0
                ? stepDraft.parts
                : [`ابدأ فوراً بتنفيذ: ${stepDraft.title}`],
            currentPartIndex: 0,
            orderIndex: globalOrder++,
            durationMinutes: stepDraft.durationMinutes,
            status: 'pending',
            createdAt: now,
            updatedAt: now,
          });
        });
      });

      const [commitments, existingScheduled] = await Promise.all([
        db.fixedCommitments.toArray(),
        db.microSteps.where('status').notEqual('completed').toArray(),
      ]);

      const scheduledSteps = allocateStepsAcrossFreeTime(
        rawMicroSteps,
        commitments,
        existingScheduled,
        selectedHorizon,
        new Date()
      );

      const totalEstimatedMinutes = scheduledSteps.reduce((acc, s) => acc + s.durationMinutes, 0);

      const newProject: ProjectRecord = {
        id: projectId,
        sourceCaptureId: activeCaptureId ?? undefined,
        title: result.projectTitle,
        objective: result.objective,
        horizon: selectedHorizon,
        status: 'active',
        totalEstimatedMinutes,
        completedStepsCount: 0,
        totalStepsCount: scheduledSteps.length,
        createdAt: now,
        updatedAt: now,
      };

      await db.transaction(
        'rw',
        [db.projects, db.tasks, db.microSteps, db.captures],
        async () => {
          await db.projects.add(newProject);
          await db.tasks.bulkAdd(tasksToSave);
          await db.microSteps.bulkAdd(scheduledSteps);
          if (activeCaptureId) {
            await db.captures.update(activeCaptureId, {
              convertedProjectId: projectId,
              updatedAt: now,
            });
          }
        }
      );

      await enqueueSyncChange('projects', projectId, 'upsert', newProject);
      onProjectCreated(projectId);
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'تعذر اعتماد المشروع وتقسيم خطواته في IndexedDB.'
      );
    } finally {
      setIsApproving(false);
    }
  };

  // Highlight logical errors inline inside the original raw text with toggleable icon button
  const annotatedSegments = useMemo(() => {
    if (!rawInput.trim() || logicalErrors.length === 0) return null;

    interface MatchSpan {
      start: number;
      end: number;
      error: LogicalErrorSpan;
    }

    const spans: MatchSpan[] = [];
    for (const err of logicalErrors) {
      const idx = rawInput.indexOf(err.originalSegment);
      if (idx !== -1) {
        spans.push({ start: idx, end: idx + err.originalSegment.length, error: err });
      }
    }

    if (spans.length === 0) return null;
    spans.sort((a, b) => a.start - b.start);

    // Filter overlapping spans
    const cleanSpans: MatchSpan[] = [];
    let lastEnd = 0;
    for (const sp of spans) {
      if (sp.start >= lastEnd) {
        cleanSpans.push(sp);
        lastEnd = sp.end;
      }
    }

    const parts: Array<{ type: 'text'; value: string } | { type: 'error'; error: LogicalErrorSpan }> =
      [];
    let cursor = 0;
    for (const sp of cleanSpans) {
      if (sp.start > cursor) {
        parts.push({ type: 'text', value: rawInput.slice(cursor, sp.start) });
      }
      parts.push({ type: 'error', error: sp.error });
      cursor = sp.end;
    }
    if (cursor < rawInput.length) {
      parts.push({ type: 'text', value: rawInput.slice(cursor) });
    }
    return parts;
  }, [rawInput, logicalErrors]);

  const loadPreviousCapture = (cap: CaptureRecord) => {
    setRawInput(cap.rawInput);
    setSourceType(cap.sourceType);
    setActiveCaptureId(cap.id);
    setActionPoints(cap.actionPoints);
    setLogicalErrors(cap.logicalErrors);
    setExtraIdeas(cap.extraIdeas);
    setProcessingEngine(cap.processingEngine);
    setOpenErrorId(null);
    setShowExtraIdeas(false);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">وحدة الاستيعاب والتنقيح الصارم</h1>
          <p className="mt-1 text-sm text-[#64748B] dark:text-[#94A3B8]">
            أدخل أفكارك نصاً أو صوتاً أو عبر صورة ومستند؛ يُحوّلها المحرك مباشرةً لنقاط تنفيذية حادة
            ويكشف الأخطاء المنطقية قبل التقسيم المسبق.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setRawInput(SAMPLE_RAW_INPUT);
            setSourceType('text');
            setErrorBanner(null);
          }}
        >
          <Wand2 className="h-4 w-4" strokeWidth={1.75} />
          <span>تعبئة مثال تجريبي</span>
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Input & Capture Panel */}
        <div className="space-y-4 lg:col-span-7">
          <Surface className="p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs text-[#64748B] dark:text-[#94A3B8]">
                <span>المصدر</span>
                <span aria-hidden="true">·</span>
                <span className="font-medium text-[#0F172A] dark:text-[#F3F5F8]">
                  {sourceType === 'text'
                    ? 'نص حر'
                    : sourceType === 'voice'
                      ? 'تسجيل صوتي محلي'
                      : sourceType === 'image'
                        ? 'صورة (OCR محلي)'
                        : 'مستند'}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.pdf,.txt,.md,.csv"
                  className="hidden"
                  onChange={handleFileUpload}
                />

                <Button
                  variant={isListening ? 'destructive' : 'secondary'}
                  size="sm"
                  onClick={isListening ? stopListening : startListening}
                  disabled={!isSpeechSupported}
                  title={
                    isSpeechSupported
                      ? 'تسجيل صوتي محلي عبر Web Speech API'
                      : 'التسجيل الصوتي غير مدعوم في هذا المتصفح'
                  }
                >
                  {isListening ? (
                    <MicOff className="h-4 w-4" strokeWidth={1.75} />
                  ) : (
                    <Mic className="h-4 w-4" strokeWidth={1.75} />
                  )}
                  <span>{isListening ? 'إيقاف الصوت' : 'إملاء صوتي'}</span>
                </Button>

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={Boolean(ocrProgress)}
                >
                  <ImageIcon className="h-4 w-4" strokeWidth={1.75} />
                  <span>مسح صورة / مستند</span>
                </Button>
              </div>
            </div>

            <Textarea
              rows={7}
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              placeholder="اكتب الفكرة أو المهام كما تخطر في بالك بدون ترتيب... أو استخدم الإملاء الصوتي أو مسح المستندات."
              className="resize-y"
            />

            {isListening && (
              <div className="mt-3 flex items-center justify-between rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-600 dark:text-red-400">
                <span>جاري الاستماع باللغة العربية عبر Web Speech API...</span>
                {interimText && <span className="truncate font-medium">{interimText}</span>}
              </div>
            )}

            {ocrProgress && (
              <div className="mt-3 space-y-1.5 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3 dark:border-[#232936] dark:bg-[#0E1116]">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2 font-medium">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" strokeWidth={1.75} />
                    {ocrProgress.status}
                  </span>
                  <span className="font-mono-tabular text-[#64748B]">{ocrProgress.progress}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#E2E8F0] dark:bg-[#1E2430]">
                  <div
                    className="h-full bg-blue-600 transition-all duration-150"
                    style={{ width: `${ocrProgress.progress}%` }}
                  />
                </div>
              </div>
            )}

            {(speechError || errorBanner) && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-600 dark:text-red-400">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
                <span>{speechError ?? errorBanner}</span>
              </div>
            )}

            {statusNotice && !errorBanner && (
              <div className="mt-3 text-xs text-[#64748B] dark:text-[#94A3B8]">{statusNotice}</div>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#E2E8F0] pt-4 dark:border-[#232936]">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setRawInput('');
                  setActionPoints([]);
                  setLogicalErrors([]);
                  setExtraIdeas([]);
                  setActiveCaptureId(null);
                  setStatusNotice(null);
                  setErrorBanner(null);
                }}
                disabled={!rawInput && actionPoints.length === 0}
              >
                <X className="h-4 w-4" strokeWidth={1.75} />
                <span>تفريغ</span>
              </Button>

              <Button
                variant="primary"
                onClick={handleStrictAnalyze}
                disabled={isAnalyzing || !rawInput.trim()}
              >
                {isAnalyzing ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                ) : (
                  <Sparkles className="h-4 w-4" strokeWidth={1.75} />
                )}
                <span>{isAnalyzing ? 'جاري التنقيح الصارم...' : 'تنقيح صارم وكشف الأخطاء'}</span>
              </Button>
            </div>
          </Surface>

          {/* Annotated Logical Errors View */}
          {logicalErrors.length > 0 && (
            <Surface className="p-5">
              <div className="flex items-center justify-between gap-2 border-b border-[#E2E8F0] pb-3 dark:border-[#232936]">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-red-500" strokeWidth={1.75} />
                  <h2 className="text-sm font-semibold">
                    كشف الأخطاء المنطقية والتقنية ({logicalErrors.length})
                  </h2>
                </div>
                <span className="text-xs text-[#64748B] dark:text-[#94A3B8]">
                  انقر أيقونة الخطأ لعرض التفسير وإخفائه
                </span>
              </div>

              {annotatedSegments ? (
                <div className="mt-4 text-sm leading-8 text-[#0F172A] dark:text-[#E2E8F0]">
                  {annotatedSegments.map((seg, idx) => {
                    if (seg.type === 'text') {
                      return (
                        <span key={`t-${idx}`} className="whitespace-pre-wrap">
                          {seg.value}
                        </span>
                      );
                    }
                    const isOpen = openErrorId === seg.error.id;
                    return (
                      <span key={seg.error.id} className="inline">
                        <span className="rounded bg-red-500/15 border-b-2 border-red-500 px-1 py-0.5 text-[#0F172A] dark:text-[#F8FAFC]">
                          {seg.error.originalSegment}
                        </span>
                        <button
                          type="button"
                          onClick={() => setOpenErrorId(isOpen ? null : seg.error.id)}
                          aria-expanded={isOpen}
                          aria-label="عرض أو إخفاء تفسير الخطأ المنطقي"
                          className="mx-1 inline-flex h-6 w-6 items-center justify-center rounded-md bg-red-500/15 text-red-600 hover:bg-red-500/25 dark:text-red-400 align-middle cursor-pointer"
                        >
                          <AlertCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
                        </button>
                      </span>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  {logicalErrors.map((err) => {
                    const isOpen = openErrorId === err.id;
                    return (
                      <div key={err.id} className="flex items-center gap-2 text-sm">
                        <span className="rounded bg-red-500/15 border-b-2 border-red-500 px-1.5 py-0.5">
                          {err.originalSegment}
                        </span>
                        <button
                          type="button"
                          onClick={() => setOpenErrorId(isOpen ? null : err.id)}
                          aria-label="تفسير الخطأ"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-red-500/15 text-red-600 hover:bg-red-500/25 dark:text-red-400 cursor-pointer"
                        >
                          <AlertCircle className="h-4 w-4" strokeWidth={1.75} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Compact toggled explanation box for selected error */}
              {openErrorId &&
                (() => {
                  const activeErr = logicalErrors.find((e) => e.id === openErrorId);
                  if (!activeErr) return null;
                  return (
                    <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/5 p-3.5 text-xs">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1.5">
                          <p className="font-semibold text-red-600 dark:text-red-400">
                            الخطأ: {activeErr.reason}
                          </p>
                          <p className="text-[#475569] dark:text-[#CBD5E1]">
                            التصحيح المقترح: {activeErr.suggestedFix}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setOpenErrorId(null)}
                          aria-label="إخفاء التفسير"
                          className="rounded-lg p-1 text-[#64748B] hover:bg-red-500/10"
                        >
                          <X className="h-4 w-4" strokeWidth={1.75} />
                        </button>
                      </div>
                      <div className="mt-3 flex justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleApplyErrorFix(activeErr)}
                        >
                          <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
                          <span>تطبيق التصحيح</span>
                        </Button>
                      </div>
                    </div>
                  );
                })()}
            </Surface>
          )}
        </div>

        {/* Strict Action Points & Pre-computation Approval Panel */}
        <div className="space-y-4 lg:col-span-5">
          <Surface className="p-5">
            <div className="flex items-center justify-between gap-2 border-b border-[#E2E8F0] pb-3 dark:border-[#232936]">
              <h2 className="text-sm font-semibold">النقاط التنفيذية المباشرة</h2>
              <span className="font-mono-tabular text-xs text-[#64748B] dark:text-[#94A3B8]">
                {actionPoints.length} نقطة ·{' '}
                {processingEngine === 'offline-local' ? 'محلي' : processingEngine}
              </span>
            </div>

            {actionPoints.length === 0 ? (
              <div className="py-10 text-center">
                <FileText
                  className="mx-auto h-8 w-8 text-[#94A3B8] dark:text-[#475569]"
                  strokeWidth={1.75}
                />
                <p className="mt-3 text-sm font-medium">لا توجد نقاط تنفيذية بعد</p>
                <p className="mt-1 text-xs text-[#64748B] dark:text-[#94A3B8]">
                  اضغط «تنقيح صارم» أو أضف النقاط يدوياً في الوضع المحلي أدناه.
                </p>
              </div>
            ) : (
              <ol className="mt-4 space-y-2.5">
                {actionPoints.map((point, index) => (
                  <li
                    key={`${index}-${point.slice(0, 12)}`}
                    className="flex items-start gap-2.5 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3 dark:border-[#232936] dark:bg-[#0E1116]"
                  >
                    <span className="font-mono-tabular mt-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <input
                      type="text"
                      value={point}
                      onChange={(e) => {
                        const updated = [...actionPoints];
                        updated[index] = e.target.value;
                        setActionPoints(updated);
                      }}
                      className="flex-1 bg-transparent text-sm text-[#0F172A] focus:outline-none dark:text-[#F3F5F8]"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setActionPoints((prev) => prev.filter((_, idx) => idx !== index))
                      }
                      aria-label="حذف النقطة"
                      className="text-[#94A3B8] hover:text-red-500 cursor-pointer"
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                  </li>
                ))}
              </ol>
            )}

            {/* Offline Manual Point Addition */}
            <div className="mt-4 flex gap-2">
              <Input
                value={newManualPoint}
                onChange={(e) => setNewManualPoint(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddManualPoint();
                  }
                }}
                placeholder="إضافة نقطة تنفيذية يدوياً (وضع محلي)..."
              />
              <Button variant="secondary" size="icon" onClick={handleAddManualPoint} aria-label="إضافة">
                <Plus className="h-4 w-4" strokeWidth={1.75} />
              </Button>
            </div>

            {/* Collapsed "أفكار إضافية" Independent Button */}
            {extraIdeas.length > 0 && (
              <div className="mt-4 border-t border-[#E2E8F0] pt-4 dark:border-[#232936]">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-between"
                  onClick={() => setShowExtraIdeas((prev) => !prev)}
                  aria-expanded={showExtraIdeas}
                >
                  <span className="flex items-center gap-2">
                    <Lightbulb className="h-4 w-4 text-blue-500" strokeWidth={1.75} />
                    <span>أفكار إضافية</span>
                  </span>
                  {showExtraIdeas ? (
                    <ChevronUp className="h-4 w-4" strokeWidth={1.75} />
                  ) : (
                    <ChevronDown className="h-4 w-4" strokeWidth={1.75} />
                  )}
                </Button>

                {showExtraIdeas && (
                  <ul className="mt-3 space-y-2">
                    {extraIdeas.map((idea, idx) => (
                      <li
                        key={idx}
                        className="flex items-center justify-between gap-2 rounded-xl border border-[#E2E8F0] px-3 py-2 text-xs text-[#475569] dark:border-[#232936] dark:text-[#CBD5E1]"
                      >
                        <span>{idea}</span>
                        <button
                          type="button"
                          onClick={() => handleAddIdeaAsPoint(idea)}
                          className="shrink-0 rounded-lg px-2 py-1 text-blue-600 hover:bg-blue-500/10 dark:text-blue-400 cursor-pointer"
                        >
                          إضافة
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Horizon + Approve & Pre-compute */}
            <div className="mt-5 space-y-3 border-t border-[#E2E8F0] pt-4 dark:border-[#232936]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[#64748B] dark:text-[#94A3B8]">
                  أفق توزيع الخطوات المسبقة
                </span>
                <div className="flex items-center gap-1 rounded-xl bg-[#EEF1F6] p-1 dark:bg-[#0E1116]">
                  {(['day', 'week', 'month', 'year'] as ProjectHorizon[]).map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setSelectedHorizon(h)}
                      className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                        selectedHorizon === h
                          ? 'bg-white text-[#0F172A] shadow-sm dark:bg-[#1E2430] dark:text-[#F3F5F8]'
                          : 'text-[#64748B] hover:text-[#0F172A] dark:text-[#94A3B8] dark:hover:text-[#F3F5F8]'
                      }`}
                    >
                      {HORIZON_LABELS[h]}
                    </button>
                  ))}
                </div>
              </div>

              <Button
                variant="primary"
                size="lg"
                className="w-full"
                onClick={handleApproveAndScheduleProject}
                disabled={isApproving || actionPoints.length === 0}
              >
                {isApproving ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                ) : (
                  <FolderPlus className="h-4 w-4" strokeWidth={1.75} />
                )}
                <span>
                  {isApproving
                    ? 'جاري التقسيم المسبق وحفظ IndexedDB...'
                    : 'اعتماد وتقسيم المشروع تلقائياً'}
                </span>
              </Button>
            </div>
          </Surface>

          {/* Local Captures History */}
          {recentCaptures && recentCaptures.length > 0 && (
            <Surface className="p-5">
              <h3 className="text-xs font-semibold text-[#64748B] dark:text-[#94A3B8]">
                مسودات الاستيعاب المحفوظة محلياً
              </h3>
              <div className="mt-3 divide-y divide-[#E2E8F0] dark:divide-[#232936]">
                {recentCaptures.map((cap) => (
                  <button
                    key={cap.id}
                    type="button"
                    onClick={() => loadPreviousCapture(cap)}
                    className="flex w-full items-center justify-between gap-3 py-2.5 text-right text-xs transition-colors hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer"
                  >
                    <span className="truncate font-medium">
                      {cap.actionPoints[0] ?? cap.rawInput.slice(0, 48)}
                    </span>
                    <span className="font-mono-tabular shrink-0 text-[#64748B] dark:text-[#94A3B8]">
                      {cap.actionPoints.length} نقاط
                    </span>
                  </button>
                ))}
              </div>
            </Surface>
          )}
        </div>
      </div>
    </div>
  );
};
