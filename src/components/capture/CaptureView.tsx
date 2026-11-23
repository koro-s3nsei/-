import React, { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertCircle,
  BookOpen,
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
  Save,
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
import { OriginalTextModal } from '../notes/OriginalTextModal';
import { ErrorActionBanner } from '../ui/ErrorActionBanner';
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
  const [errorState, setErrorState] = useState<{
    message: string;
    fixLabel?: string;
    onFix?: () => void;
  } | null>(null);

  const [activeCaptureId, setActiveCaptureId] = useState<string | null>(null);
  const [actionPoints, setActionPoints] = useState<string[]>([]);
  const [logicalErrors, setLogicalErrors] = useState<LogicalErrorSpan[]>([]);
  const [extraIdeas, setExtraIdeas] = useState<string[]>([]);
  const [processingEngine, setProcessingEngine] = useState<string>('offline-local');
  const [openErrorId, setOpenErrorId] = useState<string | null>(null);
  const [showExtraIdeas, setShowExtraIdeas] = useState(false);
  const [newManualPoint, setNewManualPoint] = useState('');
  const [selectedHorizon, setSelectedHorizon] = useState<ProjectHorizon>('week');
  const [viewingNoteId, setViewingNoteId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const recentCaptures = useLiveQuery(
    () => db.captures.orderBy('createdAt').reverse().limit(6).toArray(),
    []
  );

  const {
    isListening,
    interimText,
    error: speechError,
    clearError: clearSpeechError,
    startListening,
    stopListening,
  } = useSpeechRecognition((transcriptChunk) => {
    setSourceType('voice');
    setRawInput((prev) => (prev.trim() ? `${prev.trim()}\n${transcriptChunk}` : transcriptChunk));
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorState(null);
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
        setErrorState({
          message: 'لم يُعثر على نص واضح داخل الملف.',
          fixLabel: 'تطبيق الإصلاح',
          onFix: () => {
            setErrorState(null);
            fileInputRef.current?.click();
          },
        });
      } else {
        setRawInput((prev) => (prev.trim() ? `${prev.trim()}\n\n${extracted}` : extracted));
        setStatusNotice(`تم استخراج النص من «${file.name}».`);
      }
    } catch (err) {
      setErrorState({
        message: err instanceof Error ? err.message : 'تعذر قراءة الملف محلياً.',
        fixLabel: 'تطبيق الإصلاح',
        onFix: () => {
          setErrorState(null);
          fileInputRef.current?.click();
        },
      });
    } finally {
      setTimeout(() => setOcrProgress(null), 900);
      e.target.value = '';
    }
  };

  // Save verbatim original text as a standalone note (without splitting into tasks) and open its separate window
  const handleSaveOriginalNoteOnly = async () => {
    const trimmed = rawInput.trim();
    if (!trimmed) {
      setErrorState({
        message: 'اكتب أو أمْلِ نصاً أولاً لحفظه كما هو.',
        fixLabel: 'تطبيق الإصلاح',
        onFix: () => {
          setErrorState(null);
          setRawInput(SAMPLE_RAW_INPUT);
        },
      });
      return;
    }

    setErrorState(null);
    const now = new Date().toISOString();
    const captureId = activeCaptureId ?? generateId();
    const existing = activeCaptureId ? await db.captures.get(activeCaptureId) : undefined;

    const record: CaptureRecord = {
      id: captureId,
      sourceType,
      rawInput: trimmed,
      actionPoints,
      logicalErrors,
      extraIdeas,
      processingEngine,
      convertedProjectId: existing?.convertedProjectId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    try {
      await db.captures.put(record);
      await enqueueSyncChange('captures', captureId, 'upsert', record);
      setActiveCaptureId(captureId);
      setStatusNotice('تم حفظ النص الأصلي كما هو دون تقسيم.');
      setViewingNoteId(captureId);
    } catch (err) {
      setErrorState({
        message: err instanceof Error ? err.message : 'تعذر حفظ النص الأصلي محلياً.',
        fixLabel: 'تطبيق الإصلاح',
        onFix: () => {
          setErrorState(null);
          void handleSaveOriginalNoteOnly();
        },
      });
    }
  };

  const handleStrictAnalyze = async () => {
    const trimmed = rawInput.trim();
    if (!trimmed) {
      setErrorState({
        message: 'أدخل نصاً أو تسجيلاً صوتياً أولاً.',
        fixLabel: 'تطبيق الإصلاح',
        onFix: () => {
          setErrorState(null);
          setRawInput(SAMPLE_RAW_INPUT);
        },
      });
      return;
    }

    setErrorState(null);
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
      setErrorState({
        message: err instanceof Error ? err.message : 'حدث خطأ أثناء التنقيح.',
        fixLabel: 'تطبيق الإصلاح',
        onFix: () => {
          setErrorState(null);
          void handleStrictAnalyze();
        },
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const syncCaptureEdits = async (
    nextText: string,
    nextErrors: LogicalErrorSpan[],
    nextIdeas = extraIdeas
  ) => {
    if (!activeCaptureId) return;
    const existing = await db.captures.get(activeCaptureId);
    if (!existing) return;
    const updated: CaptureRecord = {
      ...existing,
      rawInput: nextText,
      logicalErrors: nextErrors,
      extraIdeas: nextIdeas,
      updatedAt: new Date().toISOString(),
    };
    await db.captures.put(updated);
    await enqueueSyncChange('captures', activeCaptureId, 'upsert', updated);
  };

  const handleApplyErrorFix = (errItem: LogicalErrorSpan) => {
    const nextText = rawInput.replace(errItem.originalSegment, errItem.suggestedFix);
    const nextErrors = logicalErrors.filter((item) => item.id !== errItem.id);
    setRawInput(nextText);
    setLogicalErrors(nextErrors);
    setOpenErrorId(null);
    void syncCaptureEdits(nextText, nextErrors);
  };

  const handleIgnoreLogicalError = (errId: string) => {
    const nextErrors = logicalErrors.filter((item) => item.id !== errId);
    setLogicalErrors(nextErrors);
    setOpenErrorId(null);
    void syncCaptureEdits(rawInput, nextErrors);
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
      setErrorState({
        message: 'أضف نقطة تنفيذية واحدة على الأقل قبل الاعتماد.',
        fixLabel: 'تطبيق الإصلاح',
        onFix: () => {
          setErrorState(null);
          if (rawInput.trim()) {
            void handleStrictAnalyze();
          }
        },
      });
      return;
    }

    setIsApproving(true);
    setErrorState(null);

    try {
      const { result } = await decomposeProjectPrecomputed(validPoints, rawInput);
      const now = new Date().toISOString();
      const projectId = generateId();

      // Always keep the verbatim original text saved alongside the created project
      let linkedCaptureId = activeCaptureId;
      if (!linkedCaptureId && rawInput.trim()) {
        linkedCaptureId = generateId();
        const fallbackCapture: CaptureRecord = {
          id: linkedCaptureId,
          sourceType,
          rawInput: rawInput.trim(),
          actionPoints: validPoints,
          logicalErrors,
          extraIdeas,
          processingEngine,
          convertedProjectId: projectId,
          createdAt: now,
          updatedAt: now,
        };
        await db.captures.put(fallbackCapture);
        await enqueueSyncChange('captures', linkedCaptureId, 'upsert', fallbackCapture);
      }

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
                : [`ابدأ بتنفيذ: ${stepDraft.title}`],
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
        sourceCaptureId: linkedCaptureId ?? undefined,
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
          if (linkedCaptureId) {
            await db.captures.update(linkedCaptureId, {
              rawInput: rawInput.trim() || validPoints.join('\n'),
              logicalErrors,
              extraIdeas,
              convertedProjectId: projectId,
              updatedAt: now,
            });
          }
        }
      );

      await enqueueSyncChange('projects', projectId, 'upsert', newProject);
      onProjectCreated(projectId);
    } catch (err) {
      setErrorState({
        message: err instanceof Error ? err.message : 'تعذر اعتماد المشروع محلياً.',
        fixLabel: 'تطبيق الإصلاح',
        onFix: () => {
          setErrorState(null);
          void handleApproveAndScheduleProject();
        },
      });
    } finally {
      setIsApproving(false);
    }
  };

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
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">الاستيعاب والتنقيح</h1>

        <div className="flex flex-wrap items-center gap-2">
          {activeCaptureId && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setViewingNoteId(activeCaptureId)}
            >
              <BookOpen className="h-4 w-4" strokeWidth={1.75} />
              <span>نافذة النص الأصلي</span>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setRawInput(SAMPLE_RAW_INPUT);
              setSourceType('text');
              setErrorState(null);
            }}
          >
            <Wand2 className="h-4 w-4" strokeWidth={1.75} />
            <span>مثال تجريبي</span>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Input & Capture Panel */}
        <div className="space-y-4 lg:col-span-7">
          <Surface className="p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                {sourceType === 'text'
                  ? 'نص'
                  : sourceType === 'voice'
                    ? 'صوت'
                    : sourceType === 'image'
                      ? 'صورة'
                      : 'مستند'}
              </span>

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
                  onClick={() => {
                    if (isListening) {
                      void stopListening();
                    } else {
                      void startListening();
                    }
                  }}
                >
                  {isListening ? (
                    <MicOff className="h-4 w-4" strokeWidth={1.75} />
                  ) : (
                    <Mic className="h-4 w-4" strokeWidth={1.75} />
                  )}
                  <span>{isListening ? 'إيقاف' : 'إملاء صوتي'}</span>
                </Button>

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={Boolean(ocrProgress)}
                >
                  <ImageIcon className="h-4 w-4" strokeWidth={1.75} />
                  <span>صورة / ملف</span>
                </Button>
              </div>
            </div>

            <Textarea
              rows={7}
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              placeholder="اكتب الفكرة أو المهام..."
              className="resize-y"
            />

            {isListening && (
              <div className="mt-3 flex items-center justify-between rounded-xl border border-red-500/25 bg-red-500/8 px-3.5 py-2.5 text-xs text-red-600 dark:text-red-400">
                <span>جاري الاستماع...</span>
                {interimText && <span className="truncate font-medium">{interimText}</span>}
              </div>
            )}

            {ocrProgress && (
              <div className="mt-3 space-y-1.5 rounded-xl border border-[#E5E7EB] bg-[#FAFAFA] p-3 dark:border-[#222630] dark:bg-[#0E1015]">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2 font-medium">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" strokeWidth={1.75} />
                    {ocrProgress.status}
                  </span>
                  <span className="font-mono-tabular text-[#6B7280]">{ocrProgress.progress}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#E5E7EB] dark:bg-[#1E222D]">
                  <div
                    className="h-full bg-blue-600 transition-all duration-150"
                    style={{ width: `${ocrProgress.progress}%` }}
                  />
                </div>
              </div>
            )}

            {speechError && (
              <div className="mt-3">
                <ErrorActionBanner
                  message={speechError}
                  fixLabel="تطبيق الإصلاح"
                  onApplyFix={() => {
                    clearSpeechError();
                    void startListening();
                  }}
                  onIgnore={clearSpeechError}
                />
              </div>
            )}

            {errorState && (
              <div className="mt-3">
                <ErrorActionBanner
                  message={errorState.message}
                  fixLabel={errorState.fixLabel ?? 'تطبيق الإصلاح'}
                  onApplyFix={errorState.onFix}
                  onIgnore={() => setErrorState(null)}
                />
              </div>
            )}

            {statusNotice && !errorState && (
              <p className="mt-3 text-xs text-[#6B7280] dark:text-[#9CA3AF]">{statusNotice}</p>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#E5E7EB] pt-4 dark:border-[#222630]">
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
                  setErrorState(null);
                }}
                disabled={!rawInput && actionPoints.length === 0}
              >
                <X className="h-4 w-4" strokeWidth={1.75} />
                <span>مسح</span>
              </Button>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleSaveOriginalNoteOnly()}
                  disabled={!rawInput.trim()}
                  title="حفظ ما كتبته نصاً في نافذة مستقلة دون تقسيمه لمهام"
                >
                  <Save className="h-4 w-4" strokeWidth={1.75} />
                  <span>حفظ النص كما هو</span>
                </Button>

                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void handleStrictAnalyze()}
                  disabled={isAnalyzing || !rawInput.trim()}
                >
                  {isAnalyzing ? (
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                  ) : (
                    <Sparkles className="h-4 w-4" strokeWidth={1.75} />
                  )}
                  <span>{isAnalyzing ? 'جاري التنقيح...' : 'تنقيح وكشف الأخطاء'}</span>
                </Button>
              </div>
            </div>
          </Surface>

          {/* Annotated Logical Errors View (Non-blocking with Two Clear Choices) */}
          {logicalErrors.length > 0 && (
            <Surface className="p-5">
              <div className="flex items-center justify-between gap-2 border-b border-[#E5E7EB] pb-3 dark:border-[#222630]">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-red-500" strokeWidth={1.75} />
                  <h2 className="text-sm font-semibold">
                    ملاحظات منطقية اختيارية ({logicalErrors.length})
                  </h2>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setLogicalErrors([]);
                    setOpenErrorId(null);
                    void syncCaptureEdits(rawInput, []);
                  }}
                >
                  <span>تجاهل الكل</span>
                </Button>
              </div>

              {annotatedSegments ? (
                <div className="mt-4 text-sm leading-8 text-[#111318] dark:text-[#E5E7EB]">
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
                        <span className="rounded border-b-2 border-red-500 bg-red-500/12 px-1 py-0.5 text-[#111318] dark:text-[#F4F5F7]">
                          {seg.error.originalSegment}
                        </span>
                        <button
                          type="button"
                          onClick={() => setOpenErrorId(isOpen ? null : seg.error.id)}
                          aria-expanded={isOpen}
                          aria-label="عرض أو إخفاء الملاحظة"
                          className="mx-1 inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md bg-red-500/12 align-middle text-red-600 hover:bg-red-500/20 dark:text-red-400"
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
                        <span className="rounded border-b-2 border-red-500 bg-red-500/12 px-1.5 py-0.5">
                          {err.originalSegment}
                        </span>
                        <button
                          type="button"
                          onClick={() => setOpenErrorId(isOpen ? null : err.id)}
                          aria-label="عرض الملاحظة"
                          className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md bg-red-500/12 text-red-600 hover:bg-red-500/20 dark:text-red-400"
                        >
                          <AlertCircle className="h-4 w-4" strokeWidth={1.75} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {openErrorId &&
                (() => {
                  const activeErr = logicalErrors.find((e) => e.id === openErrorId);
                  if (!activeErr) return null;
                  return (
                    <div className="mt-4 rounded-xl border border-red-500/25 bg-red-500/5 p-3.5 text-xs">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1.5">
                          <p className="font-semibold text-red-600 dark:text-red-400">
                            {activeErr.reason}
                          </p>
                          <p className="text-[#4B5563] dark:text-[#D1D5DB]">
                            المقترح: {activeErr.suggestedFix}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setOpenErrorId(null)}
                          aria-label="إغلاق"
                          className="cursor-pointer rounded-lg p-1 text-[#6B7280] hover:bg-red-500/10"
                        >
                          <X className="h-4 w-4" strokeWidth={1.75} />
                        </button>
                      </div>
                      <div className="mt-3 flex flex-wrap justify-end gap-2">
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleApplyErrorFix(activeErr)}
                        >
                          <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
                          <span>تطبيق الإصلاح</span>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleIgnoreLogicalError(activeErr.id)}
                        >
                          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                          <span>تجاهل والاستمرار كما هو</span>
                        </Button>
                      </div>
                    </div>
                  );
                })()}
            </Surface>
          )}
        </div>

        {/* Action Points & Approval Panel */}
        <div className="space-y-4 lg:col-span-5">
          <Surface className="p-5">
            <div className="flex items-center justify-between gap-2 border-b border-[#E5E7EB] pb-3 dark:border-[#222630]">
              <h2 className="text-sm font-semibold">النقاط التنفيذية</h2>
              <span className="font-mono-tabular text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                {actionPoints.length} ·{' '}
                {processingEngine === 'offline-local' ? 'محلي' : processingEngine}
              </span>
            </div>

            {actionPoints.length === 0 ? (
              <div className="py-10 text-center">
                <FileText
                  className="mx-auto h-7 w-7 text-[#9CA3AF] dark:text-[#4B5563]"
                  strokeWidth={1.75}
                />
                <p className="mt-2.5 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                  أضف نقاطاً يدوياً أو اضغط «تنقيح».
                </p>
              </div>
            ) : (
              <ol className="mt-4 space-y-2">
                {actionPoints.map((point, index) => (
                  <li
                    key={`${index}-${point.slice(0, 12)}`}
                    className="flex items-start gap-2.5 rounded-xl border border-[#E5E7EB] bg-[#FAFAFA] p-3 dark:border-[#222630] dark:bg-[#0E1015]"
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
                      className="flex-1 bg-transparent text-sm text-[#111318] focus:outline-none dark:text-[#F4F5F7]"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setActionPoints((prev) => prev.filter((_, idx) => idx !== index))
                      }
                      aria-label="حذف النقطة"
                      className="cursor-pointer text-[#9CA3AF] hover:text-red-500"
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                  </li>
                ))}
              </ol>
            )}

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
                placeholder="إضافة نقطة..."
              />
              <Button
                variant="secondary"
                size="icon"
                onClick={handleAddManualPoint}
                aria-label="إضافة"
              >
                <Plus className="h-4 w-4" strokeWidth={1.75} />
              </Button>
            </div>

            {extraIdeas.length > 0 && (
              <div className="mt-4 border-t border-[#E5E7EB] pt-4 dark:border-[#222630]">
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
                        className="flex items-center justify-between gap-2 rounded-xl border border-[#E5E7EB] px-3 py-2 text-xs text-[#4B5563] dark:border-[#222630] dark:text-[#D1D5DB]"
                      >
                        <span>{idea}</span>
                        <button
                          type="button"
                          onClick={() => handleAddIdeaAsPoint(idea)}
                          className="shrink-0 cursor-pointer rounded-lg px-2 py-1 text-blue-600 hover:bg-blue-500/10 dark:text-blue-400"
                        >
                          إضافة
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="mt-5 space-y-3 border-t border-[#E5E7EB] pt-4 dark:border-[#222630]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[#6B7280] dark:text-[#9CA3AF]">
                  أفق الجدولة
                </span>
                <div className="flex items-center gap-1 rounded-xl bg-[#F3F4F6] p-1 dark:bg-[#0E1015]">
                  {(['day', 'week', 'month', 'year'] as ProjectHorizon[]).map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setSelectedHorizon(h)}
                      className={`cursor-pointer rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                        selectedHorizon === h
                          ? 'bg-white text-[#111318] shadow-sm dark:bg-[#1E222D] dark:text-[#F4F5F7]'
                          : 'text-[#6B7280] hover:text-[#111318] dark:text-[#9CA3AF] dark:hover:text-[#F4F5F7]'
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
                onClick={() => void handleApproveAndScheduleProject()}
                disabled={isApproving || actionPoints.length === 0}
              >
                {isApproving ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                ) : (
                  <FolderPlus className="h-4 w-4" strokeWidth={1.75} />
                )}
                <span>{isApproving ? 'جاري التقسيم...' : 'اعتماد المشروع'}</span>
              </Button>
            </div>
          </Surface>

          {/* Saved Verbatim Original Captures */}
          {recentCaptures && recentCaptures.length > 0 && (
            <Surface className="p-5">
              <h3 className="text-xs font-semibold text-[#6B7280] dark:text-[#9CA3AF]">
                النصوص الأصلية المحفوظة
              </h3>
              <div className="mt-3 divide-y divide-[#E5E7EB] dark:divide-[#222630]">
                {recentCaptures.map((cap) => (
                  <div
                    key={cap.id}
                    className="flex items-center justify-between gap-2 py-2.5 text-xs"
                  >
                    <button
                      type="button"
                      onClick={() => loadPreviousCapture(cap)}
                      className="min-w-0 flex-1 cursor-pointer truncate text-right font-medium transition-colors hover:text-blue-600 dark:hover:text-blue-400"
                    >
                      {cap.rawInput.split('\n')[0]?.slice(0, 56) || cap.actionPoints[0]}
                    </button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setViewingNoteId(cap.id)}
                      title="فتح النص الأصلي في نافذة مستقلة"
                    >
                      <BookOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
                      <span>فتح</span>
                    </Button>
                  </div>
                ))}
              </div>
            </Surface>
          )}
        </div>
      </div>

      {/* Standalone Verbatim Original Text Modal */}
      {viewingNoteId && (
        <OriginalTextModal
          captureId={viewingNoteId}
          onClose={() => setViewingNoteId(null)}
        />
      )}
    </div>
  );
};
