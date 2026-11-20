import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { db } from '../db/dexie';
import type {
  AlarmSessionRecord,
  CaptureRecord,
  FixedCommitmentRecord,
  MicroStepRecord,
  ProjectRecord,
  TaskRecord,
} from '../types/models';

/**
 * Real Bi-Directional Supabase Cloud Sync Service (100% Client-Side).
 * Uses user's saved Project URL & Public Anon Key with Supabase Email/Password Auth
 * and strict RLS (auth.uid() = user_id) to synchronize Dexie.js across Desktop & Mobile.
 */

let cachedClient: SupabaseClient | null = null;
let cachedKeySignature = '';

export function getSupabaseClient(url?: string, anonKey?: string): SupabaseClient | null {
  const cleanUrl = url?.trim();
  const cleanKey = anonKey?.trim();
  if (!cleanUrl || !cleanKey) return null;

  const signature = `${cleanUrl}::${cleanKey}`;
  if (cachedClient && cachedKeySignature === signature) {
    return cachedClient;
  }

  cachedClient = createClient(cleanUrl, cleanKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  cachedKeySignature = signature;
  return cachedClient;
}

export async function getActiveSupabaseSession(
  url?: string,
  anonKey?: string
): Promise<Session | null> {
  const client = getSupabaseClient(url, anonKey);
  if (!client) return null;
  const { data, error } = await client.auth.getSession();
  if (error) return null;
  return data.session ?? null;
}

export async function signInSupabase(
  url: string,
  anonKey: string,
  email: string,
  password: string
): Promise<{ session: Session | null; error?: string }> {
  const client = getSupabaseClient(url, anonKey);
  if (!client) {
    return { session: null, error: 'أدخل Project URL و Anon Key واحفظهما أولاً.' };
  }
  const { data, error } = await client.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) {
    return { session: null, error: error.message };
  }
  return { session: data.session ?? null };
}

export async function signUpSupabase(
  url: string,
  anonKey: string,
  email: string,
  password: string
): Promise<{ session: Session | null; message?: string; error?: string }> {
  const client = getSupabaseClient(url, anonKey);
  if (!client) {
    return { session: null, error: 'أدخل Project URL و Anon Key واحفظهما أولاً.' };
  }
  const { data, error } = await client.auth.signUp({
    email: email.trim(),
    password,
  });
  if (error) {
    return { session: null, error: error.message };
  }
  if (!data.session) {
    return {
      session: null,
      message: 'تم إنشاء الحساب. تحقق من بريدك الإلكتروني لتأكيد الحساب ثم سجّل الدخول.',
    };
  }
  return {
    session: data.session,
    message: 'تم إنشاء الحساب وتسجيل الدخول بنجاح.',
  };
}

export async function signOutSupabase(url: string, anonKey: string): Promise<void> {
  const client = getSupabaseClient(url, anonKey);
  if (!client) return;
  await client.auth.signOut();
}

export interface SyncSummary {
  pushedCount: number;
  pulledCount: number;
  deletedCount: number;
  syncedAt: string;
}

function isRemoteNewer(remoteIso?: string | null, localIso?: string | null): boolean {
  if (!localIso) return true;
  if (!remoteIso) return false;
  return new Date(remoteIso).getTime() >= new Date(localIso).getTime();
}

const VALID_SYNC_TABLES = new Set([
  'captures',
  'projects',
  'tasks',
  'micro_steps',
  'fixed_commitments',
  'alarm_sessions',
]);

