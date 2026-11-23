import React, { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  BellRing,
  CalendarDays,
  CheckCircle2,
  Circle,
  Clock,
  Image as ImageIcon,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { db, enqueueSyncChange, recalculateProjectProgress } from '../../db/dexie';
import {
  addDaysToISODate,
  ARABIC_DAYS_SHORT,
  COMMITMENT_CATEGORY_LABELS,
  formatArabicDate,
  generateId,
  toISODate,
} from '../../lib/utils';
import {
  requestAlarmNotificationPermission,
  scheduleNativeStepNotification,
} from '../../native/capacitorBridge';
import { parseScheduleCommitments } from '../../services/geminiClient';
import { extractTextLocallyFromFile } from '../../services/ocrService';
import {
  allocateStepsAcrossFreeTime,
  computeFreeWindowsForDate,
} from '../../services/schedulerEngine';
import type {
  CommitmentCategory,
  FixedCommitmentRecord,
  MicroStepRecord,
  ProjectHorizon,
} from '../../types/models';
import { ErrorActionBanner } from '../ui/ErrorActionBanner';
import { Button, Input, Surface, Switch } from '../ui/primitives';

interface ScheduleViewProps {
  onStartMicroExecution: (projectId: string, stepId: string) => void;
  onTriggerStepAlarm: (step: MicroStepRecord, projectTitle: string) => void;
}

export const ScheduleView: React.FC<ScheduleViewProps> = ({
  onStartMicroExecution,
  onTriggerStepAlarm,
}) => {
  const [timeframe, setTimeframe] = useState<ProjectHorizon>('week');
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState<CommitmentCategory>('work');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [selectedDays, setSelectedDays] = useState<number[]>([0, 1, 2, 3, 4]);

  const [isRedistributing, setIsRedistributing] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<{ status: string; progress: number } | null>(
    null
  );
  const [scheduleNotice, setScheduleNotice] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<{
    message: string;
    onFix?: () => void;
  } | null>(null);
  const ocrInputRef = useRef<HTMLInputElement | null>(null);

  const commitments = useLiveQuery(() => db.fixedCommitments.toArray(), []);
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const steps = useLiveQuery(() => db.microSteps.toArray(), []);

  const projectTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    (projects ?? []).forEach((p) => map.set(p.id, p.title));
    return map;
  }, [projects]);

  const today = useMemo(() => new Date(), []);
  const todayIso = useMemo(() => toISODate(today), [today]);

  const todayFreeWindows = useMemo(() => {
    if (!commitments) return [];
    return computeFreeWindowsForDate(today, commitments, []);
  }, [commitments, today]);

  const filteredScheduledSteps = useMemo(() => {
    if (!steps) return [];
    const maxOffset =
      timeframe === 'day' ? 0 : timeframe === 'week' ? 6 : timeframe === 'month' ? 30 : 365;
    const endIso = addDaysToISODate(today, maxOffset);

    return steps
      .filter((s) => {
        if (!s.scheduledDate) return false;
        return s.scheduledDate >= todayIso && s.scheduledDate <= endIso;
      })
      .sort((a, b) => {
        const dA = `${a.scheduledDate ?? ''} ${a.scheduledStartTime ?? ''}`;
        const dB = `${b.scheduledDate ?? ''} ${b.scheduledStartTime ?? ''}`;
        return dA.localeCompare(dB);
      });
  }, [steps, timeframe, today, todayIso]);

  const toggleDay = (dayIndex: number) => {
    setSelectedDays((prev) =>
      prev.includes(dayIndex)
        ? prev.length > 1
          ? prev.filter((d) => d !== dayIndex)
          : prev
        : [...prev, dayIndex].sort((a, b) => a - b)
    );
  };

  const handleAddCommitment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    setErrorState(null);

    const now = new Date().toISOString();
    const record: FixedCommitmentRecord = {
      id: generateId(),
      label: label.trim(),
      category,
      daysOfWeek: selectedDays,
      startTime,
      endTime,
      source: 'manual',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await db.fixedCommitments.add(record);
      await enqueueSyncChange('fixed_commitments', record.id, 'upsert', record);
      setLabel('');
      setScheduleNotice('تمت إضافة الالتزام.');
    } catch (err) {
      setErrorState({
        message: err instanceof Error ? err.message : 'تعذر حفظ الالتزام.',
        onFix: () => {
          setErrorState(null);
          void db.fixedCommitments.put(record);
        },
      });
    }
  };

  const handleScanScheduleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScheduleNotice(null);
    setErrorState(null);

    try {
      const extractedText = await extractTextLocallyFromFile(file, (u) => setOcrProgress(u));
      if (!extractedText) {
        setErrorState({
          message: 'لم يُعثر على أوقات واضحة داخل الصورة.',
          onFix: () => {
            setErrorState(null);
            ocrInputRef.current?.click();
          },
        });
        return;
      }

      const { items } = await parseScheduleCommitments(extractedText);
      if (items.length === 0) {
        setErrorState({
          message: 'لم تُكتشف صيغ وقت قياسية (مثال: 08:30 - 14:00).',
          onFix: () => {
            setErrorState(null);
            ocrInputRef.current?.click();
          },
        });
        return;
      }

      const now = new Date().toISOString();
      const records: FixedCommitmentRecord[] = items.map((item) => ({
        id: generateId(),
        label: item.label,
        category: item.category,
        daysOfWeek: item.daysOfWeek,
        startTime: item.startTime,
        endTime: item.endTime,
        source: 'ocr',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      }));

      await db.fixedCommitments.bulkAdd(records);
      setScheduleNotice(`تمت إضافة ${records.length} التزامات من الجدول.`);
    } catch (err) {
      setErrorState({
        message: err instanceof Error ? err.message : 'تعذر مسح صورة الجدول.',
        onFix: () => {
          setErrorState(null);
          ocrInputRef.current?.click();
        },
      });
    } finally {
      setTimeout(() => setOcrProgress(null), 900);
      e.target.value = '';
    }
  };

  const handleRedistributeAll = async () => {
    setIsRedistributing(true);
    setErrorState(null);
    try {
      const [allCommitments, pendingSteps] = await Promise.all([
        db.fixedCommitments.toArray(),
        db.microSteps.where('status').notEqual('completed').toArray(),
      ]);

      const redistributed = allocateStepsAcrossFreeTime(
        pendingSteps,
        allCommitments,
        [],
        timeframe,
        new Date()
      );

      await db.microSteps.bulkPut(redistributed);

      // Schedule native Android local notifications for upcoming steps if granted
      for (const st of redistributed.slice(0, 12)) {
        const projTitle = projectTitleMap.get(st.projectId) ?? 'مشروع نشط';
        await scheduleNativeStepNotification(st, projTitle);
      }

      setScheduleNotice(`تم توزيع ${redistributed.length} خطوة على أوقات الفراغ.`);
    } catch (err) {
      setErrorState({
        message: err instanceof Error ? err.message : 'تعذر إعادة توزيع الخطوات.',
        onFix: () => {
          setErrorState(null);
          void handleRedistributeAll();
        },
      });
    } finally {
      setIsRedistributing(false);
    }
  };

  const handleToggleStepDone = async (step: MicroStepRecord) => {
    const now = new Date().toISOString();
    const nextStatus = step.status === 'completed' ? 'pending' : 'completed';
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
    await recalculateProjectProgress(step.projectId);
  };

  const handleAlarmWithPermission = async (step: MicroStepRecord, projectTitle: string) => {
    await requestAlarmNotificationPermission();
    await scheduleNativeStepNotification(step, projectTitle);
    onTriggerStepAlarm(step, projectTitle);
  };

  const handleToggleCommitment = async (item: FixedCommitmentRecord, nextActive: boolean) => {
    await db.fixedCommitments.update(item.id, {
      isActive: nextActive,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleDeleteCommitment = async (id: string) => {
    await db.fixedCommitments.delete(id);
    await enqueueSyncChange('fixed_commitments', id, 'delete', { id });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">الجدول</h1>

        <Button
          variant="primary"
          size="sm"
          onClick={() => void handleRedistributeAll()}
          disabled={isRedistributing}
        >
          {isRedistributing ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
          ) : (
            <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
          )}
          <span>إعادة التوزيع</span>
        </Button>
      </div>

      {errorState && (
        <ErrorActionBanner
          message={errorState.message}
          onApplyFix={errorState.onFix}
          onIgnore={() => setErrorState(null)}
        />
      )}

      {scheduleNotice && !errorState && (
        <div className="rounded-xl border border-blue-500/25 bg-blue-500/8 px-4 py-2.5 text-xs font-medium text-blue-700 dark:text-blue-300">
          {scheduleNotice}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Scheduled Timeline */}
        <div className="space-y-4 lg:col-span-7">
          <Surface className="p-5">
            <div className="flex items-center justify-between gap-2 border-b border-[#E5E7EB] pb-3 dark:border-[#222630]">
              <h2 className="text-sm font-semibold">نوافذ الفراغ اليوم</h2>
              <span className="font-mono-tabular text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                {todayFreeWindows.reduce((acc, w) => acc + w.durationMinutes, 0)} د
              </span>
            </div>

            {todayFreeWindows.length === 0 ? (
              <p className="mt-3 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                لا توجد نوافذ فراغ اليوم.
              </p>
            ) : (
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {todayFreeWindows.map((win, i) => (
                  <div
                    key={`${win.startTime}-${i}`}
                    className="flex items-center justify-between rounded-xl border border-[#E5E7EB] bg-[#FAFAFA] px-3.5 py-2.5 dark:border-[#222630] dark:bg-[#0E1015]"
                  >
                    <span className="font-mono-tabular text-xs font-semibold">
                      {win.startTime} — {win.endTime}
                    </span>
                    <span className="font-mono-tabular text-xs text-emerald-600 dark:text-emerald-400">
                      {win.durationMinutes} د
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Surface>

          <Surface className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E5E7EB] pb-4 dark:border-[#222630]">
              <h2 className="text-sm font-semibold">الخطوات المجدولة</h2>
              <div className="flex items-center gap-1 rounded-xl bg-[#F3F4F6] p-1 dark:bg-[#0E1015]">
                {(
                  [
                    { id: 'day', label: 'اليوم' },
                    { id: 'week', label: 'الأسبوع' },
                    { id: 'month', label: 'الشهر' },
                    { id: 'year', label: 'السنة' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setTimeframe(tab.id)}
                    className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      timeframe === tab.id
                        ? 'bg-white text-[#111318] shadow-sm dark:bg-[#1E222D] dark:text-[#F4F5F7]'
                        : 'text-[#6B7280] hover:text-[#111318] dark:text-[#9CA3AF] dark:hover:text-[#F4F5F7]'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {filteredScheduledSteps.length === 0 ? (
              <div className="py-12 text-center">
                <CalendarDays
                  className="mx-auto h-7 w-7 text-[#9CA3AF] dark:text-[#4B5563]"
                  strokeWidth={1.75}
                />
                <p className="mt-2.5 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                  لا توجد خطوات ضمن هذا النطاق.
                </p>
              </div>
            ) : (
              <div className="mt-3 divide-y divide-[#E5E7EB] dark:divide-[#222630]">
                {filteredScheduledSteps.map((step) => {
                  const projectTitle = projectTitleMap.get(step.projectId) ?? 'مشروع نشط';
                  const isDone = step.status === 'completed';

                  return (
                    <div
                      key={step.id}
                      className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex min-w-0 flex-1 items-start gap-2.5">
                        <button
                          type="button"
                          onClick={() => void handleToggleStepDone(step)}
                          aria-label={isDone ? 'إلغاء الإكمال' : 'تحديد كمكتملة'}
                          className="mt-0.5 shrink-0 cursor-pointer rounded-full p-0.5 text-[#6B7280] hover:text-blue-600"
                        >
                          {isDone ? (
                            <CheckCircle2
                              className="h-4 w-4 text-emerald-500"
                              strokeWidth={1.75}
                            />
                          ) : (
                            <Circle className="h-4 w-4 text-[#9CA3AF]" strokeWidth={1.75} />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => onStartMicroExecution(step.projectId, step.id)}
                          className="min-w-0 flex-1 cursor-pointer space-y-1 text-right"
                        >
                          <div className="flex flex-wrap items-center gap-2 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                            <span className="inline-flex items-center gap-1 font-mono-tabular font-semibold text-blue-600 dark:text-blue-400">
                              <Clock className="h-3.5 w-3.5" strokeWidth={1.75} />
                              {formatArabicDate(step.scheduledDate)} · {step.scheduledStartTime} -{' '}
                              {step.scheduledEndTime}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="truncate">{projectTitle}</span>
                          </div>
                          <p
                            className={`text-sm font-medium ${
                              isDone ? 'line-through text-[#9CA3AF]' : ''
                            }`}
                          >
                            {step.title}
                          </p>
                        </button>
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5">
                        {!isDone && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void handleAlarmWithPermission(step, projectTitle)}
                          >
                            <BellRing className="h-3.5 w-3.5 text-red-500" strokeWidth={1.75} />
                            <span>منبه</span>
                          </Button>
                        )}
                        <Button
                          variant={isDone ? 'secondary' : 'primary'}
                          size="sm"
                          onClick={() => onStartMicroExecution(step.projectId, step.id)}
                        >
                          <Play className="h-3.5 w-3.5" strokeWidth={1.75} />
                          <span>{isDone ? 'قراءة' : 'ابدأ'}</span>
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Surface>
        </div>

        {/* Fixed Commitments */}
        <div className="space-y-4 lg:col-span-5">
          <Surface className="p-5">
            <div className="flex items-center justify-between gap-2 border-b border-[#E5E7EB] pb-3 dark:border-[#222630]">
              <h2 className="text-sm font-semibold">الالتزامات الثابتة</h2>
              <div>
                <input
                  ref={ocrInputRef}
                  type="file"
                  accept="image/*,.txt,.csv"
                  className="hidden"
                  onChange={handleScanScheduleFile}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => ocrInputRef.current?.click()}
                  disabled={Boolean(ocrProgress)}
                >
                  <ImageIcon className="h-3.5 w-3.5" strokeWidth={1.75} />
                  <span>مسح جدول</span>
                </Button>
              </div>
            </div>

            {ocrProgress && (
              <div className="mt-3 space-y-1 rounded-xl border border-[#E5E7EB] bg-[#FAFAFA] p-3 text-xs dark:border-[#222630] dark:bg-[#0E1015]">
                <div className="flex items-center justify-between">
                  <span>{ocrProgress.status}</span>
                  <span className="font-mono-tabular">{ocrProgress.progress}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#E5E7EB] dark:bg-[#1E222D]">
                  <div
                    className="h-full bg-blue-600 transition-all"
                    style={{ width: `${ocrProgress.progress}%` }}
                  />
                </div>
              </div>
            )}

            <form onSubmit={handleAddCommitment} className="mt-4 space-y-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#6B7280] dark:text-[#9CA3AF]">
                  الاسم
                </label>
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="الدوام، الجامعة، النوم..."
                  required
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="mb-1 block text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                    التصنيف
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as CommitmentCategory)}
                    className="min-h-[44px] w-full rounded-xl border border-[#E5E7EB] bg-[#FAFAFA] px-2.5 text-xs text-[#111318] focus:border-blue-500 focus:outline-none dark:border-[#222630] dark:bg-[#0E1015] dark:text-[#F4F5F7]"
                  >
                    {(Object.keys(COMMITMENT_CATEGORY_LABELS) as CommitmentCategory[]).map(
                      (cat) => (
                        <option key={cat} value={cat}>
                          {COMMITMENT_CATEGORY_LABELS[cat]}
                        </option>
                      )
                    )}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                    من
                  </label>
                  <Input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="font-mono-tabular"
                    required
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                    إلى
                  </label>
                  <Input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="font-mono-tabular"
                    required
                  />
                </div>
              </div>

              <div>
                <span className="mb-1.5 block text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                  الأيام
                </span>
                <div className="grid grid-cols-7 gap-1">
                  {[0, 1, 2, 3, 4, 5, 6].map((dayIdx) => {
                    const active = selectedDays.includes(dayIdx);
                    return (
                      <button
                        key={dayIdx}
                        type="button"
                        onClick={() => toggleDay(dayIdx)}
                        className={`min-h-[38px] cursor-pointer rounded-lg text-[11px] font-medium transition-colors ${
                          active
                            ? 'bg-blue-600 text-white'
                            : 'bg-[#F3F4F6] text-[#6B7280] hover:text-[#111318] dark:bg-[#0E1015] dark:text-[#9CA3AF]'
                        }`}
                      >
                        {ARABIC_DAYS_SHORT[dayIdx].slice(0, 4)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <Button type="submit" variant="secondary" className="w-full">
                <Plus className="h-4 w-4" strokeWidth={1.75} />
                <span>إضافة التزام</span>
              </Button>
            </form>

            <div className="mt-5 divide-y divide-[#E5E7EB] border-t border-[#E5E7EB] pt-3 dark:divide-[#222630] dark:border-[#222630]">
              {(commitments ?? []).map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p
                      className={`truncate text-sm font-medium ${
                        !item.isActive ? 'line-through text-[#9CA3AF]' : ''
                      }`}
                    >
                      {item.label}
                    </p>
                    <p className="font-mono-tabular mt-0.5 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                      {item.startTime} - {item.endTime} ·{' '}
                      {COMMITMENT_CATEGORY_LABELS[item.category]}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <Switch
                      checked={item.isActive}
                      onCheckedChange={(checked) => void handleToggleCommitment(item, checked)}
                      ariaLabel={`تفعيل أو تعطيل ${item.label}`}
                    />
                    <button
                      type="button"
                      onClick={() => void handleDeleteCommitment(item.id)}
                      aria-label="حذف الالتزام"
                      className="flex min-h-[36px] min-w-[36px] cursor-pointer items-center justify-center rounded-lg text-[#9CA3AF] hover:text-red-500"
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Surface>
        </div>
      </div>
    </div>
  );
};
