export const SUPABASE_SCHEMA_SQL = `-- ============================================================================
-- الفيلسوف مبعسس — مخطط قاعدة البيانات السحابية (Supabase PostgreSQL + RLS)
-- Offline-First Task & Focus Engine | 100% Free Tier Zero-Cost Sync Schema
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. جدول الملفات الشخصية وإعدادات المستخدم
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT 'مستخدم مبعسس',
  theme_mode TEXT NOT NULL DEFAULT 'dark' CHECK (theme_mode IN ('dark', 'light')),
  strict_monitoring_minutes INTEGER NOT NULL DEFAULT 30 CHECK (strict_monitoring_minutes BETWEEN 5 AND 120),
  emergency_challenge_type TEXT NOT NULL DEFAULT 'math' CHECK (emergency_challenge_type IN ('math', 'sentence')),
  alarm_volume NUMERIC(3,2) NOT NULL DEFAULT 0.85 CHECK (alarm_volume BETWEEN 0.10 AND 1.00),
  android_overlay_granted BOOLEAN NOT NULL DEFAULT FALSE,
  android_usage_stats_granted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. جدول الاستيعاب والتنقيح الصارم (Captures)
CREATE TABLE IF NOT EXISTS public.captures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('text', 'voice', 'image', 'document')),
  raw_input TEXT NOT NULL,
  action_points JSONB NOT NULL DEFAULT '[]'::jsonb,
  logical_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  extra_ideas JSONB NOT NULL DEFAULT '[]'::jsonb,
  processing_engine TEXT NOT NULL DEFAULT 'offline-local',
  converted_project_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- 3. جدول المشاريع (Projects)
CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_capture_id UUID REFERENCES public.captures(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  objective TEXT NOT NULL DEFAULT '',
  horizon TEXT NOT NULL DEFAULT 'week' CHECK (horizon IN ('day', 'week', 'month', 'year')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused', 'archived')),
  illustration_svg TEXT,
  total_estimated_minutes INTEGER NOT NULL DEFAULT 0,
  completed_steps_count INTEGER NOT NULL DEFAULT 0,
  total_steps_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- 4. جدول المهام الرئيسية (Tasks)
CREATE TABLE IF NOT EXISTS public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
  estimated_minutes INTEGER NOT NULL DEFAULT 25,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- 5. جدول الخطوات الجزئية المقسمة مسبقاً (Pre-computed Micro-Steps)
CREATE TABLE IF NOT EXISTS public.micro_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  parts JSONB NOT NULL DEFAULT '[]'::jsonb,
  current_part_index INTEGER NOT NULL DEFAULT 0,
  order_index INTEGER NOT NULL DEFAULT 0,
  duration_minutes INTEGER NOT NULL DEFAULT 15,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
  scheduled_date DATE,
  scheduled_start_time TEXT,
  scheduled_end_time TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- 6. جدول الالتزامات الثابتة لحساب نوافذ الفراغ الحقيقية (Fixed Commitments)
CREATE TABLE IF NOT EXISTS public.fixed_commitments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'work' CHECK (category IN ('work', 'study', 'sleep', 'personal', 'other')),
  days_of_week SMALLINT[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6],
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ocr')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- 7. جدول جلسات التنبيه الصارم وسجل كشف التشتت (Alarm & Distraction Sessions)
CREATE TABLE IF NOT EXISTS public.alarm_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  micro_step_id UUID REFERENCES public.micro_steps(id) ON DELETE SET NULL,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  monitoring_ends_at TIMESTAMPTZ NOT NULL,
  started_execution_at TIMESTAMPTZ,
  emergency_snooze_used BOOLEAN NOT NULL DEFAULT FALSE,
  emergency_snooze_reason TEXT,
  distraction_events JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing', 'monitoring', 'resolved', 'snoozed', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- الفهارس
CREATE INDEX IF NOT EXISTS idx_captures_user_updated ON public.captures(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_user_status ON public.projects(user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_project_order ON public.tasks(project_id, order_index ASC);
CREATE INDEX IF NOT EXISTS idx_micro_steps_schedule ON public.micro_steps(user_id, scheduled_date, scheduled_start_time);
CREATE INDEX IF NOT EXISTS idx_micro_steps_task_order ON public.micro_steps(task_id, order_index ASC);
CREATE INDEX IF NOT EXISTS idx_commitments_user_active ON public.fixed_commitments(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_alarm_sessions_user_time ON public.alarm_sessions(user_id, triggered_at DESC);

-- سياسات أمان الصفوف الصارمة (Row-Level Security - RLS)
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.captures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.micro_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixed_commitments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alarm_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_profiles_select_own" ON public.user_profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "user_profiles_insert_own" ON public.user_profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "user_profiles_update_own" ON public.user_profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "captures_all_own" ON public.captures FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "projects_all_own" ON public.projects FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "tasks_all_own" ON public.tasks FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "micro_steps_all_own" ON public.micro_steps FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "commitments_all_own" ON public.fixed_commitments FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "alarm_sessions_all_own" ON public.alarm_sessions FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);`;

export const ANDROID_MANIFEST_SNIPPET = `<!-- أضف هذه الصلاحيات داخل android/app/src/main/AndroidManifest.xml بعد npx cap add android -->
<uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" />
<uses-permission android:name="android.permission.PACKAGE_USAGE_STATS" tools:ignore="ProtectedPermissions" />
<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.VIBRATE" />`;
