export type CaptureSourceType = 'text' | 'voice' | 'image' | 'document';
export type ProcessingEngine = 'offline-local' | (string & {});
export type ProjectHorizon = 'day' | 'week' | 'month' | 'year';
export type ProjectStatus = 'active' | 'completed' | 'paused' | 'archived';
export type StepStatus = 'pending' | 'in_progress' | 'completed';
export type CommitmentCategory = 'work' | 'study' | 'sleep' | 'personal' | 'other';
export type ThemeMode = 'dark' | 'light';
export type EmergencyChallengeType = 'math' | 'sentence';
export type MainTab = 'capture' | 'projects' | 'schedule' | 'settings';

export interface LogicalErrorSpan {
  id: string;
  originalSegment: string;
  reason: string;
  suggestedFix: string;
}

export interface CaptureRecord {
  id: string;
  sourceType: CaptureSourceType;
  rawInput: string;
  actionPoints: string[];
  logicalErrors: LogicalErrorSpan[];
  extraIdeas: string[];
  processingEngine: ProcessingEngine;
  convertedProjectId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRecord {
  id: string;
  sourceCaptureId?: string;
  title: string;
  objective: string;
  horizon: ProjectHorizon;
  status: ProjectStatus;
  illustrationSvg?: string;
  totalEstimatedMinutes: number;
  completedStepsCount: number;
  totalStepsCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskRecord {
  id: string;
  projectId: string;
  title: string;
  orderIndex: number;
  status: StepStatus;
  estimatedMinutes: number;
  createdAt: string;
  updatedAt: string;
}

export interface MicroStepRecord {
  id: string;
  projectId: string;
  taskId: string;
  title: string;
  parts: string[];
  currentPartIndex: number;
  orderIndex: number;
  durationMinutes: number;
  status: StepStatus;
  scheduledDate?: string; // YYYY-MM-DD
  scheduledStartTime?: string; // HH:MM
  scheduledEndTime?: string; // HH:MM
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FixedCommitmentRecord {
  id: string;
  label: string;
  category: CommitmentCategory;
  daysOfWeek: number[]; // 0 = Sunday .. 6 = Saturday
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  source: 'manual' | 'ocr';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FreeTimeWindow {
  date: string; // YYYY-MM-DD
  dayOfWeek: number;
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  durationMinutes: number;
}

export interface DistractionEvent {
  timestamp: string;
  detectedActivity: string;
  source: 'page-visibility' | 'window-blur' | 'android-usage-stats';
}

export interface AlarmSessionRecord {
  id: string;
  microStepId: string;
  microStepTitle: string;
  projectTitle: string;
  triggeredAt: string;
  monitoringEndsAt: string;
  startedExecutionAt?: string;
  emergencySnoozeUsed: boolean;
  emergencySnoozeReason?: string;
  distractionEvents: DistractionEvent[];
  status: 'ringing' | 'monitoring' | 'resolved' | 'snoozed' | 'expired';
}

export interface SyncQueueRecord {
  id: string;
  tableName: string;
  recordId: string;
  operation: 'upsert' | 'delete';
  payload: string;
  createdAt: string;
  synced: boolean;
}

export interface AppSettingsRecord {
  id: 'singleton';
  themeMode: ThemeMode;
  geminiModelId?: string;
  encryptedApiKey?: string;
  apiKeyIv?: string;
  apiKeyLastFour?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  lastSyncedAt?: string;
  strictMonitoringMinutes: number;
  emergencyChallengeType: EmergencyChallengeType;
  alarmVolume: number;
  androidOverlayGranted: boolean;
  androidUsageStatsGranted: boolean;
  updatedAt: string;
}

export interface IngestionResult {
  actionPoints: string[];
  logicalErrors: LogicalErrorSpan[];
  extraIdeas: string[];
  processingEngine: ProcessingEngine;
}

export interface DecomposedTaskDraft {
  title: string;
  estimatedMinutes: number;
  microSteps: Array<{
    title: string;
    durationMinutes: number;
    parts: string[];
  }>;
}

export interface ProjectDecompositionResult {
  projectTitle: string;
  objective: string;
  tasks: DecomposedTaskDraft[];
  processingEngine: ProcessingEngine;
}
