import React, { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  Circle,
  Clock,
  ListChecks,
  Pause,
  Play,
  RotateCcw,
  X,
} from 'lucide-react';
import { db, enqueueSyncChange, recalculateProjectProgress } from '../../db/dexie';
import type { MicroStepRecord } from '../../types/models';
import { OriginalTextModal } from '../notes/OriginalTextModal';
import { ErrorActionBanner } from '../ui/ErrorActionBanner';
import { Button } from '../ui/primitives';

interface MicroExecutionModalProps {
  projectId: string;
  initialStepId?: string;
  onClose: () => void;
}

/**
 * Flexible Micro-Execution & Step Reader Mode.
 * - Supports Next ("التالي") and Previous ("السابق") navigation across parts and steps.
 * - Allows clicking any step (pending or completed) in the list to read/review at any time.
 * - Marking a step "تم" strikes it through without hiding or locking it, and can be unchecked anytime.
 * - Finished projects remain openable, readable, and reopenable at any time.
 */
export const MicroExecutionModal: React.FC<MicroExecutionModalProps> = ({
  projectId,
  initialStepId,
  onClose,
}) => {
  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const allSteps = useLiveQuery(
    () => db.microSteps.where('projectId').equals(projectId).sortBy('orderIndex'),
    [projectId]
  );

  const [selectedStepId, setSelectedStepId] = useState<string | null>(initialStepId ?? null);
  const [partIndex, setPartIndex] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const [showOriginalNote, setShowOriginalNote] = useState(false);
  const [errorBanner, setErrorBanner] = useState<{
    message: string;
    onFix?: () => void;
  } | null>(null);

  const orderedSteps = useMemo(() => allSteps ?? [], [allSteps]);

  // Select initial step once steps load (prefer initialStepId, then first pending, then first step)
  useEffect(() => {
    if (orderedSteps.length === 0) return;
    const exists = selectedStepId && orderedSteps.some((s) => s.id === selectedStepId);
    if (!exists) {
      const target =
        (initialStepId ? orderedSteps.find((s) => s.id === initialStepId) : undefined) ??
        orderedSteps.find((s) => s.status !== 'completed') ??
        orderedSteps[0];
      if (target) {
        setSelectedStepId(target.id);
        setPartIndex(
          Math.min(Math.max(0, target.currentPartIndex || 0), Math.max(0, target.parts.length - 1))
        );
      }
    }
  }, [orderedSteps, selectedStepId, initialStepId]);

  const activeStepIndex = useMemo(
    () => orderedSteps.findIndex((s) => s.id === selectedStepId),
    [orderedSteps, selectedStepId]
  );

  const activeStep = activeStepIndex >= 0 ? orderedSteps[activeStepIndex] : orderedSteps[0] ?? null;
  const activeParts = useMemo(() => {
    if (!activeStep) return [];
    return activeStep.parts.length > 0 ? activeStep.parts : [activeStep.title];
  }, [activeStep]);

  const safePartIndex = Math.min(Math.max(0, partIndex), Math.max(0, activeParts.length - 1));

  useEffect(() => {
    if (!timerRunning || !activeStep) return;
    const id = window.setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [timerRunning, activeStep]);

  const formatTimer = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const selectStep = (step: MicroStepRecord, targetPart?: number) => {
    setSelectedStepId(step.id);
    const maxP = Math.max(0, step.parts.length - 1);
    const nextP =
      targetPart !== undefined
        ? Math.min(Math.max(0, targetPart), maxP)
        : Math.min(Math.max(0, step.currentPartIndex || 0), maxP);
    setPartIndex(nextP);
    setMobileListOpen(false);
  };

  const persistPartIndex = async (step: MicroStepRecord, nextIdx: number) => {
    try {
      await db.microSteps.update(step.id, {
        currentPartIndex: nextIdx,
        status: step.status === 'pending' ? 'in_progress' : step.status,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      setErrorBanner({
        message: err instanceof Error ? err.message : 'تعذر حفظ موضع الخطوة محلياً.',
        onFix: () => {
          setErrorBanner(null);
          void persistPartIndex(step, nextIdx);
        },
      });
    }
  };

  const handleToggleStepDone = async (step: MicroStepRecord) => {
    const now = new Date().toISOString();
    const nextStatus = step.status === 'completed' ? 'pending' : 'completed';
    try {
      await db.microSteps.update(step.id, {
        status: nextStatus,
        completedAt: nextStatus === 'completed' ? now : undefined,
        updatedAt: now,
      });
      await enqueueSyncChange('micro_steps', step.id, 'upsert', {
        ...step,
        status: nextStatus,
        completedAt: nextStatus === 'completed' ? now : undefined,
        updatedAt: now,
      });
      await recalculateProjectProgress(projectId);
    } catch (err) {
      setErrorBanner({
        message: err instanceof Error ? err.message : 'تعذر تحديث حالة الخطوة.',
        onFix: () => {
          setErrorBanner(null);
          void handleToggleStepDone(step);
        },
      });
    }
  };

  const handleToggleProjectStatus = async () => {
    if (!project) return;
    const nextStatus = project.status === 'completed' ? 'active' : 'completed';
    const now = new Date().toISOString();
    try {
      await db.projects.update(project.id, {
        status: nextStatus,
        updatedAt: now,
      });
      await enqueueSyncChange('projects', project.id, 'upsert', {
        ...project,
        status: nextStatus,
        updatedAt: now,
      });
    } catch (err) {
      setErrorBanner({
        message: err instanceof Error ? err.message : 'تعذر تحديث حالة المشروع.',
        onFix: () => {
          setErrorBanner(null);
          void handleToggleProjectStatus();
        },
      });
    }
  };

  const handlePrevious = () => {
    if (!activeStep) return;
    if (safePartIndex > 0) {
      const nextP = safePartIndex - 1;
      setPartIndex(nextP);
      void persistPartIndex(activeStep, nextP);
      return;
    }
    if (activeStepIndex > 0) {
      const prevStep = orderedSteps[activeStepIndex - 1];
      const prevLastPart = Math.max(0, prevStep.parts.length - 1);
      selectStep(prevStep, prevLastPart);
      void persistPartIndex(prevStep, prevLastPart);
    }
  };

  const handleNext = () => {
    if (!activeStep) return;
    if (safePartIndex + 1 < activeParts.length) {
      const nextP = safePartIndex + 1;
      setPartIndex(nextP);
      void persistPartIndex(activeStep, nextP);
      return;
    }
    if (activeStepIndex >= 0 && activeStepIndex + 1 < orderedSteps.length) {
      const nextStep = orderedSteps[activeStepIndex + 1];
      selectStep(nextStep, 0);
      void persistPartIndex(nextStep, 0);
    }
  };

  const totalSteps = orderedSteps.length;
  const completedSteps = orderedSteps.filter((s) => s.status === 'completed').length;
  const isAtStart = activeStepIndex <= 0 && safePartIndex === 0;
  const isAtEnd =
    activeStepIndex >= orderedSteps.length - 1 && safePartIndex >= activeParts.length - 1;
  const isCurrentStepDone = activeStep?.status === 'completed';

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[#FAFAFA] text-[#111318] dark:bg-[#0C0D10] dark:text-[#F4F5F7]"
      role="dialog"
      aria-modal="true"
      aria-label="تنفيذ ومراجعة الخطوات"
    >
      {/* Top Bar */}
      <header className="flex items-center justify-between gap-3 border-b border-[#E5E7EB] bg-white px-4 py-3 dark:border-[#222630] dark:bg-[#13151B] sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMobileListOpen((prev) => !prev)}
            className="lg:hidden"
          >
            <ListChecks className="h-4 w-4" strokeWidth={1.75} />
            <span className="font-mono-tabular">
              {completedSteps}/{totalSteps}
            </span>
          </Button>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">
              {project?.title ?? 'المشروع'}
            </h2>
            <p className="font-mono-tabular text-xs text-[#6B7280] dark:text-[#9CA3AF]">
              {completedSteps} من {totalSteps} منجز
              {project?.status === 'completed' ? ' · مشروع منتهٍ (قابل للمراجعة وإعادة الفتح)' : ''}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* Compact Timer */}
          <div className="hidden items-center gap-1.5 rounded-xl border border-[#E5E7EB] bg-[#FAFAFA] px-3 py-1.5 sm:flex dark:border-[#222630] dark:bg-[#0C0D10]">
            <Clock className="h-3.5 w-3.5 text-blue-500" strokeWidth={1.75} />
            <span className="font-mono-tabular text-xs font-semibold">
              {formatTimer(elapsedSeconds)}
            </span>
            <button
              type="button"
              onClick={() => setTimerRunning((r) => !r)}
              aria-label={timerRunning ? 'إيقاف المؤقت' : 'تشغيل المؤقت'}
              className="mr-1 cursor-pointer text-[#6B7280] hover:text-[#111318] dark:hover:text-white"
            >
              {timerRunning ? (
                <Pause className="h-3.5 w-3.5" strokeWidth={1.75} />
              ) : (
                <Play className="h-3.5 w-3.5" strokeWidth={1.75} />
              )}
            </button>
            <button
              type="button"
              onClick={() => setElapsedSeconds(0)}
              aria-label="تصفير المؤقت"
              className="cursor-pointer text-[#6B7280] hover:text-[#111318] dark:hover:text-white"
            >
              <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </div>

          {project?.sourceCaptureId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowOriginalNote(true)}
              title="عرض النص الأصلي كما كُتب"
            >
              <BookOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span className="hidden sm:inline">النص الأصلي</span>
            </Button>
          )}

          {project && (
            <Button
              variant={project.status === 'completed' ? 'outline' : 'secondary'}
              size="sm"
              onClick={() => void handleToggleProjectStatus()}
            >
              <span>{project.status === 'completed' ? 'إعادة فتح' : 'إنهاء'}</span>
            </Button>
          )}

          <Button variant="ghost" size="icon" onClick={onClose} aria-label="إغلاق">
            <X className="h-5 w-5" strokeWidth={1.75} />
          </Button>
        </div>
      </header>

      {/* Main Split Layout: Clickable Steps List + Active Step Reader */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* Steps Sidebar (Always visible on desktop, drawer on mobile) */}
        <aside
          className={`${
            mobileListOpen
              ? 'absolute inset-y-0 right-0 z-20 flex w-80 max-w-[85vw] shadow-2xl'
              : 'hidden'
          } flex-col border-l border-[#E5E7EB] bg-white lg:static lg:flex lg:w-80 lg:shadow-none dark:border-[#222630] dark:bg-[#13151B]`}
        >
          <div className="flex items-center justify-between border-b border-[#E5E7EB] px-4 py-3 dark:border-[#222630]">
            <span className="text-xs font-semibold text-[#6B7280] dark:text-[#9CA3AF]">
              قائمة الخطوات ({totalSteps})
            </span>
            <button
              type="button"
              onClick={() => setMobileListOpen(false)}
              className="rounded-lg p-1 text-[#6B7280] lg:hidden"
              aria-label="إغلاق القائمة"
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>

          <div className="flex-1 divide-y divide-[#E5E7EB] overflow-y-auto dark:divide-[#222630]">
            {orderedSteps.map((step, idx) => {
              const isSelected = activeStep?.id === step.id;
              const isDone = step.status === 'completed';

              return (
                <div
                  key={step.id}
                  className={`flex items-start gap-2.5 px-3.5 py-3 transition-colors ${
                    isSelected
                      ? 'bg-blue-500/8 dark:bg-blue-500/12'
                      : 'hover:bg-[#F3F4F6] dark:hover:bg-[#1A1D26]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void handleToggleStepDone(step)}
                    aria-label={isDone ? 'إلغاء إكمال الخطوة' : 'تحديد الخطوة كمكتملة'}
                    title={isDone ? 'إلغاء الإكمال' : 'تحديد كمكتملة (تم)'}
                    className="mt-0.5 shrink-0 cursor-pointer rounded-full p-0.5 text-[#6B7280] hover:text-blue-600"
                  >
                    {isDone ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" strokeWidth={1.75} />
                    ) : (
                      <Circle className="h-4 w-4 text-[#9CA3AF]" strokeWidth={1.75} />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => selectStep(step)}
                    className="min-w-0 flex-1 cursor-pointer text-right"
                  >
                    <p
                      className={`text-xs font-medium leading-relaxed ${
                        isDone
                          ? 'line-through text-[#9CA3AF]'
                          : isSelected
                            ? 'text-blue-600 dark:text-blue-400'
                            : 'text-[#111318] dark:text-[#F4F5F7]'
                      }`}
                    >
                      <span className="font-mono-tabular ml-1 text-[#9CA3AF]">
                        {String(idx + 1).padStart(2, '0')}.
                      </span>
                      {step.title}
                    </p>
                    <span className="font-mono-tabular mt-1 block text-[11px] text-[#6B7280] dark:text-[#9CA3AF]">
                      {step.parts.length} أجزاء · {step.durationMinutes} د
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </aside>

        {/* Active Step Focus Reader */}
        <main className="flex flex-1 flex-col overflow-y-auto px-5 py-6 sm:px-10 sm:py-10">
          {errorBanner && (
            <div className="mx-auto mb-5 w-full max-w-2xl">
              <ErrorActionBanner
                message={errorBanner.message}
                onApplyFix={errorBanner.onFix}
                onIgnore={() => setErrorBanner(null)}
              />
            </div>
          )}

          {!activeStep ? (
            <div className="m-auto w-full max-w-md rounded-2xl border border-[#E5E7EB] bg-white p-8 text-center dark:border-[#222630] dark:bg-[#13151B]">
              <p className="text-sm font-medium">لا توجد خطوات مسجلة في هذا المشروع.</p>
              <div className="mt-5">
                <Button variant="primary" onClick={onClose}>
                  إغلاق
                </Button>
              </div>
            </div>
          ) : (
            <div className="m-auto w-full max-w-2xl space-y-6">
              {/* Step Title & Status */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                <span className={isCurrentStepDone ? 'line-through' : 'font-medium text-[#111318] dark:text-[#F4F5F7]'}>
                  الخطوة {activeStepIndex + 1} من {totalSteps}: {activeStep.title}
                </span>
                <span className="font-mono-tabular font-semibold text-blue-600 dark:text-blue-400">
                  الجزء {safePartIndex + 1} / {activeParts.length}
                </span>
              </div>

              {/* Clickable Part Selector Bars */}
              <div className="flex gap-1.5">
                {activeParts.map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setPartIndex(idx);
                      void persistPartIndex(activeStep, idx);
                    }}
                    aria-label={`الانتقال للجزء ${idx + 1}`}
                    className={`h-2 flex-1 cursor-pointer rounded-full transition-colors ${
                      idx === safePartIndex
                        ? 'bg-blue-600 dark:bg-blue-500'
                        : idx < safePartIndex
                          ? 'bg-blue-600/40 dark:bg-blue-500/40'
                          : 'bg-[#E5E7EB] dark:bg-[#222630]'
                    }`}
                  />
                ))}
              </div>

              {/* Focal Part Content Card */}
              <div className="rounded-2xl border border-[#E5E7EB] bg-white p-7 sm:p-10 dark:border-[#222630] dark:bg-[#13151B]">
                <div className="flex items-center justify-between gap-2 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                  <span className="font-mono-tabular">{activeStep.durationMinutes} دقيقة</span>
                  {isCurrentStepDone && (
                    <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                      <span>مكتملة</span>
                    </span>
                  )}
                </div>

                <h3
                  className={`mt-4 text-xl font-semibold leading-relaxed tracking-tight sm:text-2xl ${
                    isCurrentStepDone ? 'line-through text-[#6B7280] dark:text-[#9CA3AF]' : ''
                  }`}
                >
                  {activeParts[safePartIndex]}
                </h3>
              </div>

              {/* Navigation & Reversible Completion Controls: السابق | تم | التالي */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button
                  variant="outline"
                  size="lg"
                  onClick={handlePrevious}
                  disabled={isAtStart}
                  className="min-w-[116px]"
                >
                  <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
                  <span>السابق</span>
                </Button>

                <Button
                  variant={isCurrentStepDone ? 'secondary' : 'outline'}
                  size="lg"
                  onClick={() => void handleToggleStepDone(activeStep)}
                  className={
                    isCurrentStepDone
                      ? 'border border-emerald-500/40 text-emerald-700 dark:text-emerald-400'
                      : ''
                  }
                >
                  <Check className="h-4 w-4" strokeWidth={1.75} />
                  <span>{isCurrentStepDone ? 'تم (إلغاء الإكمال)' : 'تم'}</span>
                </Button>

                <Button
                  variant="primary"
                  size="lg"
                  onClick={handleNext}
                  disabled={isAtEnd}
                  className="min-w-[116px]"
                >
                  <span>التالي</span>
                  <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
                </Button>
              </div>
            </div>
          )}
        </main>
      </div>
      {showOriginalNote && project?.sourceCaptureId && (
        <OriginalTextModal
          captureId={project.sourceCaptureId}
          title={project.title}
          onClose={() => setShowOriginalNote(false)}
        />
      )}
    </div>
  );
};
