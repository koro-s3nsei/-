import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  BellRing,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Clock,
  FolderKanban,
  ImagePlus,
  Loader2,
  Play,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { db, enqueueSyncChange } from '../../db/dexie';
import { formatArabicDate, HORIZON_LABELS } from '../../lib/utils';
import { generateProjectBlueprintSvg } from '../../services/geminiClient';
import type { MicroStepRecord, ProjectRecord } from '../../types/models';
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
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(
    highlightedProjectId ?? null
  );
  const [generatingSvgFor, setGeneratingSvgFor] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const projects = useLiveQuery(() => db.projects.orderBy('createdAt').reverse().toArray(), []);
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

  const handleGenerateBlueprint = async (project: ProjectRecord) => {
    setGeneratingSvgFor(project.id);
    try {
      const projectTasks = (allTasks ?? [])
        .filter((t) => t.projectId === project.id)
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((t) => t.title);
      const svg = await generateProjectBlueprintSvg(project.title, projectTasks);
      await db.projects.update(project.id, {
        illustrationSvg: svg,
        updatedAt: new Date().toISOString(),
      });
    } finally {
      setGeneratingSvgFor(null);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    await db.transaction('rw', [db.projects, db.tasks, db.microSteps], async () => {
      await db.microSteps.where('projectId').equals(projectId).delete();
      await db.tasks.where('projectId').equals(projectId).delete();
      await db.projects.delete(projectId);
    });
    await enqueueSyncChange('projects', projectId, 'delete', { id: projectId });
    setConfirmDeleteId(null);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">المشاريع والخطوات المقسمة مسبقاً</h1>
          <p className="mt-1 text-sm text-[#64748B] dark:text-[#94A3B8]">
            جميع المهام والخطوات الجزئية مخزنة بالكامل في IndexedDB وجاهزة للتنفيذ التدريجي دون
            اتصال.
          </p>
        </div>

        <Button variant="primary" onClick={onNavigateCapture}>
          <Plus className="h-4 w-4" strokeWidth={1.75} />
          <span>مشروع جديد من الاستيعاب</span>
        </Button>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1 rounded-xl bg-[#EEF1F6] p-1 dark:bg-[#13161C] border border-[#E2E8F0] dark:border-[#232936] w-fit">
          {(
            [
              { id: 'all', label: 'الكل' },
              { id: 'active', label: 'النشطة' },
              { id: 'completed', label: 'المكتملة' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                filter === item.id
                  ? 'bg-white text-[#0F172A] shadow-sm dark:bg-[#1E2430] dark:text-[#F3F5F8]'
                  : 'text-[#64748B] hover:text-[#0F172A] dark:text-[#94A3B8] dark:hover:text-[#F3F5F8]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search
            className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]"
            strokeWidth={1.75}
          />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث في المشاريع..."
            className="pr-10"
          />
        </div>
      </div>

      {/* Projects List */}
      {filteredProjects.length === 0 ? (
        <Surface className="py-14 text-center">
          <FolderKanban
            className="mx-auto h-10 w-10 text-[#94A3B8] dark:text-[#475569]"
            strokeWidth={1.75}
          />
          <h2 className="mt-4 text-base font-semibold">لا توجد مشاريع مطابقة</h2>
          <p className="mt-1 text-sm text-[#64748B] dark:text-[#94A3B8]">
            ابدأ من تبويب الاستيعاب لتحويل فكرتك إلى خطوات مقسمة ومجدولة محلياً.
          </p>
          <div className="mt-5">
            <Button variant="primary" onClick={onNavigateCapture}>
              <span>الانتقال للاستيعاب</span>
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
            const nextPendingStep = projectSteps.find((s) => s.status !== 'completed');

            return (
              <Surface key={project.id} className="overflow-hidden">
                <div className="p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-[#64748B] dark:text-[#94A3B8]">
                        <span>{HORIZON_LABELS[project.horizon]}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-tabular">
                          {project.completedStepsCount}/{project.totalStepsCount} خطوات
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-tabular">
                          {project.totalEstimatedMinutes} دقيقة
                        </span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={
                            project.status === 'completed'
                              ? 'font-medium text-emerald-600 dark:text-emerald-400'
                              : 'font-medium text-blue-600 dark:text-blue-400'
                          }
                        >
                          {project.status === 'completed' ? 'مكتمل' : `${pct}% منجز`}
                        </span>
                      </div>

                      <h2 className="text-lg font-semibold tracking-tight">{project.title}</h2>
                      {project.objective && (
                        <p className="text-sm text-[#475569] dark:text-[#94A3B8]">
                          {project.objective}
                        </p>
                      )}

                      {/* Progress Bar */}
                      <div className="h-1.5 w-full max-w-md overflow-hidden rounded-full bg-[#EEF1F6] dark:bg-[#1E2430]">
                        <div
                          className={`h-full transition-all duration-300 ${
                            project.status === 'completed' ? 'bg-emerald-500' : 'bg-blue-600'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>

                    {/* Primary & Secondary Actions */}
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <Button
                        variant="primary"
                        onClick={() => onStartMicroExecution(project.id, nextPendingStep?.id)}
                        disabled={!nextPendingStep}
                      >
                        <Play className="h-4 w-4" strokeWidth={1.75} />
                        <span>
                          {nextPendingStep ? 'بدء التنفيذ التدريجي' : 'المشروع مكتمل بالكامل'}
                        </span>
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleGenerateBlueprint(project)}
                        disabled={generatingSvgFor === project.id}
                        title="توليد رسم هندسي توضيحي عند الطلب يدوياً فقط"
                      >
                        {generatingSvgFor === project.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                        ) : (
                          <ImagePlus className="h-4 w-4" strokeWidth={1.75} />
                        )}
                        <span>
                          {project.illustrationSvg ? 'تحديث المخطط' : 'توليد رسم توضيحي'}
                        </span>
                      </Button>

                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          setExpandedProjectId(isExpanded ? null : project.id)
                        }
                        aria-label={isExpanded ? 'إخفاء الخطوات' : 'عرض الخطوات'}
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
                            onClick={() => handleDeleteProject(project.id)}
                          >
                            تأكيد الحذف
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
                          <Trash2 className="h-4 w-4 text-[#64748B] hover:text-red-500" strokeWidth={1.75} />
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* On-Demand Generated Architectural Blueprint Illustration */}
                  {project.illustrationSvg && (
                    <div
                      className="mt-4 overflow-hidden rounded-xl border border-[#E2E8F0] dark:border-[#232936]"
                      dangerouslySetInnerHTML={{ __html: project.illustrationSvg }}
                    />
                  )}
                </div>

                {/* Expandable Pre-computed Tasks & Micro-Steps */}
                {isExpanded && (
                  <div className="border-t border-[#E2E8F0] bg-[#F8FAFC] p-5 dark:border-[#232936] dark:bg-[#0E1116]">
                    <div className="space-y-5">
                      {projectTasks.map((task, tIdx) => {
                        const steps = projectSteps.filter((s) => s.taskId === task.id);
                        return (
                          <div key={task.id} className="space-y-2.5">
                            <div className="flex items-center justify-between">
                              <h3 className="text-sm font-semibold">
                                {String(tIdx + 1).padStart(2, '0')}. {task.title}
                              </h3>
                              <span className="font-mono-tabular text-xs text-[#64748B] dark:text-[#94A3B8]">
                                {steps.length} خطوات جزئية
                              </span>
                            </div>

                            <div className="divide-y divide-[#E2E8F0] rounded-xl border border-[#E2E8F0] bg-white dark:divide-[#232936] dark:border-[#232936] dark:bg-[#13161C]">
                              {steps.map((step) => {
                                const isDone = step.status === 'completed';
                                return (
                                  <div
                                    key={step.id}
                                    className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                                  >
                                    <div className="flex items-start gap-3">
                                      {isDone ? (
                                        <CheckCircle2
                                          className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500"
                                          strokeWidth={1.75}
                                        />
                                      ) : (
                                        <Circle
                                          className="mt-0.5 h-4 w-4 shrink-0 text-[#94A3B8]"
                                          strokeWidth={1.75}
                                        />
                                      )}
                                      <div>
                                        <p
                                          className={`text-sm font-medium ${
                                            isDone
                                              ? 'line-through text-[#94A3B8]'
                                              : 'text-[#0F172A] dark:text-[#F3F5F8]'
                                          }`}
                                        >
                                          {step.title}
                                        </p>
                                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#64748B] dark:text-[#94A3B8]">
                                          <span className="font-mono-tabular">
                                            {step.parts.length} أجزاء متدرجة
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
                                      </div>
                                    </div>

                                    {!isDone && (
                                      <div className="flex items-center gap-2 shrink-0">
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => onTriggerStepAlarm(step, project.title)}
                                        >
                                          <BellRing className="h-3.5 w-3.5" strokeWidth={1.75} />
                                          <span>اختبار المنبه</span>
                                        </Button>
                                        <Button
                                          variant="secondary"
                                          size="sm"
                                          onClick={() => onStartMicroExecution(project.id, step.id)}
                                        >
                                          <Play className="h-3.5 w-3.5" strokeWidth={1.75} />
                                          <span>تنفيذ</span>
                                        </Button>
                                      </div>
                                    )}
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
    </div>
  );
};
