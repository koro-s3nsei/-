import React, { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  BellRing,
  CalendarClock,
  FolderKanban,
  Inbox,
  Moon,
  Settings,
  Sun,
} from 'lucide-react';
import { FocusAlarmOverlay } from './components/alarm/FocusAlarmOverlay';
import { CaptureView } from './components/capture/CaptureView';
import { MicroExecutionModal } from './components/execution/MicroExecutionModal';
import { ProjectsView } from './components/projects/ProjectsView';
import { OfflineIndicator, PWAInstallButton } from './components/pwa/PWAInstallButton';
import { ScheduleView } from './components/schedule/ScheduleView';
import { SettingsView } from './components/settings/SettingsView';
import { db, DEFAULT_SETTINGS, ensureInitializedDatabase } from './db/dexie';
import { toISODate } from './lib/utils';
import type { MainTab, MicroStepRecord, ThemeMode } from './types/models';

const NAV_TABS: Array<{
  id: MainTab;
  label: string;
  icon: React.FC<{ className?: string; strokeWidth?: number }>;
}> = [
  { id: 'capture', label: 'الاستيعاب', icon: Inbox },
  { id: 'projects', label: 'المشاريع', icon: FolderKanban },
  { id: 'schedule', label: 'الجدول', icon: CalendarClock },
  { id: 'settings', label: 'الإعدادات', icon: Settings },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<MainTab>('capture');
  const [highlightedProjectId, setHighlightedProjectId] = useState<string | null>(null);
  const [executionTarget, setExecutionTarget] = useState<{
    projectId: string;
    stepId?: string;
  } | null>(null);
  const [activeAlarm, setActiveAlarm] = useState<{
    step: MicroStepRecord;
    projectTitle: string;
  } | null>(null);

  const triggeredStepIdsRef = useRef<Set<string>>(new Set());

  const settings = useLiveQuery(() => db.appSettings.get('singleton'), []) ?? DEFAULT_SETTINGS;
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const pendingSteps = useLiveQuery(
    () => db.microSteps.where('status').notEqual('completed').toArray(),
    []
  );

  useEffect(() => {
    void ensureInitializedDatabase();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (settings.themeMode === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.setAttribute('content', settings.themeMode === 'dark' ? '#0C0D10' : '#FAFAFA');
    }
  }, [settings.themeMode]);

  useEffect(() => {
    const checkDueAlarms = () => {
      if (activeAlarm || executionTarget || !pendingSteps || pendingSteps.length === 0) return;

      const now = new Date();
      const todayIso = toISODate(now);
      const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(
        now.getMinutes()
      ).padStart(2, '0')}`;

      const dueStep = pendingSteps.find(
        (s) =>
          s.scheduledDate === todayIso &&
          s.scheduledStartTime === currentHHMM &&
          !triggeredStepIdsRef.current.has(`${s.id}-${currentHHMM}`)
      );

      if (dueStep) {
        triggeredStepIdsRef.current.add(`${dueStep.id}-${currentHHMM}`);
        const proj = (projects ?? []).find((p) => p.id === dueStep.projectId);
        setActiveAlarm({
          step: dueStep,
          projectTitle: proj?.title ?? 'مشروع نشط',
        });
      }
    };

    const intervalId = window.setInterval(checkDueAlarms, 15000);
    return () => window.clearInterval(intervalId);
  }, [activeAlarm, executionTarget, pendingSteps, projects]);

  const handleToggleThemeQuick = async () => {
    const nextMode: ThemeMode = settings.themeMode === 'dark' ? 'light' : 'dark';
    await db.appSettings.put({
      ...settings,
      id: 'singleton',
      themeMode: nextMode,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleTriggerQuickTestAlarm = () => {
    const step = pendingSteps?.[0] ?? {
      id: 'demo-alarm-step',
      projectId: projects?.[0]?.id ?? 'demo',
      taskId: 'demo',
      title: 'إنجاز الجزء الأول من مهمتك المجدولة الآن',
      parts: ['افتح ملف المشروع وابدأ بأول خطوة عملية فوراً.'],
      currentPartIndex: 0,
      orderIndex: 0,
      durationMinutes: 20,
      status: 'pending' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const projectTitle =
      (projects ?? []).find((p) => p.id === step.projectId)?.title ?? 'الفيلسوف مبعسس';
    setActiveAlarm({ step, projectTitle });
  };

  return (
    <div className="min-h-dvh bg-[#FAFAFA] text-[#111318] dark:bg-[#0C0D10] dark:text-[#F4F5F7]">
      {/* Desktop RTL Sidebar */}
      <aside className="fixed inset-y-0 right-0 z-30 hidden w-60 flex-col justify-between border-l border-[#E5E7EB] bg-white p-4 lg:flex dark:border-[#222630] dark:bg-[#101218]">
        <div className="space-y-6">
          <div className="flex items-center gap-3 px-2 py-1">
            <img
              src="./assets/aistudio/Gemini_Generated_Image_x73ws7x73ws7x73w_dafeee7b.jfif"
              alt="الفيلسوف مبعسس"
              referrerPolicy="no-referrer"
              className="h-9 w-9 shrink-0 rounded-xl border border-[#E5E7EB] object-cover dark:border-[#222630]"
            />
            <span className="truncate whitespace-nowrap text-sm font-bold tracking-tight">
              الفيلسوف مبعسس
            </span>
          </div>

          <nav className="space-y-1" aria-label="التنقل الرئيسي">
            {NAV_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex min-h-[42px] w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : 'text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#111318] dark:text-[#9CA3AF] dark:hover:bg-[#191D26] dark:hover:text-[#F4F5F7]'
                  }`}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
                  <span className="whitespace-nowrap">{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="space-y-1.5 border-t border-[#E5E7EB] pt-3 dark:border-[#222630]">
          <button
            type="button"
            onClick={handleTriggerQuickTestAlarm}
            className="flex min-h-[40px] w-full cursor-pointer items-center gap-2 rounded-xl border border-[#E5E7EB] px-3 text-xs font-medium text-[#4B5563] transition-colors hover:bg-[#F3F4F6] dark:border-[#222630] dark:text-[#9CA3AF] dark:hover:bg-[#191D26]"
          >
            <BellRing className="h-4 w-4 text-red-500" strokeWidth={1.75} />
            <span>تجربة المنبه</span>
          </button>

          <button
            type="button"
            onClick={() => void handleToggleThemeQuick()}
            className="flex min-h-[40px] w-full cursor-pointer items-center gap-2 rounded-xl px-3 text-xs font-medium text-[#4B5563] transition-colors hover:bg-[#F3F4F6] dark:text-[#9CA3AF] dark:hover:bg-[#191D26]"
          >
            {settings.themeMode === 'dark' ? (
              <Sun className="h-4 w-4" strokeWidth={1.75} />
            ) : (
              <Moon className="h-4 w-4" strokeWidth={1.75} />
            )}
            <span>{settings.themeMode === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'}</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-h-dvh flex-col lg:pr-60">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-[#E5E7EB] bg-white/90 px-4 backdrop-blur-md lg:px-8 dark:border-[#222630] dark:bg-[#0C0D10]/90">
          <div className="flex items-center gap-2.5 lg:hidden">
            <img
              src="./assets/aistudio/Gemini_Generated_Image_x73ws7x73ws7x73w_dafeee7b.jfif"
              alt="الفيلسوف مبعسس"
              referrerPolicy="no-referrer"
              className="h-8 w-8 shrink-0 rounded-lg border border-[#E5E7EB] object-cover dark:border-[#222630]"
            />
            <span className="whitespace-nowrap text-sm font-bold tracking-tight">
              الفيلسوف مبعسس
            </span>
          </div>

          <div className="hidden text-sm font-medium text-[#6B7280] lg:block dark:text-[#9CA3AF]">
            {NAV_TABS.find((t) => t.id === activeTab)?.label}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <PWAInstallButton compact />
            <button
              type="button"
              onClick={() => void handleToggleThemeQuick()}
              aria-label="تبديل السمة"
              className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-[#E5E7EB] text-[#4B5563] hover:bg-[#F3F4F6] lg:hidden dark:border-[#222630] dark:text-[#9CA3AF] dark:hover:bg-[#191D26]"
            >
              {settings.themeMode === 'dark' ? (
                <Sun className="h-4 w-4" strokeWidth={1.75} />
              ) : (
                <Moon className="h-4 w-4" strokeWidth={1.75} />
              )}
            </button>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 pb-24 lg:px-8 lg:py-8 lg:pb-10">
          {activeTab === 'capture' && (
            <CaptureView
              onProjectCreated={(projectId) => {
                setHighlightedProjectId(projectId);
                setActiveTab('projects');
              }}
            />
          )}

          {activeTab === 'projects' && (
            <ProjectsView
              highlightedProjectId={highlightedProjectId}
              onStartMicroExecution={(projectId, stepId) =>
                setExecutionTarget({ projectId, stepId })
              }
              onTriggerStepAlarm={(step, projectTitle) =>
                setActiveAlarm({ step, projectTitle })
              }
              onNavigateCapture={() => setActiveTab('capture')}
            />
          )}

          {activeTab === 'schedule' && (
            <ScheduleView
              onStartMicroExecution={(projectId, stepId) =>
                setExecutionTarget({ projectId, stepId })
              }
              onTriggerStepAlarm={(step, projectTitle) =>
                setActiveAlarm({ step, projectTitle })
              }
            />
          )}

          {activeTab === 'settings' && (
            <SettingsView
              onThemeChange={() => {}}
              onTriggerTestAlarm={handleTriggerQuickTestAlarm}
            />
          )}
        </main>
      </div>

      {/* Mobile Bottom Tab Bar */}
      <nav
        aria-label="شريط التنقل السفلي"
        className="pb-safe fixed bottom-0 left-0 right-0 z-30 border-t border-[#E5E7EB] bg-white/95 backdrop-blur-md lg:hidden dark:border-[#222630] dark:bg-[#101218]/95"
      >
        <div className="grid h-16 grid-cols-4 items-center">
          {NAV_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex min-h-[48px] cursor-pointer flex-col items-center justify-center gap-1 transition-colors ${
                  isActive
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-[#6B7280] dark:text-[#9CA3AF]'
                }`}
              >
                <Icon className="h-5 w-5" strokeWidth={1.75} />
                <span className="whitespace-nowrap text-[11px] font-medium">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {executionTarget && (
        <MicroExecutionModal
          projectId={executionTarget.projectId}
          initialStepId={executionTarget.stepId}
          onClose={() => setExecutionTarget(null)}
        />
      )}

      {activeAlarm && (
        <FocusAlarmOverlay
          step={activeAlarm.step}
          projectTitle={activeAlarm.projectTitle}
          monitoringMinutes={settings.strictMonitoringMinutes}
          challengeType={settings.emergencyChallengeType}
          alarmVolume={settings.alarmVolume}
          onStartExecutionNow={(projectId, stepId) => {
            setActiveAlarm(null);
            if (stepId !== 'demo-alarm-step') {
              setExecutionTarget({ projectId, stepId });
            }
          }}
          onEmergencySnoozeGranted={() => setActiveAlarm(null)}
        />
      )}

      <OfflineIndicator />
    </div>
  );
}
