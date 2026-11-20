import React, { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  BellRing,
  CalendarDays,
  Clock,
  Image as ImageIcon,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { db, enqueueSyncChange } from '../../db/dexie';
import {
  addDaysToISODate,
  ARABIC_DAYS_SHORT,
  COMMITMENT_CATEGORY_LABELS,
  formatArabicDate,
  generateId,
  toISODate,
} from '../../lib/utils';
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

    await db.fixedCommitments.add(record);
    await enqueueSyncChange('fixed_commitments', record.id, 'upsert', record);
    setLabel('');
    setScheduleNotice('تمت إضافة الالتزام وتحديث نوافذ الفراغ الحقيقية.');
  };

  const handleScanScheduleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScheduleNotice(null);

    try {
      const extractedText = await extractTextLocallyFromFile(file, (u) => setOcrProgress(u));
      if (!extractedText) {
        setScheduleNotice('لم يتم العثور على أوقات واضحة داخل الصورة.');
        return;
      }

      const { items } = await parseScheduleCommitments(extractedText);
      if (items.length === 0) {
        setScheduleNotice(
          'تمت قراءة النص محلياً لكن لم تُكتشف صيغ وقت قياسية (مثال: 08:30 - 14:00). يمكنك إضافتها يدوياً.'
        );
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
      setScheduleNotice(`تم استخراج وإضافة ${records.length} التزامات ثابتة من جدولك بنجاح.`);
    } catch (err) {
      setScheduleNotice(err instanceof Error ? err.message : 'فشل مسح صورة الجدول.');
    } finally {
      setTimeout(() => setOcrProgress(null), 900);
      e.target.value = '';
    }
  };

  const handleRedistributeAll = async () => {
    setIsRedistributing(true);
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
      setScheduleNotice(
        `تمت إعادة توزيع ${redistributed.length} خطوة جزئية بذكاء على نوافذ الفراغ الحقيقية.`
      );
    } finally {
      setIsRedistributing(false);
    }
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
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">الجدولة الذكية ونوافذ الفراغ</h1>
          <p className="mt-1 text-sm text-[#64748B] dark:text-[#94A3B8]">
            يستبعد المحرك أوقات التزاماتك الثابتة ليوزع الخطوات الجزئية المخزنة مسبقاً على أوقات
            الفراغ الفعلية فقط.
          </p>
        </div>

        <Button
          variant="primary"
          onClick={handleRedistributeAll}
          disabled={isRedistributing}
        >
          {isRedistributing ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
          ) : (
            <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
          )}
          <span>إعادة التوزيع على أوقات الفراغ</span>
        </Button>
      </div>

      {scheduleNotice && (
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-2.5 text-xs font-medium text-blue-700 dark:text-blue-300">
          {scheduleNotice}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Scheduled Pre-computed Micro-Steps Timeline */}
        <div className="space-y-4 lg:col-span-7">
          {/* Today's Calculated Real Free-Time Windows */}
          <Surface className="p-5">
            <div className="flex items-center justify-between gap-2 border-b border-[#E2E8F0] pb-3 dark:border-[#232936]">
              <h2 className="text-sm font-semibold">نوافذ الفراغ الحقيقية المتاحة اليوم</h2>
              <span className="font-mono-tabular text-xs text-[#64748B] dark:text-[#94A3B8]">
                {todayFreeWindows.reduce((acc, w) => acc + w.durationMinutes, 0)} دقيقة متاحة
              </span>
            </div>

            {todayFreeWindows.length === 0 ? (
              <p className="mt-3 text-xs text-[#64748B] dark:text-[#94A3B8]">
                لا توجد نوافذ فراغ مسجلة اليوم بعد خصم الالتزامات الثابتة.
              </p>
            ) : (
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {todayFreeWindows.map((win, i) => (
                  <div
                    key={`${win.startTime}-${i}`}
                    className="flex items-center justify-between rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3.5 py-2.5 dark:border-[#232936] dark:bg-[#0E1116]"
                  >
                    <span className="font-mono-tabular text-xs font-semibold">
                      {win.startTime} — {win.endTime}
                    </span>
                    <span className="font-mono-tabular text-xs text-emerald-600 dark:text-emerald-400">
                      {win.durationMinutes} دقيقة
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Surface>

          {/* Timeframe Switcher + Allocated Micro-Steps */}
          <Surface className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] pb-4 dark:border-[#232936]">
              <h2 className="text-sm font-semibold">خطة التنفيذ الموزعة زمنياً</h2>
              <div className="flex items-center gap-1 rounded-xl bg-[#EEF1F6] p-1 dark:bg-[#0E1116]">
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
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                      timeframe === tab.id
                        ? 'bg-white text-[#0F172A] shadow-sm dark:bg-[#1E2430] dark:text-[#F3F5F8]'
                        : 'text-[#64748B] hover:text-[#0F172A] dark:text-[#94A3B8] dark:hover:text-[#F3F5F8]'
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
                  className="mx-auto h-8 w-8 text-[#94A3B8] dark:text-[#475569]"
                  strokeWidth={1.75}
                />
                <p className="mt-3 text-sm font-medium">لا توجد خطوات مجدولة ضمن هذا النطاق</p>
                <p className="mt-1 text-xs text-[#64748B] dark:text-[#94A3B8]">
                  اعتمد مشروعاً من تبويب الاستيعاب أو اضغط «إعادة التوزيع على أوقات الفراغ».
                </p>
              </div>
            ) : (
              <div className="mt-4 divide-y divide-[#E2E8F0] dark:divide-[#232936]">
                {filteredScheduledSteps.map((step) => {
                  const projectTitle = projectTitleMap.get(step.projectId) ?? 'مشروع نشط';
                  const isDone = step.status === 'completed';

                  return (
                    <div
                      key={step.id}
                      className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-[#64748B] dark:text-[#94A3B8]">
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
                            isDone ? 'line-through text-[#94A3B8]' : ''
                          }`}
                        >
                          {step.title}
                        </p>
                      </div>

                      {!isDone && (
                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onTriggerStepAlarm(step, projectTitle)}
                          >
                            <BellRing className="h-3.5 w-3.5 text-red-500" strokeWidth={1.75} />
                            <span>تشغيل المنبه</span>
                          </Button>
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => onStartMicroExecution(step.projectId, step.id)}
                          >
                            <Play className="h-3.5 w-3.5" strokeWidth={1.75} />
                            <span>ابدأ</span>
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Surface>
        </div>

        {/* Fixed Commitments Manager + OCR Timetable Scanner */}
        <div className="space-y-4 lg:col-span-5">
          <Surface className="p-5">
            <div className="flex items-center justify-between gap-2 border-b border-[#E2E8F0] pb-3 dark:border-[#232936]">
              <h2 className="text-sm font-semibold">إدارة الالتزامات الثابتة</h2>
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
                  <span>مسح صورة الجدول (OCR)</span>
                </Button>
              </div>
            </div>

            {ocrProgress && (
              <div className="mt-3 space-y-1 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3 text-xs dark:border-[#232936] dark:bg-[#0E1116]">
                <div className="flex items-center justify-between">
                  <span>{ocrProgress.status}</span>
                  <span className="font-mono-tabular">{ocrProgress.progress}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#E2E8F0] dark:bg-[#1E2430]">
                  <div
                    className="h-full bg-blue-600 transition-all"
                    style={{ width: `${ocrProgress.progress}%` }}
                  />
                </div>
              </div>
            )}

            <form onSubmit={handleAddCommitment} className="mt-4 space-y-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#64748B] dark:text-[#94A3B8]">
                  اسم الالتزام الثابت
                </label>
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="مثال: دوام المكتب، محاضرة الجامعة، النادي..."
                  required
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="mb-1 block text-xs text-[#64748B] dark:text-[#94A3B8]">
                    التصنيف
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as CommitmentCategory)}
                    className="w-full min-h-[44px] rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 text-xs text-[#0F172A] focus:outline-none focus:border-blue-500 dark:border-[#232936] dark:bg-[#0E1116] dark:text-[#F3F5F8]"
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
                  <label className="mb-1 block text-xs text-[#64748B] dark:text-[#94A3B8]">
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
                  <label className="mb-1 block text-xs text-[#64748B] dark:text-[#94A3B8]">
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
                <span className="mb-1.5 block text-xs text-[#64748B] dark:text-[#94A3B8]">
                  أيام التكرار
                </span>
                <div className="grid grid-cols-7 gap-1">
                  {[0, 1, 2, 3, 4, 5, 6].map((dayIdx) => {
                    const active = selectedDays.includes(dayIdx);
                    return (
                      <button
                        key={dayIdx}
                        type="button"
                        onClick={() => toggleDay(dayIdx)}
                        className={`min-h-[38px] rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                          active
                            ? 'bg-blue-600 text-white'
                            : 'bg-[#EEF1F6] text-[#64748B] hover:text-[#0F172A] dark:bg-[#0E1116] dark:text-[#94A3B8]'
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
                <span>إضافة للجدول الثابت</span>
              </Button>
            </form>

            {/* Saved Commitments List */}
            <div className="mt-5 divide-y divide-[#E2E8F0] border-t border-[#E2E8F0] pt-3 dark:divide-[#232936] dark:border-[#232936]">
              {(commitments ?? []).map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p
                      className={`truncate text-sm font-medium ${
                        !item.isActive ? 'text-[#94A3B8] line-through' : ''
                      }`}
                    >
                      {item.label}
                    </p>
                    <p className="font-mono-tabular mt-0.5 text-xs text-[#64748B] dark:text-[#94A3B8]">
                      {item.startTime} - {item.endTime} ·{' '}
                      {COMMITMENT_CATEGORY_LABELS[item.category]}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Switch
                      checked={item.isActive}
                      onCheckedChange={(checked) => handleToggleCommitment(item, checked)}
                      ariaLabel={`تفعيل أو تعطيل ${item.label}`}
                    />
                    <button
                      type="button"
                      onClick={() => handleDeleteCommitment(item.id)}
                      aria-label="حذف الالتزام"
                      className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-[#94A3B8] hover:text-red-500 cursor-pointer"
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
