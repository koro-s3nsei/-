import React, { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  BellRing,
  Check,
  ChevronDown,
  ChevronUp,
  Cloud,
  Code2,
  Copy,
  Database,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  Mic,
  Moon,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sun,
  Trash2,
  Upload,
  UserPlus,
} from 'lucide-react';
import {
  db,
  DEFAULT_SETTINGS,
  exportDatabaseToJson,
  importDatabaseFromJson,
} from '../../db/dexie';
import { ANDROID_MANIFEST_SNIPPET, SUPABASE_SCHEMA_SQL } from '../../db/supabaseSchema';
import { encryptLocalSecret } from '../../lib/cryptoVault';
import {
  checkPermissionsStatus,
  fireImmediateTestNotification,
  getRuntimeEnvironmentLabel,
  isNativeCapacitorPlatform,
  requestAlarmNotificationPermission,
  requestMicrophonePermission,
} from '../../native/capacitorBridge';
import { DEFAULT_GEMINI_MODEL_ID, testGeminiConnection } from '../../services/geminiClient';
import {
  getActiveSupabaseSession,
  signInSupabase,
  signOutSupabase,
  signUpSupabase,
  syncWithSupabaseNow,
} from '../../services/supabaseSyncService';
import type { EmergencyChallengeType, ThemeMode } from '../../types/models';
import { PWAInstallButton } from '../pwa/PWAInstallButton';
import { ErrorActionBanner } from '../ui/ErrorActionBanner';
import { Button, Input, Surface } from '../ui/primitives';

