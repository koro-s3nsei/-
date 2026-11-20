import Dexie, { type EntityTable } from 'dexie';
import type {
  AlarmSessionRecord,
  AppSettingsRecord,
  CaptureRecord,
  FixedCommitmentRecord,
  MicroStepRecord,
  ProjectRecord,
  SyncQueueRecord,
  TaskRecord,
} from '../types/models';
import { addDaysToISODate, generateId, toISODate } from '../lib/utils';

export class MubasisFocusDB extends Dexie {
  captures!: EntityTable<CaptureRecord, 'id'>;
  projects!: EntityTable<ProjectRecord, 'id'>;
  tasks!: EntityTable<TaskRecord, 'id'>;
  microSteps!: EntityTable<MicroStepRecord, 'id'>;
  fixedCommitments!: EntityTable<FixedCommitmentRecord, 'id'>;
  alarmSessions!: EntityTable<AlarmSessionRecord, 'id'>;
  syncQueue!: EntityTable<SyncQueueRecord, 'id'>;
  appSettings!: EntityTable<AppSettingsRecord, 'id'>;

  constructor() {
    super('AlfaylasoufMubasisFocusDB');

    this.version(1).stores({
      captures: 'id, sourceType, processingEngine, convertedProjectId, createdAt, updatedAt',
      projects: 'id, sourceCaptureId, horizon, status, createdAt, updatedAt',
      tasks: 'id, projectId, orderIndex, status, updatedAt',
      microSteps:
        'id, projectId, taskId, orderIndex, status, scheduledDate, [scheduledDate+scheduledStartTime], updatedAt',
      fixedCommitments: 'id, category, isActive, source, updatedAt',
      alarmSessions: 'id, microStepId, status, triggeredAt',
      syncQueue: 'id, tableName, recordId, synced, createdAt',
      appSettings: 'id, updatedAt',
    });
  }
}

export const db = new MubasisFocusDB();

export const DEFAULT_SETTINGS: AppSettingsRecord = {
  id: 'singleton',
  themeMode: 'dark',
  geminiModelId: 'gemini-2.5-flash',
  strictMonitoringMinutes: 30,
  emergencyChallengeType: 'math',
  alarmVolume: 0.85,
  androidOverlayGranted: false,
  androidUsageStatsGranted: false,
  updatedAt: new Date().toISOString(),
};

export async function enqueueSyncChange(
  tableName: string,
  recordId: string,
  operation: 'upsert' | 'delete',
  payload: unknown
): Promise<void> {
  await db.syncQueue.put({
    id: generateId(),
    tableName,
    recordId,
    operation,
    payload: JSON.stringify(payload),
    createdAt: new Date().toISOString(),
    synced: false,
  });
}