export async function syncWithSupabaseNow(url: string, anonKey: string): Promise<SyncSummary> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('لا يوجد اتصال بالإنترنت حالياً لتنفيذ المزامنة.');
  }

  const client = getSupabaseClient(url, anonKey);
  if (!client) {
    throw new Error('بيانات الربط مع Supabase غير مكتملة.');
  }

  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError || !sessionData.session?.user) {
    throw new Error('يجب تسجيل الدخول بحساب Supabase أولاً قبل المزامنة.');
  }

  const userId = sessionData.session.user.id;
  let pushedCount = 0;
  let pulledCount = 0;
  let deletedCount = 0;

  // 1. Apply pending deletes from local syncQueue first
  const pendingQueue = await db.syncQueue.filter((item) => !item.synced).toArray();
  const deleteItems = pendingQueue.filter(
    (q) => q.operation === 'delete' && VALID_SYNC_TABLES.has(q.tableName)
  );

  for (const delItem of deleteItems) {
    const { error } = await client
      .from(delItem.tableName)
      .delete()
      .eq('id', delItem.recordId)
      .eq('user_id', userId);
    if (error) {
      throw new Error(`فشل مزامنة الحذف في ${delItem.tableName}: ${error.message}`);
    }
    deletedCount += 1;
  }

  // 2. Read all local Dexie.js tables and push upserts in FK-safe order
  const [
    localCaptures,
    localProjects,
    localTasks,
    localSteps,
    localCommitments,
    localAlarms,
    localSettings,
  ] = await Promise.all([
    db.captures.toArray(),
    db.projects.toArray(),
    db.tasks.toArray(),
    db.microSteps.toArray(),
    db.fixedCommitments.toArray(),
    db.alarmSessions.toArray(),
    db.appSettings.get('singleton'),
  ]);

  // Upsert user_profiles
  if (localSettings) {
    await client.from('user_profiles').upsert(
      {
        id: userId,
        theme_mode: localSettings.themeMode,
        strict_monitoring_minutes: localSettings.strictMonitoringMinutes,
        emergency_challenge_type: localSettings.emergencyChallengeType,
        alarm_volume: localSettings.alarmVolume,
        android_overlay_granted: localSettings.androidOverlayGranted,
        android_usage_stats_granted: localSettings.androidUsageStatsGranted,
        updated_at: localSettings.updatedAt,
      },
      { onConflict: 'id' }
    );
  }

  if (localCaptures.length > 0) {
    const rows = localCaptures.map((c) => ({
      id: c.id,
      user_id: userId,
      source_type: c.sourceType,
      raw_input: c.rawInput,
      action_points: c.actionPoints,
      logical_errors: c.logicalErrors,
      extra_ideas: c.extraIdeas,
      processing_engine: c.processingEngine,
      converted_project_id: c.convertedProjectId ?? null,
      created_at: c.createdAt,
      updated_at: c.updatedAt,
    }));
    const { error } = await client.from('captures').upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(`فشل رفع captures: ${error.message}`);
    pushedCount += rows.length;
  }

  if (localProjects.length > 0) {
    const captureIdSet = new Set(localCaptures.map((c) => c.id));
    const rows = localProjects.map((p) => ({
      id: p.id,
      user_id: userId,
      source_capture_id:
        p.sourceCaptureId && captureIdSet.has(p.sourceCaptureId) ? p.sourceCaptureId : null,
      title: p.title,
      objective: p.objective,
      horizon: p.horizon,
      status: p.status,
      illustration_svg: p.illustrationSvg ?? null,
      total_estimated_minutes: p.totalEstimatedMinutes,
      completed_steps_count: p.completedStepsCount,
      total_steps_count: p.totalStepsCount,
      created_at: p.createdAt,
      updated_at: p.updatedAt,
    }));
    const { error } = await client.from('projects').upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(`فشل رفع projects: ${error.message}`);
    pushedCount += rows.length;
  }

  if (localTasks.length > 0) {
    const rows = localTasks.map((t) => ({
      id: t.id,
      user_id: userId,
      project_id: t.projectId,
      title: t.title,
      order_index: t.orderIndex,
      status: t.status,
      estimated_minutes: t.estimatedMinutes,
      created_at: t.createdAt,
      updated_at: t.updatedAt,
    }));
    const { error } = await client.from('tasks').upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(`فشل رفع tasks: ${error.message}`);
    pushedCount += rows.length;
  }

  if (localSteps.length > 0) {
    const rows = localSteps.map((s) => ({
      id: s.id,
      user_id: userId,
      project_id: s.projectId,
      task_id: s.taskId,
      title: s.title,
      parts: s.parts,
      current_part_index: s.currentPartIndex,
      order_index: s.orderIndex,
      duration_minutes: s.durationMinutes,
      status: s.status,
      scheduled_date: s.scheduledDate ?? null,
      scheduled_start_time: s.scheduledStartTime ?? null,
      scheduled_end_time: s.scheduledEndTime ?? null,
      completed_at: s.completedAt ?? null,
      created_at: s.createdAt,
      updated_at: s.updatedAt,
    }));
    const { error } = await client.from('micro_steps').upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(`فشل رفع micro_steps: ${error.message}`);
    pushedCount += rows.length;
  }

  if (localCommitments.length > 0) {
    const rows = localCommitments.map((c) => ({
      id: c.id,
      user_id: userId,
      label: c.label,
      category: c.category,
      days_of_week: c.daysOfWeek,
      start_time: c.startTime,
      end_time: c.endTime,
      source: c.source,
      is_active: c.isActive,
      created_at: c.createdAt,
      updated_at: c.updatedAt,
    }));
    const { error } = await client.from('fixed_commitments').upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(`فشل رفع fixed_commitments: ${error.message}`);
    pushedCount += rows.length;
  }

  if (localAlarms.length > 0) {
    const stepIdSet = new Set(localSteps.map((s) => s.id));
    const rows = localAlarms.map((a) => ({
      id: a.id,
      user_id: userId,
      micro_step_id: stepIdSet.has(a.microStepId) ? a.microStepId : null,
      triggered_at: a.triggeredAt,
      monitoring_ends_at: a.monitoringEndsAt,
      started_execution_at: a.startedExecutionAt ?? null,
      emergency_snooze_used: a.emergencySnoozeUsed,
      emergency_snooze_reason: a.emergencySnoozeReason ?? null,
      distraction_events: a.distractionEvents,
      status: a.status,
    }));
    const { error } = await client.from('alarm_sessions').upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(`فشل رفع alarm_sessions: ${error.message}`);
    pushedCount += rows.length;
  }

  // 3. Pull latest remote rows from Supabase and merge into Dexie.js (Last-Write-Wins)
  const [
    remoteCapturesRes,
    remoteProjectsRes,
    remoteTasksRes,
    remoteStepsRes,
    remoteCommitmentsRes,
    remoteAlarmsRes,
  ] = await Promise.all([
    client.from('captures').select('*').eq('user_id', userId).is('deleted_at', null),
    client.from('projects').select('*').eq('user_id', userId).is('deleted_at', null),
    client.from('tasks').select('*').eq('user_id', userId).is('deleted_at', null),
    client.from('micro_steps').select('*').eq('user_id', userId).is('deleted_at', null),
    client.from('fixed_commitments').select('*').eq('user_id', userId).is('deleted_at', null),
    client.from('alarm_sessions').select('*').eq('user_id', userId),
  ]);

  if (remoteCapturesRes.error) throw new Error(remoteCapturesRes.error.message);
  if (remoteProjectsRes.error) throw new Error(remoteProjectsRes.error.message);
  if (remoteTasksRes.error) throw new Error(remoteTasksRes.error.message);
  if (remoteStepsRes.error) throw new Error(remoteStepsRes.error.message);
  if (remoteCommitmentsRes.error) throw new Error(remoteCommitmentsRes.error.message);
  if (remoteAlarmsRes.error) throw new Error(remoteAlarmsRes.error.message);

  const localCaptureMap = new Map(localCaptures.map((r) => [r.id, r]));
  const localProjectMap = new Map(localProjects.map((r) => [r.id, r]));
  const localTaskMap = new Map(localTasks.map((r) => [r.id, r]));
  const localStepMap = new Map(localSteps.map((r) => [r.id, r]));
  const localCommitmentMap = new Map(localCommitments.map((r) => [r.id, r]));
  const localAlarmMap = new Map(localAlarms.map((r) => [r.id, r]));

  const capturesToPut: CaptureRecord[] = [];
  for (const r of remoteCapturesRes.data ?? []) {
    const existing = localCaptureMap.get(r.id);
    if (!existing || isRemoteNewer(r.updated_at, existing.updatedAt)) {
      capturesToPut.push({
        id: r.id,
        sourceType: r.source_type,
        rawInput: r.raw_input,
        actionPoints: Array.isArray(r.action_points) ? r.action_points : [],
        logicalErrors: Array.isArray(r.logical_errors) ? r.logical_errors : [],
        extraIdeas: Array.isArray(r.extra_ideas) ? r.extra_ideas : [],
        processingEngine: r.processing_engine ?? 'offline-local',
        convertedProjectId: r.converted_project_id ?? undefined,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      });
    }
  }

  const projectsToPut: ProjectRecord[] = [];
  for (const r of remoteProjectsRes.data ?? []) {
    const existing = localProjectMap.get(r.id);
    if (!existing || isRemoteNewer(r.updated_at, existing.updatedAt)) {
      projectsToPut.push({
        id: r.id,
        sourceCaptureId: r.source_capture_id ?? undefined,
        title: r.title,
        objective: r.objective ?? '',
        horizon: r.horizon,
        status: r.status,
        illustrationSvg: r.illustration_svg ?? undefined,
        totalEstimatedMinutes: Number(r.total_estimated_minutes) || 0,
        completedStepsCount: Number(r.completed_steps_count) || 0,
        totalStepsCount: Number(r.total_steps_count) || 0,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      });
    }
  }

  const tasksToPut: TaskRecord[] = [];
  for (const r of remoteTasksRes.data ?? []) {
    const existing = localTaskMap.get(r.id);
    if (!existing || isRemoteNewer(r.updated_at, existing.updatedAt)) {
      tasksToPut.push({
        id: r.id,
        projectId: r.project_id,
        title: r.title,
        orderIndex: Number(r.order_index) || 0,
        status: r.status,
        estimatedMinutes: Number(r.estimated_minutes) || 25,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      });
    }
  }

  const stepsToPut: MicroStepRecord[] = [];
  for (const r of remoteStepsRes.data ?? []) {
    const existing = localStepMap.get(r.id);
    if (!existing || isRemoteNewer(r.updated_at, existing.updatedAt)) {
      stepsToPut.push({
        id: r.id,
        projectId: r.project_id,
        taskId: r.task_id,
        title: r.title,
        parts: Array.isArray(r.parts) ? r.parts : [],
        currentPartIndex: Number(r.current_part_index) || 0,
        orderIndex: Number(r.order_index) || 0,
        durationMinutes: Number(r.duration_minutes) || 15,
        status: r.status,
        scheduledDate: r.scheduled_date ?? undefined,
        scheduledStartTime: r.scheduled_start_time ?? undefined,
        scheduledEndTime: r.scheduled_end_time ?? undefined,
        completedAt: r.completed_at ?? undefined,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      });
    }
  }

  const commitmentsToPut: FixedCommitmentRecord[] = [];
  for (const r of remoteCommitmentsRes.data ?? []) {
    const existing = localCommitmentMap.get(r.id);
    if (!existing || isRemoteNewer(r.updated_at, existing.updatedAt)) {
      commitmentsToPut.push({
        id: r.id,
        label: r.label,
        category: r.category,
        daysOfWeek: Array.isArray(r.days_of_week) ? r.days_of_week : [0, 1, 2, 3, 4],
        startTime: r.start_time,
        endTime: r.end_time,
        source: r.source ?? 'manual',
        isActive: Boolean(r.is_active),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      });
    }
  }

  const alarmsToPut: AlarmSessionRecord[] = [];
  for (const r of remoteAlarmsRes.data ?? []) {
    if (!localAlarmMap.has(r.id)) {
      alarmsToPut.push({
        id: r.id,
        microStepId: r.micro_step_id ?? '',
        microStepTitle: 'جلسة تنبيه متزامنة',
        projectTitle: 'مشروع متزامن',
        triggeredAt: r.triggered_at,
        monitoringEndsAt: r.monitoring_ends_at,
        startedExecutionAt: r.started_execution_at ?? undefined,
        emergencySnoozeUsed: Boolean(r.emergency_snooze_used),
        emergencySnoozeReason: r.emergency_snooze_reason ?? undefined,
        distractionEvents: Array.isArray(r.distraction_events) ? r.distraction_events : [],
        status: r.status,
      });
    }
  }

  const syncedAt = new Date().toISOString();

  await db.transaction(
    'rw',
    [
      db.captures,
      db.projects,
      db.tasks,
      db.microSteps,
      db.fixedCommitments,
      db.alarmSessions,
      db.syncQueue,
      db.appSettings,
    ],
    async () => {
      if (capturesToPut.length > 0) await db.captures.bulkPut(capturesToPut);
      if (projectsToPut.length > 0) await db.projects.bulkPut(projectsToPut);
      if (tasksToPut.length > 0) await db.tasks.bulkPut(tasksToPut);
      if (stepsToPut.length > 0) await db.microSteps.bulkPut(stepsToPut);
      if (commitmentsToPut.length > 0) await db.fixedCommitments.bulkPut(commitmentsToPut);
      if (alarmsToPut.length > 0) await db.alarmSessions.bulkPut(alarmsToPut);

      if (pendingQueue.length > 0) {
        await db.syncQueue.bulkPut(pendingQueue.map((q) => ({ ...q, synced: true })));
      }

      const currentSettings = await db.appSettings.get('singleton');
      if (currentSettings) {
        await db.appSettings.put({
          ...currentSettings,
          lastSyncedAt: syncedAt,
          updatedAt: syncedAt,
        });
      }
    }
  );

  pulledCount =
    capturesToPut.length +
    projectsToPut.length +
    tasksToPut.length +
    stepsToPut.length +
    commitmentsToPut.length +
    alarmsToPut.length;

  return {
    pushedCount,
    pulledCount,
    deletedCount,
    syncedAt,
  };
}
