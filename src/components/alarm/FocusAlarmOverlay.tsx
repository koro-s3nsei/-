import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  Lock,
  Play,
  ShieldAlert,
  Smartphone,
  Volume2,
} from 'lucide-react';
import { db } from '../../db/dexie';
import { formatMinutesToTime, generateId, parseTimeToMinutes } from '../../lib/utils';
import { detectDistractionActivityLabel } from '../../native/capacitorBridge';
import { alarmAudioEngine } from '../../services/alarmAudioEngine';
import type {
  AlarmSessionRecord,
  DistractionEvent,
  EmergencyChallengeType,
  MicroStepRecord,
} from '../../types/models';
import { Button, Input } from '../ui/primitives';

interface FocusAlarmOverlayProps {
  step: MicroStepRecord;
  projectTitle: string;
  monitoringMinutes: number;
  challengeType: EmergencyChallengeType;
  alarmVolume: number;
  onStartExecutionNow: (projectId: string, stepId: string) => void;
  onEmergencySnoozeGranted: () => void;
}

const STRICT_CONFIRMATION_SENTENCE =
  'أقر بأنني أؤجل هذه المهمة لظرف طارئ حقيقي وسأعود لإنجازها خلال خمس عشرة دقيقة دون تسويف';

export const FocusAlarmOverlay: React.FC<FocusAlarmOverlayProps> = ({
  step,
  projectTitle,
  monitoringMinutes,
  challengeType,
  alarmVolume,
  onStartExecutionNow,
  onEmergencySnoozeGranted,
}) => {
  const sessionIdRef = useRef<string>(generateId());
  const [remainingSeconds, setRemainingSeconds] = useState(monitoringMinutes * 60);
  const [detectedApp, setDetectedApp] = useState<string | null>(null);
  const [distractionEvents, setDistractionEvents] = useState<DistractionEvent[]>([]);
  const [showEmergencyBox, setShowEmergencyBox] = useState(false);
  const [emergencyUsed, setEmergencyUsed] = useState(false);
  const [challengeInput, setChallengeInput] = useState('');
  const [challengeError, setChallengeError] = useState<string | null>(null);

  // Deterministic math problem per alarm invocation
  const mathChallenge = useMemo(() => {
    const a = 14 + Math.floor(Math.random() * 12);
    const b = 3 + Math.floor(Math.random() * 5);
    const c = 17 + Math.floor(Math.random() * 25);
    return {
      expression: `(${a} × ${b}) + ${c}`,
      answer: a * b + c,
    };
  }, []);

  // Initialize continuous alarm audio & persist battery-scoped 30-min session in IndexedDB
  useEffect(() => {
    const triggeredAt = new Date();
    const monitoringEndsAt = new Date(triggeredAt.getTime() + monitoringMinutes * 60 * 1000);

    const initialSession: AlarmSessionRecord = {
      id: sessionIdRef.current,
      microStepId: step.id,
      microStepTitle: step.title,
      projectTitle,
      triggeredAt: triggeredAt.toISOString(),
      monitoringEndsAt: monitoringEndsAt.toISOString(),
      emergencySnoozeUsed: false,
      distractionEvents: [],
      status: 'ringing',
    };

    void db.alarmSessions.put(initialSession);
    alarmAudioEngine.start(alarmVolume);

    return () => {
      alarmAudioEngine.stop();
    };
  }, [step.id, step.title, projectTitle, monitoringMinutes, alarmVolume]);

  // Countdown strictly limited to the monitoring window (battery protection)
  useEffect(() => {
    const timer = window.setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          alarmAudioEngine.stop();
          void db.alarmSessions.update(sessionIdRef.current, { status: 'expired' });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const registerDistraction = async (overrideActivity?: string) => {
    const detected = overrideActivity
      ? { activityName: overrideActivity, source: 'android-usage-stats' as const }
      : await detectDistractionActivityLabel();

    const newEvent: DistractionEvent = {
      timestamp: new Date().toISOString(),
      detectedActivity: detected.activityName,
      source: detected.source,
    };

    setDetectedApp(detected.activityName);
    setDistractionEvents((prev) => {
      const updated = [newEvent, ...prev];
      void db.alarmSessions.update(sessionIdRef.current, {
        distractionEvents: updated,
        status: 'monitoring',
      });
      return updated;
    });

    // Ensure continuous alarm keeps ringing relentlessly on distraction
    alarmAudioEngine.start(alarmVolume);
  };

  // Page Visibility API & Window Blur distraction detection (ONLY active during alarm window)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        void registerDistraction();
      }
    };

    const handleWindowBlur = () => {
      void registerDistraction('تطبيق أو نافذة ترفيهية خارجية');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [alarmVolume]);

  const handleStartExecution = async () => {
    alarmAudioEngine.stop();
    await db.alarmSessions.update(sessionIdRef.current, {
      startedExecutionAt: new Date().toISOString(),
      status: 'resolved',
    });
    onStartExecutionNow(step.projectId, step.id);
  };

  const handleVerifyEmergencySnooze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (emergencyUsed) return;

    const cleanInput = challengeInput.trim();
    const isMathValid =
      challengeType === 'math' && parseInt(cleanInput, 10) === mathChallenge.answer;
    const isSentenceValid =
      challengeType === 'sentence' && cleanInput === STRICT_CONFIRMATION_SENTENCE;

    if (!isMathValid && !isSentenceValid) {
      setChallengeError(
        challengeType === 'math'
          ? 'الإجابة الحسابية غير صحيحة. المنبه سيستمر بالرنين.'
          : 'الجملة غير مطابقة حرفياً. اكتبها كاملة دون أخطاء.'
      );
      alarmAudioEngine.start(alarmVolume);
      return;
    }

    // Grant one-time +15 min protected emergency snooze
    setEmergencyUsed(true);
    alarmAudioEngine.stop();

    const baseStart = step.scheduledStartTime
      ? parseTimeToMinutes(step.scheduledStartTime)
      : new Date().getHours() * 60 + new Date().getMinutes();
    const snoozedStart = baseStart + 15;
    const snoozedEnd = snoozedStart + (step.durationMinutes || 20);

    await db.microSteps.update(step.id, {
      scheduledStartTime: formatMinutesToTime(snoozedStart),
      scheduledEndTime: formatMinutesToTime(snoozedEnd),
      updatedAt: new Date().toISOString(),
    });

    await db.alarmSessions.update(sessionIdRef.current, {
      emergencySnoozeUsed: true,
      emergencySnoozeReason: challengeType === 'math' ? 'تحدي معادلة رياضية' : 'تأكيد كتابي كامل',
      status: 'snoozed',
    });

    onEmergencySnoozeGranted();
  };

  const formatCountdown = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col justify-between overflow-y-auto bg-[#090B0F] px-5 py-6 text-[#F3F5F8]"
      role="alertdialog"
      aria-modal="true"
      aria-label="شاشة التنبيه الصارم الإلزامية"
    >
      {/* Top Battery-Safe Monitoring Strip */}
      <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-4 border-b border-[#232936] pb-4 text-xs">
        <div className="flex items-center gap-2 text-red-400">
          <BellRing className="h-4 w-4 animate-bounce" strokeWidth={1.75} />
          <span className="font-semibold">تنبيه تنفيذي إلزامي نشط</span>
        </div>

        <div className="flex items-center gap-3 text-[#94A3B8]">
          <span className="font-mono-tabular">
            نافذة المراقبة: {formatCountdown(remainingSeconds)}
          </span>
          <button
            type="button"
            onClick={() => alarmAudioEngine.start(alarmVolume)}
            className="inline-flex items-center gap-1 rounded-lg border border-[#232936] px-2.5 py-1 text-xs text-[#CBD5E1] hover:bg-[#13161C] cursor-pointer"
          >
            <Volume2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span>تفعيل الصوت</span>
          </button>
        </div>
      </div>

      {/* Main Enforcement Card */}
      <div className="mx-auto my-6 w-full max-w-2xl space-y-6">
        {/* Strict Confrontation Alert when distraction/procrastination is detected */}
        {detectedApp && (
          <div className="rounded-2xl border-2 border-red-500 bg-red-600/15 p-5">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 h-6 w-6 shrink-0 text-red-400" strokeWidth={1.75} />
              <div className="space-y-1">
                <p className="text-base font-bold leading-relaxed text-red-200">
                  كذاب، أنت جالس تتصفح [{detectedApp}] الآن. ارجع لمهمتك فوراً
                </p>
                <p className="font-mono-tabular text-xs text-red-300/80">
                  محاولات التشتت المرصودة في هذه الجلسة: {distractionEvents.length}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-3xl border border-[#232936] bg-[#13161C] p-6 sm:p-8">
          <p className="text-xs text-[#94A3B8]">حان موعد التنفيذ الآن · {projectTitle}</p>
          <h1 className="mt-3 text-2xl font-bold leading-snug tracking-tight sm:text-3xl">
            {step.title}
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-[#94A3B8]">
            <span className="font-mono-tabular">المدة المجدولة: {step.durationMinutes} دقيقة</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-tabular">
              الجزء الأول جاهز محلياً من أصل {step.parts.length} أجزاء
            </span>
          </div>

          <div className="mt-7 space-y-3">
            <Button
              variant="primary"
              size="lg"
              className="w-full min-h-[54px] text-base"
              onClick={handleStartExecution}
            >
              <Play className="h-5 w-5" strokeWidth={1.75} />
              <span>ابدأ التنفيذ التدريجي الآن وأوقف المنبه</span>
            </Button>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowEmergencyBox((prev) => !prev)}
                disabled={emergencyUsed}
                className="border-[#2D3546] text-[#CBD5E1] hover:bg-[#1A1F28]"
              >
                <Lock className="h-3.5 w-3.5" strokeWidth={1.75} />
                <span>
                  {emergencyUsed
                    ? 'تم استنفاد التأجيل الاضطراري'
                    : 'تأجيل اضطراري محمي (مرة واحدة)'}
                </span>
              </Button>

              {/* Simulation trigger for testing Android UsageStats / distraction confrontation immediately */}
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-[#64748B]">اختبار كشف التشتت:</span>
                {['YouTube', 'Instagram', 'TikTok'].map((appName) => (
                  <button
                    key={appName}
                    type="button"
                    onClick={() => void registerDistraction(appName)}
                    className="inline-flex items-center gap-1 rounded-lg border border-[#232936] bg-[#0E1116] px-2.5 py-1 text-[11px] text-[#94A3B8] hover:border-red-500/40 hover:text-red-300 cursor-pointer"
                  >
                    <Smartphone className="h-3 w-3" strokeWidth={1.75} />
                    <span>{appName}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Protected Emergency Snooze Challenge Box */}
        {showEmergencyBox && !emergencyUsed && (
          <form
            onSubmit={handleVerifyEmergencySnooze}
            className="rounded-2xl border border-amber-500/30 bg-[#13161C] p-5 space-y-4"
          >
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" strokeWidth={1.75} />
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-amber-200">
                  التحقق الإلزامي للتأجيل الاضطراري (+15 دقيقة لمرة واحدة)
                </h2>
                <p className="text-xs text-[#94A3B8]">
                  لمنع الإغلاق العشوائي بدافع الكسل، أكمل التحقق التالي لإيقاف المنبه مؤقتاً:
                </p>
              </div>
            </div>

            {challengeType === 'math' ? (
              <div className="space-y-2">
                <p className="font-mono-tabular rounded-xl border border-[#232936] bg-[#0B0D10] px-4 py-3 text-center text-lg font-bold tracking-wider text-blue-400">
                  {mathChallenge.expression} = ؟
                </p>
                <Input
                  type="number"
                  value={challengeInput}
                  onChange={(e) => {
                    setChallengeInput(e.target.value);
                    setChallengeError(null);
                  }}
                  placeholder="أدخل الناتج الصحيح..."
                  className="font-mono-tabular"
                  required
                />
              </div>
            ) : (
              <div className="space-y-2">
                <p className="select-none rounded-xl border border-[#232936] bg-[#0B0D10] p-3.5 text-xs leading-relaxed text-[#CBD5E1]">
                  {STRICT_CONFIRMATION_SENTENCE}
                </p>
                <Input
                  type="text"
                  value={challengeInput}
                  onPaste={(e) => e.preventDefault()}
                  onChange={(e) => {
                    setChallengeInput(e.target.value);
                    setChallengeError(null);
                  }}
                  placeholder="اكتب الجملة أعلاه كاملة يدوياً (اللصق معطل)..."
                  required
                />
              </div>
            )}

            {challengeError && <p className="text-xs text-red-400">{challengeError}</p>}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowEmergencyBox(false)}
              >
                إلغاء
              </Button>
              <Button type="submit" variant="destructive" size="sm">
                تأكيد التأجيل الاضطراري
              </Button>
            </div>
          </form>
        )}
      </div>

      {/* Footer Battery Note */}
      <div className="mx-auto w-full max-w-2xl text-center text-xs text-[#64748B]">
        تتوقف مراقبة النشاط تلقائياً فور بدء التنفيذ التدريجي أو انتهاء نافذة الـ {monitoringMinutes}{' '}
        دقيقة للحفاظ على البطارية.
      </div>
    </div>
  );
};