interface SettingsViewProps {
  onThemeChange: (mode: ThemeMode) => void;
  onTriggerTestAlarm: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  onThemeChange,
  onTriggerTestAlarm,
}) => {
  const settings = useLiveQuery(() => db.appSettings.get('singleton'), []) ?? DEFAULT_SETTINGS;
  const projectsCount = useLiveQuery(() => db.projects.count(), []) ?? 0;
  const stepsCount = useLiveQuery(() => db.microSteps.count(), []) ?? 0;
  const pendingSyncCount =
    useLiveQuery(() => db.syncQueue.filter((q) => !q.synced).count(), []) ?? 0;

  const isNativeApk = isNativeCapacitorPlatform();

  // BYOK Gemini API key & Model ID state
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [modelIdDraft, setModelIdDraft] = useState(
    settings.geminiModelId ?? DEFAULT_GEMINI_MODEL_ID
  );
  const [showKey, setShowKey] = useState(false);
  const [isTestingKey, setIsTestingKey] = useState(false);
  const [keySuccessMsg, setKeySuccessMsg] = useState<string | null>(null);
  const [keyErrorMsg, setKeyErrorMsg] = useState<string | null>(null);

  // Supabase connection + Auth + Sync state
  const [supabaseUrl, setSupabaseUrl] = useState(settings.supabaseUrl ?? '');
  const [supabaseAnonKey, setSupabaseAnonKey] = useState(settings.supabaseAnonKey ?? '');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [loggedInEmail, setLoggedInEmail] = useState<string | null>(null);
  const [isAuthBusy, setIsAuthBusy] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncSuccessMsg, setSyncSuccessMsg] = useState<string | null>(null);
  const [syncErrorMsg, setSyncErrorMsg] = useState<string | null>(null);

  // Real runtime permissions state (Notifications & Microphone)
  const [notifGranted, setNotifGranted] = useState(settings.androidOverlayGranted);
  const [micGranted, setMicGranted] = useState(settings.androidUsageStatsGranted);
  const [permissionSuccessMsg, setPermissionSuccessMsg] = useState<string | null>(null);
  const [permissionError, setPermissionError] = useState<{
    message: string;
    onFix: () => void;
  } | null>(null);

  // Developer Tools Accordion (collapsed by default)
  const [devToolsOpen, setDevToolsOpen] = useState(false);
  const [copiedTarget, setCopiedTarget] = useState<'sql' | 'manifest' | null>(null);

  // Backup feedback
  const [backupSuccessMsg, setBackupSuccessMsg] = useState<string | null>(null);
  const [backupErrorMsg, setBackupErrorMsg] = useState<string | null>(null);
  const importFileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (settings.geminiModelId) {
      setModelIdDraft(settings.geminiModelId);
    }
  }, [settings.geminiModelId]);

  useEffect(() => {
    if (settings.supabaseUrl !== undefined) {
      setSupabaseUrl((prev) => (prev ? prev : settings.supabaseUrl ?? ''));
    }
    if (settings.supabaseAnonKey !== undefined) {
      setSupabaseAnonKey((prev) => (prev ? prev : settings.supabaseAnonKey ?? ''));
    }
  }, [settings.supabaseUrl, settings.supabaseAnonKey]);

  // Query real OS permissions on mount
  useEffect(() => {
    let mounted = true;
    void checkPermissionsStatus().then((status) => {
      if (!mounted) return;
      setNotifGranted(status.notificationsGranted);
      setMicGranted(status.microphoneGranted);
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Check active Supabase session
  useEffect(() => {
    let cancelled = false;
    const checkSession = async () => {
      if (!settings.supabaseUrl || !settings.supabaseAnonKey) {
        if (!cancelled) setLoggedInEmail(null);
        return;
      }
      const session = await getActiveSupabaseSession(
        settings.supabaseUrl,
        settings.supabaseAnonKey
      );
      if (!cancelled) {
        setLoggedInEmail(session?.user?.email ?? null);
      }
    };
    void checkSession();
    return () => {
      cancelled = true;
    };
  }, [settings.supabaseUrl, settings.supabaseAnonKey]);

  const handleSaveGeminiConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setKeyErrorMsg(null);
    setKeySuccessMsg(null);

    const cleanModel = modelIdDraft.trim() || DEFAULT_GEMINI_MODEL_ID;
    const trimmedKey = apiKeyDraft.trim();

    if (trimmedKey && trimmedKey.length < 10) {
      setKeyErrorMsg('مفتاح API غير مكتمل.');
      return;
    }

    let keyPatch: Partial<typeof settings> = {};
    if (trimmedKey) {
      const encrypted = await encryptLocalSecret(trimmedKey);
      keyPatch = {
        encryptedApiKey: encrypted.cipherText,
        apiKeyIv: encrypted.iv,
        apiKeyLastFour: encrypted.lastFour,
      };
    }

    await db.appSettings.put({
      ...settings,
      ...keyPatch,
      id: 'singleton',
      geminiModelId: cleanModel,
      updatedAt: new Date().toISOString(),
    });

    setApiKeyDraft('');
    setKeySuccessMsg(
      trimmedKey
        ? `تم حفظ المفتاح المشفر والنموذج (${cleanModel}).`
        : `تم تحديث النموذج إلى (${cleanModel}).`
    );
  };

  const handleTestApiKey = async () => {
    const cleanModel = modelIdDraft.trim() || settings.geminiModelId || DEFAULT_GEMINI_MODEL_ID;
    setIsTestingKey(true);
    setKeySuccessMsg(null);
    setKeyErrorMsg(null);
    const res = await testGeminiConnection(apiKeyDraft.trim() || undefined, cleanModel);
    if (res.ok) {
      setKeySuccessMsg(res.message);
    } else {
      setKeyErrorMsg(res.message);
    }
    setIsTestingKey(false);
  };

  const handleClearApiKey = async () => {
    await db.appSettings.put({
      ...settings,
      id: 'singleton',
      encryptedApiKey: undefined,
      apiKeyIv: undefined,
      apiKeyLastFour: undefined,
      updatedAt: new Date().toISOString(),
    });
    setApiKeyDraft('');
    setKeyErrorMsg(null);
    setKeySuccessMsg('تم مسح المفتاح؛ يعمل التطبيق الآن بالمحرك المحلي.');
  };

  const handleThemeSwitch = async (mode: ThemeMode) => {
    await db.appSettings.put({
      ...settings,
      id: 'singleton',
      themeMode: mode,
      updatedAt: new Date().toISOString(),
    });
    onThemeChange(mode);
  };

  const handleUpdateAlarmSettings = async (
    patch: Partial<{
      strictMonitoringMinutes: number;
      emergencyChallengeType: EmergencyChallengeType;
      alarmVolume: number;
    }>
  ) => {
    await db.appSettings.put({
      ...settings,
      ...patch,
      id: 'singleton',
      updatedAt: new Date().toISOString(),
    });
  };

  const handleRequestAlarmPermission = async () => {
    setPermissionError(null);
    setPermissionSuccessMsg(null);
    const res = await requestAlarmNotificationPermission();
    setNotifGranted(res.granted);
    await db.appSettings.put({
      ...settings,
      id: 'singleton',
      androidOverlayGranted: res.granted,
      updatedAt: new Date().toISOString(),
    });

    if (res.granted) {
      setPermissionSuccessMsg(res.message);
    } else {
      setPermissionError({
        message: res.message,
        onFix: () => void handleRequestAlarmPermission(),
      });
    }
  };

  const handleRequestMicPermission = async () => {
    setPermissionError(null);
    setPermissionSuccessMsg(null);
    const res = await requestMicrophonePermission();
    setMicGranted(res.granted);
    await db.appSettings.put({
      ...settings,
      id: 'singleton',
      androidUsageStatsGranted: res.granted,
      updatedAt: new Date().toISOString(),
    });

    if (res.granted) {
      setPermissionSuccessMsg(res.message);
    } else {
      setPermissionError({
        message: res.message,
        onFix: () => void handleRequestMicPermission(),
      });
    }
  };

  const handleFireTestNotification = async () => {
    setPermissionError(null);
    setPermissionSuccessMsg(null);
    const ok = await fireImmediateTestNotification();
    if (ok) {
      setNotifGranted(true);
      setPermissionSuccessMsg('تم إرسال إشعار الاختبار بنجاح.');
    } else {
      setPermissionError({
        message: 'تعذر إرسال الإشعار قبل منح إذن الإشعارات.',
        onFix: () => void handleRequestAlarmPermission(),
      });
    }
  };

  const handleSaveSupabaseConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSyncErrorMsg(null);
    setSyncSuccessMsg(null);
    const cleanUrl = supabaseUrl.trim();
    const cleanAnon = supabaseAnonKey.trim();
    await db.appSettings.put({
      ...settings,
      id: 'singleton',
      supabaseUrl: cleanUrl || undefined,
      supabaseAnonKey: cleanAnon || undefined,
      updatedAt: new Date().toISOString(),
    });
    setSyncSuccessMsg(
      cleanUrl && cleanAnon ? 'تم حفظ بيانات Supabase.' : 'تم مسح بيانات Supabase.'
    );
  };

  const handleSupabaseLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings.supabaseUrl || !settings.supabaseAnonKey) return;
    setIsAuthBusy(true);
    setSyncSuccessMsg(null);
    setSyncErrorMsg(null);
    const res = await signInSupabase(
      settings.supabaseUrl,
      settings.supabaseAnonKey,
      authEmail,
      authPassword
    );
    if (res.error) {
      setSyncErrorMsg(res.error);
    } else if (res.session?.user?.email) {
      setLoggedInEmail(res.session.user.email);
      setAuthPassword('');
      setSyncSuccessMsg(`تم تسجيل الدخول (${res.session.user.email}).`);
    }
    setIsAuthBusy(false);
  };

  const handleSupabaseSignUp = async () => {
    if (!settings.supabaseUrl || !settings.supabaseAnonKey) return;
    if (!authEmail.trim() || authPassword.length < 6) {
      setSyncErrorMsg('أدخل بريداً صالحاً وكلمة مرور من 6 أحرف فأكثر.');
      return;
    }
    setIsAuthBusy(true);
    setSyncSuccessMsg(null);
    setSyncErrorMsg(null);
    const res = await signUpSupabase(
      settings.supabaseUrl,
      settings.supabaseAnonKey,
      authEmail,
      authPassword
    );
    if (res.error) {
      setSyncErrorMsg(res.error);
    } else {
      if (res.session?.user?.email) {
        setLoggedInEmail(res.session.user.email);
        setAuthPassword('');
      }
      setSyncSuccessMsg(res.message ?? 'تم إنشاء الحساب.');
    }
    setIsAuthBusy(false);
  };

  const handleSupabaseLogout = async () => {
    if (!settings.supabaseUrl || !settings.supabaseAnonKey) return;
    setIsAuthBusy(true);
    await signOutSupabase(settings.supabaseUrl, settings.supabaseAnonKey);
    setLoggedInEmail(null);
    setSyncErrorMsg(null);
    setSyncSuccessMsg('تم تسجيل الخروج.');
    setIsAuthBusy(false);
  };

  const handleSyncNow = async () => {
    if (!settings.supabaseUrl || !settings.supabaseAnonKey) return;
    setIsSyncing(true);
    setSyncSuccessMsg(null);
    setSyncErrorMsg(null);
    try {
      const summary = await syncWithSupabaseNow(settings.supabaseUrl, settings.supabaseAnonKey);
      setSyncSuccessMsg(
        `اكتملت المزامنة: رفع ${summary.pushedCount}، سحب ${summary.pulledCount}، حذف ${summary.deletedCount}.`
      );
    } catch (err) {
      setSyncErrorMsg(err instanceof Error ? err.message : 'فشلت المزامنة مع Supabase.');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleCopyText = async (text: string, target: 'sql' | 'manifest') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedTarget(target);
      setTimeout(() => setCopiedTarget(null), 1800);
    } catch {
      setSyncErrorMsg('تعذر النسخ التلقائي.');
    }
  };

  const handleDownloadFile = (
    filename: string,
    content: string,
    mime = 'text/plain;charset=utf-8'
  ) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleExportJson = async () => {
    setBackupErrorMsg(null);
    const json = await exportDatabaseToJson();
    handleDownloadFile(
      `alfaylasouf-mubasis-backup-${new Date().toISOString().slice(0, 10)}.json`,
      json,
      'application/json;charset=utf-8'
    );
    setBackupSuccessMsg('تم تصدير النسخة الاحتياطية.');
  };

  const handleImportJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBackupErrorMsg(null);
    setBackupSuccessMsg(null);
    try {
      const content = await file.text();
      const res = await importDatabaseFromJson(content);
      setBackupSuccessMsg(`تمت استعادة ${res.projectsCount} مشروع و ${res.stepsCount} خطوة.`);
    } catch (err) {
      setBackupErrorMsg(err instanceof Error ? err.message : 'ملف النسخة غير صالح.');
    } finally {
      e.target.value = '';
    }
  };

  const hasSavedSupabase = Boolean(settings.supabaseUrl && settings.supabaseAnonKey);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">الإعدادات</h1>

      {/* Brand Identity & Quick Actions */}
      <Surface className="overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-12">
          <div className="bg-[#0C0D10] md:col-span-4">
            <img
              src="./assets/aistudio/Gemini_Generated_Image_x73ws7x73ws7x73w_dafeee7b.jfif"
              alt="الفيلسوف مبعسس"
              referrerPolicy="no-referrer"
              className="h-full min-h-[160px] w-full object-cover"
            />
          </div>
          <div className="flex flex-col justify-between gap-4 p-5 md:col-span-8">
            <div className="space-y-1">
              <h2 className="text-base font-semibold">الفيلسوف مبعسس</h2>
              <div className="flex flex-wrap items-center gap-2 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                <span>{getRuntimeEnvironmentLabel()}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-tabular">{projectsCount} مشاريع</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-tabular">{stepsCount} خطوة</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <PWAInstallButton />
              <Button variant="outline" size="sm" onClick={onTriggerTestAlarm}>
                <BellRing className="h-4 w-4 text-red-500" strokeWidth={1.75} />
                <span>تجربة المنبه</span>
              </Button>
            </div>
          </div>
        </div>
      </Surface>

      {/* Section 1: Standard Permissions Wizard (Instant Android "Allow / سماح" Dialogs) */}
      <Surface className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E7EB] pb-3 dark:border-[#222630]">
          <div className="flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-blue-500" strokeWidth={1.75} />
            <h2 className="text-sm font-semibold">الأذونات (المنبه والميكروفون)</h2>
          </div>
          <span className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
            {isNativeApk ? 'Android APK' : 'PWA / متصفح'}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {/* Alarm & Local Notifications */}
          <div className="flex items-center justify-between gap-3 rounded-xl border border-[#E5E7EB] bg-[#FAFAFA] p-4 dark:border-[#222630] dark:bg-[#0E1015]">
            <div className="flex items-start gap-2.5">
              <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" strokeWidth={1.75} />
              <div className="space-y-0.5">
                <p className="text-sm font-medium">إشعارات المنبه</p>
                <p className="font-mono-tabular text-[11px] text-[#6B7280] dark:text-[#9CA3AF]">
                  POST_NOTIFICATIONS
                </p>
              </div>
            </div>
            <Button
              variant={notifGranted ? 'secondary' : 'primary'}
              size="sm"
              onClick={() => void handleRequestAlarmPermission()}
            >
              {notifGranted ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-500" strokeWidth={1.75} />
                  <span>مفعّل</span>
                </>
              ) : (
                <span>طلب السماح</span>
              )}
            </Button>
          </div>

          {/* Microphone & Speech Recognition */}
          <div className="flex items-center justify-between gap-3 rounded-xl border border-[#E5E7EB] bg-[#FAFAFA] p-4 dark:border-[#222630] dark:bg-[#0E1015]">
            <div className="flex items-start gap-2.5">
              <Mic className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" strokeWidth={1.75} />
              <div className="space-y-0.5">
                <p className="text-sm font-medium">الميكروفون والصوت</p>
                <p className="font-mono-tabular text-[11px] text-[#6B7280] dark:text-[#9CA3AF]">
                  RECORD_AUDIO
                </p>
              </div>
            </div>
            <Button
              variant={micGranted ? 'secondary' : 'primary'}
              size="sm"
              onClick={() => void handleRequestMicPermission()}
            >
              {micGranted ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-500" strokeWidth={1.75} />
                  <span>مفعّل</span>
                </>
              ) : (
                <span>طلب السماح</span>
              )}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void handleFireTestNotification()}>
            <BellRing className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span>إشعار اختبار فوري</span>
          </Button>
        </div>

        {permissionError && (
          <ErrorActionBanner
            message={permissionError.message}
            fixLabel="تطبيق الإصلاح"
            onApplyFix={permissionError.onFix}
            onIgnore={() => setPermissionError(null)}
          />
        )}

        {permissionSuccessMsg && !permissionError && (
          <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
            {permissionSuccessMsg}
          </p>
        )}
      </Surface>

      {/* Section 2: Direct Gemini API (BYOK + Editable Model ID) */}
      <Surface className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E7EB] pb-3 dark:border-[#222630]">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-blue-500" strokeWidth={1.75} />
            <h2 className="text-sm font-semibold">Gemini API</h2>
          </div>
          <span className="font-mono-tabular text-xs text-[#6B7280] dark:text-[#9CA3AF]">
            {settings.geminiModelId ?? DEFAULT_GEMINI_MODEL_ID} ·{' '}
            {settings.apiKeyLastFour ? `****${settings.apiKeyLastFour}` : 'محلي'}
          </span>
        </div>

        <form onSubmit={handleSaveGeminiConfig} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="md:col-span-7">
              <label className="mb-1.5 block text-xs font-medium text-[#6B7280] dark:text-[#9CA3AF]">
                مفتاح API (مشفّر محلياً بـ AES-GCM)
              </label>
              <div className="relative">
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={apiKeyDraft}
                  onChange={(e) => setApiKeyDraft(e.target.value)}
                  placeholder={
                    settings.apiKeyLastFour
                      ? `محفوظ (****${settings.apiKeyLastFour})`
                      : 'AIza...'
                  }
                  className="font-mono-tabular pl-12"
                  dir="ltr"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((prev) => !prev)}
                  aria-label={showKey ? 'إخفاء المفتاح' : 'إظهار المفتاح'}
                  className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-[#6B7280] hover:bg-[#F3F4F6] dark:hover:bg-[#1E222D]"
                >
                  {showKey ? (
                    <EyeOff className="h-4 w-4" strokeWidth={1.75} />
                  ) : (
                    <Eye className="h-4 w-4" strokeWidth={1.75} />
                  )}
                </button>
              </div>
            </div>

            <div className="md:col-span-5">
              <label className="mb-1.5 block text-xs font-medium text-[#6B7280] dark:text-[#9CA3AF]">
                معرّف النموذج (Model ID)
              </label>
              <Input
                type="text"
                value={modelIdDraft}
                onChange={(e) => setModelIdDraft(e.target.value)}
                placeholder="gemini-2.5-flash"
                className="font-mono-tabular"
                dir="ltr"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="primary" size="sm">
              <span>حفظ</span>
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void handleTestApiKey()}
              disabled={isTestingKey}
            >
              {isTestingKey ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
              ) : (
                <ShieldCheck className="h-4 w-4" strokeWidth={1.75} />
              )}
              <span>اختبار الاتصال</span>
            </Button>
            {settings.encryptedApiKey && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void handleClearApiKey()}
              >
                <Trash2 className="h-4 w-4 text-red-500" strokeWidth={1.75} />
                <span className="text-red-500">مسح</span>
              </Button>
            )}
          </div>
        </form>

        {keyErrorMsg && (
          <ErrorActionBanner
            message={keyErrorMsg}
            fixLabel="تطبيق الإصلاح"
            onApplyFix={() => {
              setModelIdDraft(DEFAULT_GEMINI_MODEL_ID);
              setKeyErrorMsg(null);
            }}
            onIgnore={() => setKeyErrorMsg(null)}
          />
        )}

        {keySuccessMsg && !keyErrorMsg && (
          <p className="break-words text-xs font-medium text-emerald-600 dark:text-emerald-400">
            {keySuccessMsg}
          </p>
        )}
      </Surface>

      {/* Section 3: Supabase Cloud Sync & Auth */}
      <Surface className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E7EB] pb-3 dark:border-[#222630]">
          <div className="flex items-center gap-2">
            <Cloud className="h-4 w-4 text-blue-500" strokeWidth={1.75} />
            <h2 className="text-sm font-semibold">المزامنة السحابية (Supabase)</h2>
          </div>
          <span className="font-mono-tabular text-xs text-[#6B7280] dark:text-[#9CA3AF]">
            {pendingSyncCount} معلق
            {settings.lastSyncedAt
              ? ` · ${new Date(settings.lastSyncedAt).toLocaleTimeString('ar-SA', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}`
              : ''}
          </span>
        </div>

        <form onSubmit={handleSaveSupabaseConfig} className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="md:col-span-5">
            <Input
              value={supabaseUrl}
              onChange={(e) => setSupabaseUrl(e.target.value)}
              placeholder="Project URL (https://xxx.supabase.co)"
              dir="ltr"
              className="font-mono-tabular text-xs"
            />
          </div>
          <div className="md:col-span-5">
            <Input
              type="password"
              value={supabaseAnonKey}
              onChange={(e) => setSupabaseAnonKey(e.target.value)}
              placeholder="Public Anon Key"
              dir="ltr"
              className="font-mono-tabular text-xs"
            />
          </div>
          <div className="md:col-span-2">
            <Button type="submit" variant="secondary" className="w-full">
              حفظ
            </Button>
          </div>
        </form>

        {hasSavedSupabase && (
          <div className="rounded-xl border border-[#E5E7EB] bg-[#FAFAFA] p-4 dark:border-[#222630] dark:bg-[#0E1015]">
            {loggedInEmail ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-0.5">
                  <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">الحساب المتصل</p>
                  <p className="font-mono-tabular text-sm font-semibold">{loggedInEmail}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void handleSyncNow()}
                    disabled={isSyncing}
                  >
                    {isSyncing ? (
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                    ) : (
                      <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
                    )}
                    <span>{isSyncing ? 'جاري المزامنة...' : 'مزامنة الآن'}</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleSupabaseLogout()}
                    disabled={isAuthBusy}
                  >
                    <LogOut className="h-4 w-4" strokeWidth={1.75} />
                    <span>خروج</span>
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSupabaseLogin} className="space-y-3">
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <Input
                    type="email"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    placeholder="البريد الإلكتروني"
                    dir="ltr"
                    required
                  />
                  <Input
                    type="password"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    placeholder="كلمة المرور"
                    dir="ltr"
                    required
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" variant="primary" size="sm" disabled={isAuthBusy}>
                    {isAuthBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                    ) : (
                      <LogIn className="h-4 w-4" strokeWidth={1.75} />
                    )}
                    <span>تسجيل الدخول</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleSupabaseSignUp()}
                    disabled={isAuthBusy}
                  >
                    <UserPlus className="h-4 w-4" strokeWidth={1.75} />
                    <span>إنشاء حساب</span>
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}

        {syncErrorMsg && (
          <ErrorActionBanner
            message={syncErrorMsg}
            fixLabel="تطبيق الإصلاح"
            onApplyFix={() => {
              setSyncErrorMsg(null);
              if (loggedInEmail) {
                void handleSyncNow();
              }
            }}
            onIgnore={() => setSyncErrorMsg(null)}
          />
        )}

        {syncSuccessMsg && !syncErrorMsg && (
          <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
            {syncSuccessMsg}
          </p>
        )}
      </Surface>

      {/* Section 4: Appearance, Alarm & Local Backup */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Surface className="space-y-4 p-5">
          <h2 className="border-b border-[#E5E7EB] pb-3 text-sm font-semibold dark:border-[#222630]">
            المظهر والنسخ الاحتياطي
          </h2>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void handleThemeSwitch('dark')}
              className={`flex min-h-[42px] cursor-pointer items-center justify-center gap-2 rounded-xl border text-xs font-medium transition-colors ${
                settings.themeMode === 'dark'
                  ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                  : 'border-[#E5E7EB] text-[#6B7280] dark:border-[#222630]'
              }`}
            >
              <Moon className="h-4 w-4" strokeWidth={1.75} />
              <span>داكن</span>
            </button>
            <button
              type="button"
              onClick={() => void handleThemeSwitch('light')}
              className={`flex min-h-[42px] cursor-pointer items-center justify-center gap-2 rounded-xl border text-xs font-medium transition-colors ${
                settings.themeMode === 'light'
                  ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                  : 'border-[#E5E7EB] text-[#6B7280] dark:border-[#222630]'
              }`}
            >
              <Sun className="h-4 w-4" strokeWidth={1.75} />
              <span>فاتح</span>
            </button>
          </div>

          <div className="space-y-2.5 border-t border-[#E5E7EB] pt-4 dark:border-[#222630]">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 font-medium">
                <Database className="h-3.5 w-3.5 text-blue-500" strokeWidth={1.75} />
                IndexedDB
              </span>
              <span className="font-mono-tabular text-[#6B7280]">{stepsCount} خطوة</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => void handleExportJson()}>
                <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                <span>تصدير JSON</span>
              </Button>
              <input
                ref={importFileRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={handleImportJson}
              />
              <Button variant="outline" size="sm" onClick={() => importFileRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" strokeWidth={1.75} />
                <span>استيراد JSON</span>
              </Button>
            </div>
            {backupErrorMsg && (
              <ErrorActionBanner
                message={backupErrorMsg}
                fixLabel="تطبيق الإصلاح"
                onApplyFix={() => {
                  setBackupErrorMsg(null);
                  importFileRef.current?.click();
                }}
                onIgnore={() => setBackupErrorMsg(null)}
              />
            )}
            {backupSuccessMsg && !backupErrorMsg && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400">{backupSuccessMsg}</p>
            )}
          </div>
        </Surface>

        {/* Alarm Settings */}
        <Surface className="space-y-4 p-5">
          <h2 className="border-b border-[#E5E7EB] pb-3 text-sm font-semibold dark:border-[#222630]">
            المنبه الصارم
          </h2>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#6B7280] dark:text-[#9CA3AF]">نافذة المراقبة</span>
              <span className="font-mono-tabular font-semibold">
                {settings.strictMonitoringMinutes} د
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[15, 30, 45].map((mins) => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => void handleUpdateAlarmSettings({ strictMonitoringMinutes: mins })}
                  className={`min-h-[38px] cursor-pointer rounded-xl border font-mono-tabular text-xs font-medium ${
                    settings.strictMonitoringMinutes === mins
                      ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                      : 'border-[#E5E7EB] text-[#6B7280] dark:border-[#222630]'
                  }`}
                >
                  {mins} د
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <span className="block text-xs text-[#6B7280] dark:text-[#9CA3AF]">تحدي الطوارئ</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void handleUpdateAlarmSettings({ emergencyChallengeType: 'math' })}
                className={`min-h-[38px] cursor-pointer rounded-xl border text-xs font-medium ${
                  settings.emergencyChallengeType === 'math'
                    ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                    : 'border-[#E5E7EB] text-[#6B7280] dark:border-[#222630]'
                }`}
              >
                معادلة رياضية
              </button>
              <button
                type="button"
                onClick={() =>
                  void handleUpdateAlarmSettings({ emergencyChallengeType: 'sentence' })
                }
                className={`min-h-[38px] cursor-pointer rounded-xl border text-xs font-medium ${
                  settings.emergencyChallengeType === 'sentence'
                    ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                    : 'border-[#E5E7EB] text-[#6B7280] dark:border-[#222630]'
                }`}
              >
                جملة تأكيد
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#6B7280] dark:text-[#9CA3AF]">مستوى الصوت</span>
              <span className="font-mono-tabular">{Math.round(settings.alarmVolume * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.2}
              max={1}
              step={0.05}
              value={settings.alarmVolume}
              onChange={(e) =>
                void handleUpdateAlarmSettings({ alarmVolume: parseFloat(e.target.value) })
              }
              className="w-full cursor-pointer accent-blue-600"
            />
          </div>
        </Surface>
      </div>

      {/* Section 5: Collapsed Developer Tools Accordion */}
      <Surface className="overflow-hidden">
        <button
          type="button"
          onClick={() => setDevToolsOpen((prev) => !prev)}
          aria-expanded={devToolsOpen}
          className="flex min-h-[52px] w-full cursor-pointer items-center justify-between gap-4 px-5 py-3.5 text-right transition-colors hover:bg-[#FAFAFA] dark:hover:bg-[#171A22]"
        >
          <div className="flex items-center gap-2.5">
            <Code2 className="h-4 w-4 text-[#6B7280] dark:text-[#9CA3AF]" strokeWidth={1.75} />
            <span className="text-sm font-semibold">أدوات المطور (متقدم)</span>
          </div>
          {devToolsOpen ? (
            <ChevronUp className="h-4 w-4 shrink-0 text-[#6B7280]" strokeWidth={1.75} />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-[#6B7280]" strokeWidth={1.75} />
          )}
        </button>

        {devToolsOpen && (
          <div className="space-y-6 border-t border-[#E5E7EB] p-5 dark:border-[#222630]">
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold">Supabase SQL + RLS</span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleCopyText(SUPABASE_SCHEMA_SQL, 'sql')}
                  >
                    {copiedTarget === 'sql' ? (
                      <Check className="h-3.5 w-3.5 text-emerald-500" strokeWidth={1.75} />
                    ) : (
                      <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
                    )}
                    <span>{copiedTarget === 'sql' ? 'تم النسخ' : 'نسخ SQL'}</span>
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      handleDownloadFile(
                        'supabase-schema.sql',
                        SUPABASE_SCHEMA_SQL,
                        'text/sql;charset=utf-8'
                      )
                    }
                  >
                    <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                    <span>تنزيل</span>
                  </Button>
                </div>
              </div>
              <pre
                dir="ltr"
                className="font-code max-h-72 overflow-auto rounded-xl border border-[#E5E7EB] bg-[#0C0D10] p-4 text-[11px] leading-relaxed text-[#CBD5E1] dark:border-[#222630]"
              >
                {SUPABASE_SCHEMA_SQL}
              </pre>
            </div>

            <div className="space-y-2.5 border-t border-[#E5E7EB] pt-5 dark:border-[#222630]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold">AndroidManifest.xml</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleCopyText(ANDROID_MANIFEST_SNIPPET, 'manifest')}
                >
                  {copiedTarget === 'manifest' ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" strokeWidth={1.75} />
                  ) : (
                    <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
                  )}
                  <span>{copiedTarget === 'manifest' ? 'تم النسخ' : 'نسخ'}</span>
                </Button>
              </div>
              <pre
                dir="ltr"
                className="font-code overflow-x-auto rounded-xl border border-[#E5E7EB] bg-[#0C0D10] p-3.5 text-[11px] leading-relaxed text-[#CBD5E1] dark:border-[#222630]"
              >
                {ANDROID_MANIFEST_SNIPPET}
              </pre>
            </div>
          </div>
        )}
      </Surface>
    </div>
  );
};
