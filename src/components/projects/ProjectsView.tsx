import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertCircle,
  BellRing,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Clock,
  Download,
  FileText,
  FolderKanban,
  ImagePlus,
  Lightbulb,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import { db, enqueueSyncChange, recalculateProjectProgress } from '../../db/dexie';
import { formatArabicDate, HORIZON_LABELS } from '../../lib/utils';
import {
  downloadPngDataUrl,
  renderProjectSummaryPng,
} from '../../services/projectPngRenderer';
import type { MicroStepRecord, ProjectRecord } from '../../types/models';
import { OriginalTextModal } from '../notes/OriginalTextModal';
import { ErrorActionBanner } from '../ui/ErrorActionBanner';
import { Button, Input, Surface } from '../ui/primitives';

interface ProjectsViewProps {
  highlightedProjectId?: string | null;
  onStartMicroExecution: (projectId: string, stepId?: string) => void;
  onTriggerStepAlarm: (step: MicroStepRecord, projectTitle: string) => void;
  onNavigateCapture: () => void;
}

export const ProjectsView: React.FC<ProjectsViewProps> = ({
  highlightedProjectId,
  onStartMicroExecution,
  onTriggerStepAlarm,
  onNavigateCapture,
}) => {
  const [sectionTab, setSectionTab] = useState<'projects' | 'notes'>('projects');
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(
    highlightedProjectId ?? null
  );
  const [renderingPngFor, setRenderingPngFor] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [viewingNote, setViewingNote] = useState<{
    captureId: string;
    title?: string;
  } | null>(null);
  const [errorState, setErrorState] = useState<{
    message: string;
    onFix?: () => void;
  } | null>(null);

  const settings = useLiveQuery(() => db.appSettings.get('singleton'), []);
  const projects = useLiveQuery(() => db.projects.orderBy('createdAt').reverse().toArray(), []);
  const captures = useLiveQuery(() => db.captures.orderBy('updatedAt').reverse().toArray(), []);
  const allTasks = useLiveQuery(() => db.tasks.toArray(), []);
  const allSteps = useLiveQuery(() => db.microSteps.toArray(), []);

  const filteredProjects = useMemo(() => {
    if (!projects) return [];
    return projects.filter((p) => {
      if (filter === 'active' && p.status !== 'active') return false;
      if (filter === 'completed' && p.status !== 'completed') return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        return (
          p.title.toLowerCase().includes(q) || p.objective.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [projects, filter, searchQuery]);

  const filteredCaptures = useMemo(() => {
    if (!captures) return [];
    if (!searchQuery.trim()) return captures;
    const q = searchQuery.trim().toLowerCase();
    return captures.filter((c) => c.rawInput.toLowerCase().includes(q));
  }, [captures, searchQuery]);

  const projectTitleById = useMemo(() => {
    const map = new Map<string, string>();
    (projects ?? []).forEach((p) => map.set(p.id, p.title));
    return map;
  }, [projects]);

  const handleRenderLocalPng = async (project: ProjectRecord) => {
    setRenderingPngFor(project.id);
    setErrorState(null);
    try {
      const projectTasks = (allTasks ?? [])
        .filter((t) => t.projectId === project.id)
        .sort((a, b) => a.orderIndex - b.orderIndex);
      const projectSteps = (allSteps ?? [])
        .filter((s) => s.projectId === project.id)
        .sort((a, b) => a.orderIndex - b.orderIndex);

      const pngDataUrl = await renderProjectSummaryPng(
        project,
        projectTasks,
        projectSteps,
        settings?.themeMode ?? 'dark'
      );

      const now = new Date().toISOString();
      await db.projects.update(project.id, {
        illustrationSvg: pngDataUrl,
        updatedAt: now,
      });
      await enqueueSyncChange('projects', project.id, 'upsert', {
        ...project,
        illustrationSvg: pngDataUrl,
        updatedAt: now,
      });
    } catch (err) {
      setErrorState({
        message: err instanceof Error ? err.message : 'تعذر توليد صورة PNG محلياً.',
        onFix: () => {
          setErrorState(null);
          void handleRenderLocalPng(project);
        },
      });
    } finally {
      setRenderingPngFor(null);
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
      await recalculateProjectProgress(step.projectId);
    } catch (err) {
      setErrorState({
        message: err instanceof Error ? err.message : 'تعذر تحديث حالة الخطوة.',
        onFix: () => {
          setErrorState(null);
          void handleToggleStepDone(step);
        },
      });
    }
  };

  const handleToggleProjectCompletion = async (project: ProjectRecord) => {
    const now = new Date().toISOString();
    const nextStatus = project.status === 'completed' ? 'active' : 'completed';
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
      setErrorState({
        message: err instanceof Error ? err.message : 'تعذر تحديث حالة المشروع.',
        onFix: () => {
          setErrorState(null);
          void handleToggleProjectCompletion(project);
        },
      });
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    try {
      await db.transaction('rw', [db.projects, db.tasks, db.microSteps], async () => {
        await db.microSteps.where('projectId').equals(projectId).delete();
        await db.tasks.where('projectId').equals(projectId).delete();
        await db.projects.delete(projectId);
      });
      await enqueueSyncChange('projects', projectId, 'delete', { id: projectId });
      setConfirmDeleteId(null);
    } catch (err) {
      setErrorState({
        message: err instanceof Error ? err.message : 'تعذر حذف المشروع.',
        onFix: () => {
          setErrorState(null);
          void handleDeleteProject(projectId);
        },
      });
    }
  };

  const handleDeleteCapture = async (captureId: string) => {
    try {
      await db.captures.delete(captureId);
      await enqueueSyncChange('captures', captureId, 'delete', { id: captureId });
    } catch (err) {
      setErrorState({
        message: err instanceof Error ? err.message : 'تعذر حذف النص المحفوظ.',
        onFix: () => {
          setErrorState(null);
          void handleDeleteCapture(captureId);
        },
      });
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">المشاريع والنصوص</h1>
          <div className="flex items-center gap-1 rounded-xl border border-[#E5E7EB] bg-[#F3F4F6] p-1 dark:border-[#222630] dark:bg-[#13151B]">
            <button
              type="button"
              onClick={() => setSectionTab('projects')}
              className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                sectionTab === 'projects'
                  ? 'bg-white text-[#111318] shadow-sm dark:bg-[#1E222D] dark:text-[#F4F5F7]'
                  : 'text-[#6B7280] hover:text-[#111318] dark:text-[#9CA3AF] dark:hover:text-[#F4F5F7]'
              }`}
            >
              المشاريع ({projects?.length ?? 0})
            </button>
            <button
              type="button"
              onClick={() => setSectionTab('notes')}
              className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                sectionTab === 'notes'
                  ? 'bg-white text-[#111318] shadow-sm dark:bg-[#1E222D] dark:text-[#F4F5F7]'
                  : 'text-[#6B7280] hover:text-[#111318] dark:text-[#9CA3AF] dark:hover:text-[#F4F5F7]'
              }`}
            >
              النصوص الأصلية ({captures?.length ?? 0})
            </button>
          </div>
        </div>

        <Button variant="primary" size="sm" onClick={onNavigateCapture}>
          <Plus className="h-4 w-4" strokeWidth={1.75} />
          <span>جديد</span>
        </Button>
      </div>

      {errorState && (
        <ErrorActionBanner
          message={errorState.message}
          onApplyFix={errorState.onFix}
          onIgnore={() => setErrorState(null)}
        />
      )}

      {/* Filter & Search Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {sectionTab === 'projects' ? (
          <div className="flex w-fit items-center gap-1 rounded-xl border border-[#E5E7EB] bg-[#F3F4F6] p-1 dark:border-[#222630] dark:bg-[#13151B]">
            {(
              [
                { id: 'all', label: 'الكل' },
                { id: 'active', label: 'النشطة' },
                { id: 'completed', label: 'المنتهية' },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                className={`cursor-pointer rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors ${
                  filter === item.id
                    ? 'bg-white text-[#111318] shadow-sm dark:bg-[#1E222D] dark:text-[#F4F5F7]'
                    : 'text-[#6B7280] hover:text-[#111318] dark:text-[#9CA3AF] dark:hover:text-[#F4F5F7]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : (
          <span className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
            نصوصك المحفوظة حرفياً بدون تقسيم — جاهزة للرجوع إليها وتعديلها في أي وقت.
          </span>
        )}

        <div className="relative w-full sm:w-72">
          <Search
            className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]"
            strokeWidth={1.75}
          />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث..."
            className="pr-10"
          />
        </div>
      </div>

      {/* Section A: Saved Verbatim Original Texts */}
      {sectionTab === 'notes' ? (
        filteredCaptures.length === 0 ? (
          <Surface className="py-14 text-center">
            <FileText
              className="mx-auto h-9 w-9 text-[#9CA3AF] dark:text-[#4B5563]"
              strokeWidth={1.75}
            />
            <h2 className="mt-3 text-sm font-semibold">لا توجد نصوص أصلية محفوظة بعد</h2>
            <div className="mt-4">
              <Button variant="primary" size="sm" onClick={onNavigateCapture}>
                <span>كتابة وحفظ نص</span>
              </Button>
            </div>
          </Surface>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {filteredCaptures.map((cap) => {
              const linkedTitle = cap.convertedProjectId
                ? projectTitleById.get(cap.convertedProjectId)
                : undefined;

              return (
                <Surface key={cap.id} className="flex flex-col justify-between gap-4 p-5">
                  <div className="space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                      <span className="font-mono-tabular">
                        {new Date(cap.updatedAt).toLocaleDateString('ar-SA')}
                      </span>
                      {linkedTitle && (
                        <span className="truncate font-medium text-blue-600 dark:text-blue-400">
                          مرتبط بـ: {linkedTitle}
                        </span>
                      )}
                    </div>

                    <p className="line-clamp-4 whitespace-pre-wrap text-sm leading-relaxed text-[#111318] dark:text-[#F4F5F7]">
                      {cap.rawInput}
                    </p>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                      {cap.logicalErrors.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
                          <AlertCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
                          <span className="font-mono-tabular">
                            {cap.logicalErrors.length} ملاحظات اختيارية
                          </span>
                        </span>
                      )}
                      {cap.extraIdeas.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400">
                          <Lightbulb className="h-3.5 w-3.5" strokeWidth={1.75} />
                          <span className="font-mono-tabular">
                            {cap.extraIdeas.length} إضافات
                          </span>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 border-t border-[#E5E7EB] pt-3 dark:border-[#222630]">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() =>
                        setViewingNote({ captureId: cap.id, title: linkedTitle })
                      }
                    >
                      <BookOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
                      <span>فتح النافذة</span>
                    </Button>

                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void handleDeleteCapture(cap.id)}
                      aria-label="حذف النص"
                    >
                      <Trash2
                        className="h-4 w-4 text-[#6B7280] hover:text-red-500"
                        strokeWidth={1.75}
                      />
                    </Button>
                  </div>
                </Surface>
              );
            })}
          </div>
        )
      ) : filteredProjects.length === 0 ? (
        <Surface className="py-14 text-center">
          <FolderKanban
            className="mx-auto h-9 w-9 text-[#9CA3AF] dark:text-[#4B5563]"
            strokeWidth={1.75}
          />
          <h2 className="mt-3 text-sm font-semibold">لا توجد مشاريع مطابقة</h2>
          <div className="mt-4">
            <Button variant="primary" size="sm" onClick={onNavigateCapture}>
              <span>إنشاء من الاستيعاب</span>
            </Button>
          </div>
        </Surface>
      ) : (
        <div className="space-y-4">
          {filteredProjects.map((project) => {
            const projectTasks = (allTasks ?? [])
              .filter((t) => t.projectId === project.id)
              .sort((a, b) => a.orderIndex - b.orderIndex);
            const projectSteps = (allSteps ?? [])
              .filter((s) => s.projectId === project.id)
              .sort((a, b) => a.orderIndex - b.orderIndex);
            const pct =
              project.totalStepsCount > 0
                ? Math.round((project.completedStepsCount / project.totalStepsCount) * 100)
                : 0;
            const isExpanded = expandedProjectId === project.id;
            const isFinished = project.status === 'completed';
            const nextPendingStep = projectSteps.find((s) => s.status !== 'completed');
            const pngDataUrl = project.illustrationSvg?.startsWith('data:image/')
              ? project.illustrationSvg
              : undefined;

            return (
              <Surface key={project.id} className="overflow-hidden">
                <div className="p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                        <span>{HORIZON_LABELS[project.horizon]}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-tabular">
                          {project.completedStepsCount}/{project.totalStepsCount} خطوة
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-tabular">
                          {project.totalEstimatedMinutes} د
                        </span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={
                            isFinished
                              ? 'font-medium text-emerald-600 dark:text-emerald-400'
                              : 'font-medium text-blue-600 dark:text-blue-400'
                          }
                        >
                          {isFinished ? 'منتهٍ' : `${pct}%`}
                        </span>
                      </div>

                      <h2
                        className={`text-base font-semibold tracking-tight sm:text-lg ${
                          isFinished ? 'text-[#6B7280] dark:text-[#9CA3AF]' : ''
                        }`}
                      >
                        {project.title}
                      </h2>
                      {project.objective && (
                        <p className="text-sm text-[#6B7280] dark:text-[#9CA3AF]">
                          {project.objective}
                        </p>
                      )}

                      <div className="h-1.5 w-full max-w-md overflow-hidden rounded-full bg-[#F3F4F6] dark:bg-[#1E222D]">
                        <div
                          className={`h-full transition-all duration-300 ${
                            isFinished ? 'bg-emerald-500' : 'bg-blue-600'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <Button
                        variant={isFinished ? 'secondary' : 'primary'}
                        size="sm"
                        onClick={() =>
                          onStartMicroExecution(
                            project.id,
                            nextPendingStep?.id ?? projectSteps[0]?.id
                          )
                        }
                      >
                        <Play className="h-3.5 w-3.5" strokeWidth={1.75} />
                        <span>{isFinished ? 'فتح ومراجعة' : 'فتح التنفيذ'}</span>
                      </Button>

                      {project.sourceCaptureId && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setViewingNote({
                              captureId: project.sourceCaptureId!,
                              title: project.title,
                            })
                          }
                          title="عرض النص الأصلي المحفوظ كما كتبته دون تقسيم"
                        >
                          <BookOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
                          <span>النص الأصلي</span>
                        </Button>
                      )}

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleToggleProjectCompletion(project)}
                      >
                        {isFinished ? (
                          <>
                            <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
                            <span>إعادة فتح</span>
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                            <span>إنهاء</span>
                          </>
                        )}
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleRenderLocalPng(project)}
                        disabled={renderingPngFor === project.id}
                        title="توليد صورة PNG عالية الدقة محلياً دون استهلاك API"
                      >
                        {renderingPngFor === project.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
                        ) : (
                          <ImagePlus className="h-3.5 w-3.5" strokeWidth={1.75} />
                        )}
                        <span>{pngDataUrl ? 'تحديث PNG' : 'صورة PNG'}</span>
                      </Button>

                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setExpandedProjectId(isExpanded ? null : project.id)}
                        aria-label={isExpanded ? 'طي الخطوات' : 'عرض الخطوات'}
                      >
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4" strokeWidth={1.75} />
                        ) : (
                          <ChevronDown className="h-4 w-4" strokeWidth={1.75} />
                        )}
                      </Button>

                      {confirmDeleteId === project.id ? (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => void handleDeleteProject(project.id)}
                          >
                            حذف
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            إلغاء
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setConfirmDeleteId(project.id)}
                          aria-label="حذف المشروع"
                        >
                          <Trash2
                            className="h-4 w-4 text-[#6B7280] hover:text-red-500"
                            strokeWidth={1.75}
                          />
                        </Button>
                      )}
                    </div>
                  </div>

                  {pngDataUrl && (
                    <div className="mt-4 space-y-2">
                      <div className="overflow-hidden rounded-xl border border-[#E5E7EB] dark:border-[#222630]">
                        <img
                          src={pngDataUrl}
                          alt={`ملخص ${project.title}`}
                          className="block h-auto w-full"
                        />
                      </div>
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => downloadPngDataUrl(pngDataUrl, project.title)}
                        >
                          <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                          <span>تحميل PNG</span>
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {isExpanded && (
                  <div className="border-t border-[#E5E7EB] bg-[#FAFAFA] p-5 dark:border-[#222630] dark:bg-[#0E1015]">
                    <div className="space-y-5">
                      {projectTasks.map((task, tIdx) => {
                        const steps = projectSteps.filter((s) => s.taskId === task.id);
                        return (
                          <div key={task.id} className="space-y-2.5">
                            <div className="flex items-center justify-between">
                              <h3 className="text-sm font-semibold">
                                <span className="font-mono-tabular ml-1 text-[#9CA3AF]">
                                  {String(tIdx + 1).padStart(2, '0')}.
                                </span>
                                {task.title}
                              </h3>
                              <span className="font-mono-tabular text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                                {steps.length} خطوات
                              </span>
                            </div>

                            <div className="divide-y divide-[#E5E7EB] rounded-xl border border-[#E5E7EB] bg-white dark:divide-[#222630] dark:border-[#222630] dark:bg-[#13151B]">
                              {steps.map((step) => {
                                const isDone = step.status === 'completed';
                                return (
                                  <div
                                    key={step.id}
                                    className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                                  >
                                    <div className="flex min-w-0 flex-1 items-start gap-3">
                                      <button
                                        type="button"
                                        onClick={() => void handleToggleStepDone(step)}
                                        aria-label={isDone ? 'إلغاء الإكمال' : 'تحديد كمكتملة'}
                                        title={isDone ? 'إلغاء الإكمال' : 'تم'}
                                        className="mt-0.5 shrink-0 cursor-pointer rounded-full p-0.5 text-[#6B7280] hover:text-blue-600"
                                      >
                                        {isDone ? (
                                          <CheckCircle2
                                            className="h-4 w-4 text-emerald-500"
                                            strokeWidth={1.75}
                                          />
                                        ) : (
                                          <Circle
                                            className="h-4 w-4 text-[#9CA3AF]"
                                            strokeWidth={1.75}
                                          />
                                        )}
                                      </button>

                                      <button
                                        type="button"
                                        onClick={() => onStartMicroExecution(project.id, step.id)}
                                        className="min-w-0 flex-1 cursor-pointer text-right"
                                      >
                                        <p
                                          className={`text-sm font-medium ${
                                            isDone
                                              ? 'line-through text-[#9CA3AF]'
                                              : 'text-[#111318] hover:text-blue-600 dark:text-[#F4F5F7] dark:hover:text-blue-400'
                                          }`}
                                        >
                                          {step.title}
                                        </p>
                                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                                          <span className="font-mono-tabular">
                                            {step.parts.length} أجزاء
                                          </span>
                                          <span aria-hidden="true">·</span>
                                          <span className="font-mono-tabular">
                                            {step.durationMinutes} د
                                          </span>
                                          {step.scheduledDate && step.scheduledStartTime && (
                                            <>
                                              <span aria-hidden="true">·</span>
                                              <span className="inline-flex items-center gap-1 font-mono-tabular">
                                                <Clock className="h-3 w-3" strokeWidth={1.75} />
                                                {formatArabicDate(step.scheduledDate)}{' '}
                                                {step.scheduledStartTime}
                                              </span>
                                            </>
                                          )}
                                        </div>
                                      </button>
                                    </div>

                                    <div className="flex shrink-0 items-center gap-1.5">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => void handleToggleStepDone(step)}
                                      >
                                        <span>{isDone ? 'إلغاء الإكمال' : 'تم'}</span>
                                      </Button>
                                      {!isDone && (
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => onTriggerStepAlarm(step, project.title)}
                                          aria-label="المنبه"
                                        >
                                          <BellRing className="h-3.5 w-3.5" strokeWidth={1.75} />
                                        </Button>
                                      )}
                                      <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => onStartMicroExecution(project.id, step.id)}
                                      >
                                        <Play className="h-3.5 w-3.5" strokeWidth={1.75} />
                                        <span>{isDone ? 'قراءة' : 'تنفيذ'}</span>
                                      </Button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </Surface>
            );
          })}
        </div>
      )}

      {/* Standalone Verbatim Original Text Modal */}
      {viewingNote && (
        <OriginalTextModal
          captureId={viewingNote.captureId}
          title={viewingNote.title}
          onClose={() => setViewingNote(null)}
        />
      )}
    </div>
  );
};
