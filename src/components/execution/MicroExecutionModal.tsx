import React, { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Pause,
  Play,
  RotateCcw,
  X,
} from 'lucide-react';
import { db, enqueueSyncChange, recalculateProjectProgress } from '../../db/dexie';
import { Button } from '../ui/primitives';

interface MicroExecutionModalProps {
  projectId: string;
  initialStepId?: string;
  onClose: () => void;
}

/**
 * Isolated Distraction-Free Micro-Execution Mode.
 * Displays ONLY the current single part of the active pre-computed micro-step
 * from IndexedDB, advancing step-by-step via the "التالي" button with zero network calls.
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

  const [activeStepId, setActiveStepId] = useState<string | null>(initialStepId ?? null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [timerRunning, setTimerRunning] = useState(true);
  const [sessionCompletedCount, setSessionCompletedCount] = useState(0);

  const pendingSteps = useMemo(
    () => (allSteps ?? []).filter((s) => s.status !== 'completed'),
    [allSteps]
  );

  const activeStep = useMemo(() => {
    if (!allSteps || allSteps.length === 0) return null;
    if (activeStepId) {
      const found = allSteps.find((s) => s.id === activeStepId && s.status !== 'completed');
      if (found) return found;
    }
    return pendingSteps[0] ?? null;
  }, [allSteps, activeStepId, pendingSteps]);

  useEffect(() => {
    if (activeStep && activeStep.status === 'pending') {
      void db.microSteps.update(activeStep.id, {
        status: 'in_progress',
        updatedAt: new Date().toISOString(),
      });
    }
  }, [activeStep]);

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

  const handleNext = async () => {
    if (!activeStep) return;
    const now = new Date().toISOString();
    const totalParts = Math.max(1, activeStep.parts.length);
    const nextPartIndex = activeStep.currentPartIndex + 1;

    if (nextPartIndex < totalParts) {
      // Reveal the next pre-computed part of this same step
      await db.microSteps.update(activeStep.id, {
        currentPartIndex: nextPartIndex,
        status: 'in_progress',
        updatedAt: now,
      });
      return;
    }

    // Complete this micro-step and advance automatically to Part 1 of the next pre-computed step
    await db.microSteps.update(activeStep.id, {
      status: 'completed',
      completedAt: now,
      updatedAt: now,
    });
    await enqueueSyncChange('micro_steps', activeStep.id, 'upsert', {
      ...activeStep,
      status: 'completed',
      completedAt: now,
    });
    await recalculateProjectProgress(projectId);

    setSessionCompletedCount((prev) => prev + 1);
    setElapsedSeconds(0);

    const remaining = (allSteps ?? []).filter(
      (s) => s.id !== activeStep.id && s.status !== 'completed'
    );
    setActiveStepId(remaining[0]?.id ?? null);
  };

  const totalSteps = allSteps?.length ?? 0;
  const completedSteps = (allSteps ?? []).filter((s) => s.status === 'completed').length;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[#F5F7FA] text-[#0F172A] dark:bg-[#0B0D10] dark:text-[#F3F5F8]"
      role="dialog"
      aria-modal="true"
      aria-label="وضع التنفيذ التدريجي المعزول"
    >
      {/* Minimal Distraction-Free Top Bar */}
      <header className="flex items-center justify-between gap-4 border-b border-[#E2E8F0] px-5 py-4 dark:border-[#232936]">
        <div className="min-w-0">
          <p className="truncate text-xs text-[#64748B] dark:text-[#94A3B8]">
            وضع التنفيذ التدريجي · {project?.title ?? 'مشروع نشط'}
          </p>
          <p className="font-mono-tabular mt-0.5 text-xs font-medium">
            الخطوة {Math.min(completedSteps + 1, Math.max(1, totalSteps))} من {totalSteps}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {activeStep && (
            <div className="flex items-center gap-1.5 rounded-xl border border-[#E2E8F0] bg-white px-3 py-1.5 dark:border-[#232936] dark:bg-[#13161C]">
              <Clock className="h-3.5 w-3.5 text-blue-500" strokeWidth={1.75} />
              <span className="font-mono-tabular text-xs font-semibold">
                {formatTimer(elapsedSeconds)}
              </span>
              <button
                type="button"
                onClick={() => setTimerRunning((r) => !r)}
                aria-label={timerRunning ? 'إيقاف مؤقت' : 'استئناف المؤقت'}
                className="mr-1 text-[#64748B] hover:text-[#0F172A] dark:hover:text-white cursor-pointer"
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
                className="text-[#64748B] hover:text-[#0F172A] dark:hover:text-white cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
            </div>
          )}

          <Button variant="ghost" size="icon" onClick={onClose} aria-label="خروج من وضع التنفيذ">
            <X className="h-5 w-5" strokeWidth={1.75} />
          </Button>
        </div>
      </header>

      {/* Isolated Single-Part Focal Center */}
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-10">
        {!activeStep ? (
          <div className="w-full max-w-lg rounded-3xl border border-[#E2E8F0] bg-white p-8 text-center dark:border-[#232936] dark:bg-[#13161C]">
            <CheckCircle2
              className="mx-auto h-12 w-12 text-emerald-500"
              strokeWidth={1.75}
            />
            <h2 className="mt-4 text-2xl font-bold tracking-tight">
              أتممت جميع خطوات المشروع
            </h2>
            <p className="mt-2 text-sm text-[#64748B] dark:text-[#94A3B8]">
              تم إنجاز {sessionCompletedCount > 0 ? sessionCompletedCount : totalSteps} خطوات
              مقسمة مسبقاً وحفظ التقدم بالكامل في IndexedDB.
            </p>
            <div className="mt-6">
              <Button variant="primary" size="lg" onClick={onClose}>
                العودة للمشاريع
              </Button>
            </div>
          </div>
        ) : (
          <div className="w-full max-w-2xl space-y-8">
            {/* Step & Current Part Metadata */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#64748B] dark:text-[#94A3B8]">
              <span>الخطوة الحالية: {activeStep.title}</span>
              <span className="font-mono-tabular font-semibold text-blue-600 dark:text-blue-400">
                الجزء {activeStep.currentPartIndex + 1} من {Math.max(1, activeStep.parts.length)}
              </span>
            </div>

            {/* Part Progress Bar */}
            <div className="flex gap-1.5">
              {activeStep.parts.map((_, idx) => (
                <div
                  key={idx}
                  className={`h-1.5 flex-1 rounded-full transition-colors duration-200 ${
                    idx <= activeStep.currentPartIndex
                      ? 'bg-blue-600 dark:bg-blue-500'
                      : 'bg-[#E2E8F0] dark:bg-[#232936]'
                  }`}
                />
              ))}
            </div>

            {/* ONLY the current part is rendered here — zero visual distractions */}
            <div className="rounded-3xl border border-[#E2E8F0] bg-white p-8 sm:p-10 dark:border-[#232936] dark:bg-[#13161C]">
              <p className="text-xs font-medium text-[#64748B] dark:text-[#94A3B8]">
                نفّذ هذا الجزء فقط الآن
              </p>
              <h2 className="mt-4 text-2xl font-bold leading-relaxed tracking-tight sm:text-3xl">
                {activeStep.parts[activeStep.currentPartIndex] ?? activeStep.title}
              </h2>
            </div>

            {/* Primary "التالي" Action */}
            <div className="flex items-center justify-between gap-4">
              <span className="font-mono-tabular text-xs text-[#64748B] dark:text-[#94A3B8]">
                المدة المقدرة للخطوة: {activeStep.durationMinutes} دقيقة
              </span>

              <Button variant="primary" size="lg" onClick={handleNext} className="min-w-[180px]">
                <span>
                  {activeStep.currentPartIndex + 1 < activeStep.parts.length
                    ? 'التالي'
                    : 'إتمام الخطوة والتالي'}
                </span>
                <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