export async function ensureInitializedDatabase(): Promise<void> {
  const existingSettings = await db.appSettings.get('singleton');
  if (!existingSettings) {
    await db.appSettings.put({
      ...DEFAULT_SETTINGS,
      updatedAt: new Date().toISOString(),
    });
  }

  const commitmentCount = await db.fixedCommitments.count();
  const projectCount = await db.projects.count();

  if (commitmentCount === 0 && projectCount === 0) {
    const now = new Date();
    const nowIso = now.toISOString();
    const todayIso = toISODate(now);
    const tomorrowIso = addDaysToISODate(now, 1);

    const defaultCommitments: FixedCommitmentRecord[] = [
      {
        id: generateId(),
        label: 'النوم الأساسي',
        category: 'sleep',
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startTime: '00:00',
        endTime: '06:30',
        source: 'manual',
        isActive: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: generateId(),
        label: 'الدوام الرسمي / الدراسة',
        category: 'work',
        daysOfWeek: [0, 1, 2, 3, 4],
        startTime: '08:30',
        endTime: '15:30',
        source: 'manual',
        isActive: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: generateId(),
        label: 'استراحة الغداء والالتزامات اليومية',
        category: 'personal',
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startTime: '15:30',
        endTime: '17:00',
        source: 'manual',
        isActive: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ];

    const projectId = generateId();
    const task1Id = generateId();
    const task2Id = generateId();

    const sampleProject: ProjectRecord = {
      id: projectId,
      title: 'إطلاق النسخة الأولى من نظام الإنجاز المحلي',
      objective: 'تجهيز البنية المحلية واختبار التدفق الكامل من الاستيعاب حتى التنفيذ التدريجي.',
      horizon: 'week',
      status: 'active',
      totalEstimatedMinutes: 75,
      completedStepsCount: 0,
      totalStepsCount: 3,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const sampleTasks: TaskRecord[] = [
      {
        id: task1Id,
        projectId,
        title: 'ضبط جدول الالتزامات ونوافذ الفراغ',
        orderIndex: 0,
        status: 'pending',
        estimatedMinutes: 30,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: task2Id,
        projectId,
        title: 'تنفيذ أول جلسة تركيز تدريجي مغلقة',
        orderIndex: 1,
        status: 'pending',
        estimatedMinutes: 45,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ];

    const sampleSteps: MicroStepRecord[] = [
      {
        id: generateId(),
        projectId,
        taskId: task1Id,
        title: 'مراجعة أوقات الدوام الثابتة وتثبيت نوافذ الفراغ المسائية',
        parts: [
          'افتح تبويب الجدول وتأكد من دقة ساعات العمل أو الدراسة الثابتة لهذا الأسبوع.',
          'أضف أي التزامات متكررة ناقصة (مثل المواصلات أو التدريب) لتجنب تضارب المواعيد.',
          'اضغط زر إعادة التوزيع الذكي للتحقق من وجود نافذة فراغ حقيقية واحدة على الأقل اليوم.',
        ],
        currentPartIndex: 0,
        orderIndex: 0,
        durationMinutes: 20,
        status: 'pending',
        scheduledDate: todayIso,
        scheduledStartTime: '17:15',
        scheduledEndTime: '17:35',
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: generateId(),
        projectId,
        taskId: task1Id,
        title: 'تفعيل اختبار المنبه الصارم والتحقق من مستوى الصوت',
        parts: [
          'انتقل إلى الإعدادات وتحقق من اختيار نوع تحدي الطوارئ المفضل (معادلة رياضية أو جملة تأكيد).',
          'أطلق تجربة المنبه الصارم للتأكد من عمل التنبيه الصوتي وكشف مغادرة التبويب.',
        ],
        currentPartIndex: 0,
        orderIndex: 1,
        durationMinutes: 10,
        status: 'pending',
        scheduledDate: todayIso,
        scheduledStartTime: '18:00',
        scheduledEndTime: '18:10',
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: generateId(),
        projectId,
        taskId: task2Id,
        title: 'إنجاز أول مشروع فعلي عبر محرك الاستيعاب الصارم',
        parts: [
          'اكتب أو سجّل صوتياً فكرة مشروعك الحقيقي في تبويب الاستيعاب دون ترتيب مسبق.',
          'راجع أي أخطاء منطقية مظللة بالأحمر وصححها قبل الاعتماد.',
          'اعتمد المشروع لتقسيم خطواته مسبقاً في IndexedDB وابدأ الجزء الأول فوراً.',
        ],
        currentPartIndex: 0,
        orderIndex: 2,
        durationMinutes: 45,
        status: 'pending',
        scheduledDate: tomorrowIso,
        scheduledStartTime: '17:15',
        scheduledEndTime: '18:00',
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ];

    await db.transaction(
      'rw',
      [db.fixedCommitments, db.projects, db.tasks, db.microSteps],
      async () => {
        await db.fixedCommitments.bulkAdd(defaultCommitments);
        await db.projects.add(sampleProject);
        await db.tasks.bulkAdd(sampleTasks);
        await db.microSteps.bulkAdd(sampleSteps);
      }
    );
  }
}

export async function recalculateProjectProgress(projectId: string): Promise<void> {
  const steps = await db.microSteps.where('projectId').equals(projectId).toArray();
  const totalStepsCount = steps.length;
  const completedStepsCount = steps.filter((s) => s.status === 'completed').length;
  const totalEstimatedMinutes = steps.reduce((acc, s) => acc + s.durationMinutes, 0);
  const status =
    totalStepsCount > 0 && completedStepsCount === totalStepsCount ? 'completed' : 'active';

  await db.projects.update(projectId, {
    totalStepsCount,
    completedStepsCount,
    totalEstimatedMinutes,
    status,
    updatedAt: new Date().toISOString(),
  });

  // Update each parent task status
  const taskIds = Array.from(new Set(steps.map((s) => s.taskId)));
  for (const taskId of taskIds) {
    const taskSteps = steps.filter((s) => s.taskId === taskId);
    const allDone = taskSteps.length > 0 && taskSteps.every((s) => s.status === 'completed');
    const anyInProgress = taskSteps.some(
      (s) => s.status === 'in_progress' || s.status === 'completed'
    );
    await db.tasks.update(taskId, {
      status: allDone ? 'completed' : anyInProgress ? 'in_progress' : 'pending',
      updatedAt: new Date().toISOString(),
    });
  }
}

export async function exportDatabaseToJson(): Promise<string> {
  const [captures, projects, tasks, microSteps, fixedCommitments, alarmSessions] =
    await Promise.all([
      db.captures.toArray(),
      db.projects.toArray(),
      db.tasks.toArray(),
      db.microSteps.toArray(),
      db.fixedCommitments.toArray(),
      db.alarmSessions.toArray(),
    ]);

  return JSON.stringify(
    {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      app: 'الفيلسوف مبعسس',
      data: {
        captures,
        projects,
        tasks,
        microSteps,
        fixedCommitments,
        alarmSessions,
      },
    },
    null,
    2
  );
}

export async function importDatabaseFromJson(rawJson: string): Promise<{
  projectsCount: number;
  stepsCount: number;
}> {
  const parsed = JSON.parse(rawJson);
  const data = parsed?.data;
  if (!data || !Array.isArray(data.projects) || !Array.isArray(data.microSteps)) {
    throw new Error('صيغة ملف النسخ الاحتياطي غير صالحة.');
  }

  await db.transaction(
    'rw',
    [db.captures, db.projects, db.tasks, db.microSteps, db.fixedCommitments, db.alarmSessions],
    async () => {
      if (Array.isArray(data.captures)) await db.captures.bulkPut(data.captures);
      if (Array.isArray(data.projects)) await db.projects.bulkPut(data.projects);
      if (Array.isArray(data.tasks)) await db.tasks.bulkPut(data.tasks);
      if (Array.isArray(data.microSteps)) await db.microSteps.bulkPut(data.microSteps);
      if (Array.isArray(data.fixedCommitments)) {
        await db.fixedCommitments.bulkPut(data.fixedCommitments);
      }
      if (Array.isArray(data.alarmSessions)) await db.alarmSessions.bulkPut(data.alarmSessions);
    }
  );

  return {
    projectsCount: data.projects.length,
    stepsCount: data.microSteps.length,
  };
}
