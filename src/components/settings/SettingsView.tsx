import React, { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle,
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
  getRuntimeEnvironmentLabel,
  isNativeCapacitorPlatform,
  requestAndroidOverlayPermission,
  requestAndroidUsageStatsPermission,
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
  const [keyStatusMsg, setKeyStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Supabase connection + Auth + Sync state
  const [supabaseUrl, setSupabaseUrl] = useState(settings.supabaseUrl ?? '');
  const [supabaseAnonKey, setSupabaseAnonKey] = useState(settings.supabaseAnonKey ?? '');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [loggedInEmail, setLoggedInEmail] = useState<string | null>(null);
  const [isAuthBusy, setIsAuthBusy] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState<{ ok: boolean; text: string } | null>(null);

  // Developer Advanced Accordion (closed by default)
  const [devToolsOpen, setDevToolsOpen] = useState(false);

  // Permission wizard & backup feedback
  const [permissionNotice, setPermissionNotice] = useState<string | null>(null);
  const [copiedTarget, setCopiedTarget] = useState<'sql' | 'manifest' | null>(null);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const importFileRef = useRef<HTMLInputElement | null>(null);

  // Sync draft inputs once IndexedDB settings finish loading
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

  // Check active Supabase session whenever saved credentials exist
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
    const cleanModel = modelIdDraft.trim() || DEFAULT_GEMINI_MODEL_ID;
    const trimmedKey = apiKeyDraft.trim();

    if (trimmedKey && trimmedKey.length < 10) {
      setKeyStatusMsg({ ok: false, text: 'مفتاح API قصير جداً أو غير مكتمل.' });
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
    setKeyStatusMsg({
      ok: true,
      text: trimmedKey
        ? `تم حفظ النموذج (${cleanModel}) وتشفير مفتاح API محلياً (AES-GCM).`
        : `تم تحديث معرّف النموذج المحلي إلى (${cleanModel}).`,
    });
  };

  const handleTestApiKey = async () => {
    const cleanModel = modelIdDraft.trim() || settings.geminiModelId || DEFAULT_GEMINI_MODEL_ID;
    setIsTestingKey(true);
    setKeyStatusMsg(null);
    const res = await testGeminiConnection(apiKeyDraft.trim() || undefined, cleanModel);
    setKeyStatusMsg({ ok: res.ok, text: res.message });
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
    setKeyStatusMsg({
      ok: true,
      text: 'تم مسح المفتاح من الجهاز نهائياً. يعمل النظام الآن بالمحرك المحلي الاحتياطي.',
    });
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

  const handleRequestOverlay = async () => {
    const res = await requestAndroidOverlayPermission();
    if (res.isNative) {
      await db.appSettings.put({
        ...settings,
        id: 'singleton',
        androidOverlayGranted: res.granted,
        updatedAt: new Date().toISOString(),
      });
    }
    setPermissionNotice(res.message);
  };

  const handleRequestUsageStats = async () => {
    const res = await requestAndroidUsageStatsPermission();
    if (res.isNative) {
      await db.appSettings.put({
        ...settings,
        id: 'singleton',
        androidUsageStatsGranted: res.granted,
        updatedAt: new Date().toISOString(),
      });
    }
    setPermissionNotice(res.message);
  };

  const handleSaveSupabaseConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUrl = supabaseUrl.trim();
    const cleanAnon = supabaseAnonKey.trim();
    await db.appSettings.put({
      ...settings,
      id: 'singleton',
      supabaseUrl: cleanUrl || undefined,
      supabaseAnonKey: cleanAnon || undefined,
      updatedAt: new Date().toISOString(),
    });
    setSyncNotice({
      ok: true,
      text:
        cleanUrl && cleanAnon
          ? 'تم حفظ بيانات مشروع Supabase. يمكنك الآن تسجيل الدخول أو إنشاء حساب أدناه.'
          : 'تم مسح بيانات ربط Supabase.',
    });
  };

  const handleSupabaseLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings.supabaseUrl || !settings.supabaseAnonKey) return;
    setIsAuthBusy(true);
    setSyncNotice(null);
    const res = await signInSupabase(
      settings.supabaseUrl,
      settings.supabaseAnonKey,
      authEmail,
      authPassword
    );
    if (res.error) {
      setSyncNotice({ ok: false, text: res.error });
    } else if (res.session?.user?.email) {
      setLoggedInEmail(res.session.user.email);
      setAuthPassword('');
      setSyncNotice({ ok: true, text: `تم تسجيل الدخول بنجاح (${res.session.user.email}).` });
    }
    setIsAuthBusy(false);
  };

  const handleSupabaseSignUp = async () => {
    if (!settings.supabaseUrl || !settings.supabaseAnonKey) return;
    if (!authEmail.trim() || authPassword.length < 6) {
      setSyncNotice({
        ok: false,
        text: 'أدخل بريداً إلكترونياً صالحاً وكلمة مرور من 6 أحرف على الأقل.',
      });
      return;
    }
    setIsAuthBusy(true);
    setSyncNotice(null);
    const res = await signUpSupabase(
      settings.supabaseUrl,
      settings.supabaseAnonKey,
      authEmail,
      authPassword
    );
    if (res.error) {
      setSyncNotice({ ok: false, text: res.error });
    } else {
      if (res.session?.user?.email) {
        setLoggedInEmail(res.session.user.email);
        setAuthPassword('');
      }
      setSyncNotice({ ok: true, text: res.message ?? 'تم إنشاء الحساب.' });
    }
    setIsAuthBusy(false);
  };

  const handleSupabaseLogout = async () => {
    if (!settings.supabaseUrl || !settings.supabaseAnonKey) return;
    setIsAuthBusy(true);
    await signOutSupabase(settings.supabaseUrl, settings.supabaseAnonKey);
    setLoggedInEmail(null);
    setSyncNotice({ ok: true, text: 'تم تسجيل الخروج من المزامنة السحابية.' });
    setIsAuthBusy(false);
  };

  const handleSyncNow = async () => {
    if (!settings.supabaseUrl || !settings.supabaseAnonKey) return;
    setIsSyncing(true);
    setSyncNotice(null);
    try {
      const summary = await syncWithSupabaseNow(settings.supabaseUrl, settings.supabaseAnonKey);
      setSyncNotice({
        ok: true,
        text: `اكتملت المزامنة بنجاح: رفع ${summary.pushedCount} سجل، سحب ${summary.pulledCount} سجل، حذف ${summary.deletedCount}.`,
      });
    } catch (err) {
      setSyncNotice({
        ok: false,
        text: err instanceof Error ? err.message : 'فشلت المزامنة مع Supabase.',
      });
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
      setSyncNotice({ ok: false, text: 'تعذر النسخ التلقائي؛ يمكنك التحديد والنسخ يدوياً.' });
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
    const json = await exportDatabaseToJson();
    handleDownloadFile(
      `alfaylasouf-mubasis-backup-${new Date().toISOString().slice(0, 10)}.json`,
      json,
      'application/json;charset=utf-8'
    );
    setBackupNotice('تم تصدير نسخة احتياطية كاملة من IndexedDB بنجاح.');
  };

  const handleImportJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const content = await file.text();
      const res = await importDatabaseFromJson(content);
      setBackupNotice(`تمت استعادة ${res.projectsCount} مشروع و ${res.stepsCount} خطوة جزئية.`);
    } catch (err) {
      setBackupNotice(err instanceof Error ? err.message : 'فشل استيراد الملف.');
    } finally {
      e.target.value = '';
    }
  };

  const hasSavedSupabase = Boolean(settings.supabaseUrl && settings.supabaseAnonKey);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">الإعدادات والمزامنة السحابية</h1>
        <p className="mt-1 text-sm text-[#64748B] dark:text-[#94A3B8]">
          إدارة مفتاح Gemini API المباشر، المزامنة مع Supabase بين الكمبيوتر والهاتف، إعدادات
          المنبه، وصلاحيات نسخة الأندرويد APK.
        </p>
      </div>

      {/* Official Brand Identity Card */}
      <Surface className="overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-12">
          <div className="bg-[#0B0D10] md:col-span-5">
            <img
              src="./assets/aistudio/Gemini_Generated_Image_x73ws7x73ws7x73w_dafeee7b.jfif"
              alt="شعار تطبيق الفيلسوف مبعسس"
              referrerPolicy="no-referrer"
              className="h-full min-h-[180px] w-full object-cover"
            />
          </div>
          <div className="flex flex-col justify-between gap-4 p-5 md:col-span-7">
            <div className="space-y-1.5">
              <h2 className="text-lg font-bold">الفيلسوف مبعسس — محرك المهام والتنفيذ التدريجي</h2>
              <p className="text-xs leading-relaxed text-[#64748B] dark:text-[#94A3B8]">
                تطبيق Static PWA يعمل محلياً أولاً عبر IndexedDB (Dexie.js) وجاهز للتغليف كـ APK
                أصلي للأندرويد عبر CapacitorJS بتكلفة تشغيلية صفرية.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-[#64748B] dark:text-[#94A3B8]">
              <span>البيئة: {getRuntimeEnvironmentLabel()}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-tabular">{projectsCount} مشاريع</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-tabular">{stepsCount} خطوات مخزنة</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <PWAInstallButton />
              <Button variant="outline" size="md" onClick={onTriggerTestAlarm}>
                <BellRing className="h-4 w-4 text-red-500" strokeWidth={1.75} />
                <span>تجربة التنبيه الصارم الآن</span>
              </Button>
            </div>
          </div>
        </div>
      </Surface>

      {/* Section 1: Direct Native Fetch Gemini API (BYOK + Editable Model ID) */}
      <Surface className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2E8F0] pb-3 dark:border-[#232936]">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-blue-500" strokeWidth={1.75} />
            <h2 className="text-base font-semibold">
              اتصال Gemini API المباشر (Client-Side Fetch)
            </h2>
          </div>
          <span className="font-mono-tabular text-xs text-[#64748B] dark:text-[#94A3B8]">
            {settings.geminiModelId ?? DEFAULT_GEMINI_MODEL_ID} ·{' '}
            {settings.apiKeyLastFour
              ? `مفتاح محفوظ (****${settings.apiKeyLastFour})`
              : 'يعمل بالمحرك المحلي الاحتياطي'}
          </span>
        </div>

        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          <p>
            <strong>ملاحظة أمنية:</strong> يتصل التطبيق مباشرة عبر Fetch بالرابط الرسمي لـ Google
            Gemini دون أي خادم وسيط ليعمل على GitHub Pages و APK. يُشفّر المفتاح محلياً بـ AES-GCM
            في IndexedDB، ويُنصح بتقييده في Google Cloud Console على Gemini API فقط.
          </p>
        </div>

        <form onSubmit={handleSaveGeminiConfig} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="md:col-span-7">
              <label className="mb-1.5 block text-xs font-medium text-[#64748B] dark:text-[#94A3B8]">
                مفتاح Gemini API الشخصي (BYOK)
              </label>
              <div className="relative">
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={apiKeyDraft}
                  onChange={(e) => setApiKeyDraft(e.target.value)}
                  placeholder={
                    settings.apiKeyLastFour
                      ? `مفتاح محفوظ (****${settings.apiKeyLastFour}) — اتركه فارغاً للإبقاء عليه`
                      : 'أدخل مفتاح Gemini API (AIza...)...'
                  }
                  className="font-mono-tabular pl-12"
                  dir="ltr"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((prev) => !prev)}
                  aria-label={showKey ? 'إخفاء المفتاح' : 'إظهار المفتاح'}
                  className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-[#64748B] hover:bg-[#EEF1F6] dark:hover:bg-[#1A1F28]"
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
              <label className="mb-1.5 block text-xs font-medium text-[#64748B] dark:text-[#94A3B8]">
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
            <Button type="submit" variant="primary">
              <span>حفظ الإعدادات محلياً</span>
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={handleTestApiKey}
              disabled={isTestingKey}
            >
              {isTestingKey ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
              ) : (
                <ShieldCheck className="h-4 w-4" strokeWidth={1.75} />
              )}
              <span>اختبار الاتصال المباشر</span>
            </Button>
            {settings.encryptedApiKey && (
              <Button type="button" variant="ghost" onClick={handleClearApiKey}>
                <Trash2 className="h-4 w-4 text-red-500" strokeWidth={1.75} />
                <span className="text-red-500">مسح المفتاح</span>
              </Button>
            )}
          </div>
        </form>

        {keyStatusMsg && (
          <p
            className={`break-words text-xs font-medium leading-relaxed ${
              keyStatusMsg.ok
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-red-600 dark:text-red-400'
            }`}
          >
            {keyStatusMsg.text}
          </p>
        )}
      </Surface>

      {/* Section 2: Real Bi-Directional Supabase Cloud Sync & Auth */}
      <Surface className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2E8F0] pb-3 dark:border-[#232936]">
          <div className="flex items-center gap-2">
            <Cloud className="h-4 w-4 text-blue-500" strokeWidth={1.75} />
            <h2 className="text-base font-semibold">
              المزامنة السحابية بين الكمبيوتر والهاتف (Supabase)
            </h2>
          </div>
          <span className="font-mono-tabular text-xs text-[#64748B] dark:text-[#94A3B8]">
            {pendingSyncCount} تغييرات معلقة
            {settings.lastSyncedAt
              ? ` · آخر مزامنة ${new Date(settings.lastSyncedAt).toLocaleTimeString('ar-SA', {
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
              placeholder="Supabase Project URL (https://xxx.supabase.co)"
              dir="ltr"
              className="font-mono-tabular text-xs"
            />
          </div>
          <div className="md:col-span-5">
            <Input
              type="password"
              value={supabaseAnonKey}
              onChange={(e) => setSupabaseAnonKey(e.target.value)}
              placeholder="Supabase Public Anon Key"
              dir="ltr"
              className="font-mono-tabular text-xs"
            />
          </div>
          <div className="md:col-span-2">
            <Button type="submit" variant="secondary" className="w-full">
              حفظ الربط
            </Button>
          </div>
        </form>

        {/* Auth & Sync Controls shown after Project URL + Anon Key are saved */}
        {hasSavedSupabase && (
          <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4 dark:border-[#232936] dark:bg-[#0E1116]">
            {loggedInEmail ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-0.5">
                  <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">الحساب المتصل بالمزامنة</p>
                  <p className="font-mono-tabular text-sm font-semibold">{loggedInEmail}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="primary" onClick={handleSyncNow} disabled={isSyncing}>
                    {isSyncing ? (
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                    ) : (
                      <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
                    )}
                    <span>{isSyncing ? 'جاري المزامنة...' : 'مزامنة الآن'}</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="md"
                    onClick={handleSupabaseLogout}
                    disabled={isAuthBusy}
                  >
                    <LogOut className="h-4 w-4" strokeWidth={1.75} />
                    <span>تسجيل الخروج</span>
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSupabaseLogin} className="space-y-3">
                <p className="text-xs font-medium text-[#475569] dark:text-[#CBD5E1]">
                  سجّل الدخول أو أنشئ حساباً لبدء المزامنة الثنائية مع جداول Supabase الخاصة بك:
                </p>
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
                    placeholder="كلمة المرور (6 أحرف فأكثر)"
                    dir="ltr"
                    required
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" variant="primary" disabled={isAuthBusy}>
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
                    onClick={handleSupabaseSignUp}
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

        {syncNotice && (
          <p
            className={`text-xs font-medium ${
              syncNotice.ok
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-red-600 dark:text-red-400'
            }`}
          >
            {syncNotice.text}
          </p>
        )}
      </Surface>

      {/* Section 3: Appearance, Alarm Strictness & Local Backup */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Surface className="space-y-4 p-5">
          <h2 className="border-b border-[#E2E8F0] pb-3 text-base font-semibold dark:border-[#232936]">
            المظهر والنسخ الاحتياطي المحلي (IndexedDB)
          </h2>

          <div className="space-y-2">
            <span className="block text-xs font-medium text-[#64748B] dark:text-[#94A3B8]">
              سمة الواجهة
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void handleThemeSwitch('dark')}
                className={`flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-xl border text-xs font-medium transition-colors ${
                  settings.themeMode === 'dark'
                    ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                    : 'border-[#E2E8F0] text-[#64748B] dark:border-[#232936]'
                }`}
              >
                <Moon className="h-4 w-4" strokeWidth={1.75} />
                <span>داكن (Linear)</span>
              </button>
              <button
                type="button"
                onClick={() => void handleThemeSwitch('light')}
                className={`flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-xl border text-xs font-medium transition-colors ${
                  settings.themeMode === 'light'
                    ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                    : 'border-[#E2E8F0] text-[#64748B] dark:border-[#232936]'
                }`}
              >
                <Sun className="h-4 w-4" strokeWidth={1.75} />
                <span>فاتح (One UI)</span>
              </button>
            </div>
          </div>

          <div className="space-y-2 border-t border-[#E2E8F0] pt-4 dark:border-[#232936]">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 font-medium">
                <Database className="h-3.5 w-3.5 text-blue-500" strokeWidth={1.75} />
                قاعدة البيانات المحلية Dexie.js
              </span>
              <span className="font-mono-tabular text-[#64748B]">{stepsCount} خطوات محلية</span>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={handleExportJson}>
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
            {backupNotice && (
              <p className="text-xs text-blue-600 dark:text-blue-400">{backupNotice}</p>
            )}
          </div>
        </Surface>

        {/* Alarm Strictness Settings */}
        <Surface className="space-y-4 p-5">
          <h2 className="border-b border-[#E2E8F0] pb-3 text-base font-semibold dark:border-[#232936]">
            إعدادات المنبه الصارم وحماية البطارية
          </h2>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span>مدة نافذة المراقبة عند رنين المنبه</span>
              <span className="font-mono-tabular font-semibold">
                {settings.strictMonitoringMinutes} دقيقة
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[15, 30, 45].map((mins) => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => void handleUpdateAlarmSettings({ strictMonitoringMinutes: mins })}
                  className={`min-h-[40px] cursor-pointer rounded-xl border font-mono-tabular text-xs font-medium ${
                    settings.strictMonitoringMinutes === mins
                      ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                      : 'border-[#E2E8F0] text-[#64748B] dark:border-[#232936]'
                  }`}
                >
                  {mins} دقيقة
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <span className="block text-xs">تحدي زر الطوارئ المحمي (التأجيل لمرة واحدة)</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void handleUpdateAlarmSettings({ emergencyChallengeType: 'math' })}
                className={`min-h-[40px] cursor-pointer rounded-xl border text-xs font-medium ${
                  settings.emergencyChallengeType === 'math'
                    ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                    : 'border-[#E2E8F0] text-[#64748B] dark:border-[#232936]'
                }`}
              >
                معادلة رياضية
              </button>
              <button
                type="button"
                onClick={() =>
                  void handleUpdateAlarmSettings({ emergencyChallengeType: 'sentence' })
                }
                className={`min-h-[40px] cursor-pointer rounded-xl border text-xs font-medium ${
                  settings.emergencyChallengeType === 'sentence'
                    ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                    : 'border-[#E2E8F0] text-[#64748B] dark:border-[#232936]'
                }`}
              >
                جملة تأكيد طويلة
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span>شدة صوت المنبه المستمر</span>
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

      {/* Section 4: Android CapacitorJS Permission Wizard with real Capacitor.isNativePlatform() check */}
      <Surface className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2E8F0] pb-3 dark:border-[#232936]">
          <div className="flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-blue-500" strokeWidth={1.75} />
            <h2 className="text-base font-semibold">معالج صلاحيات الأندرويد (CapacitorJS APK)</h2>
          </div>
          <span className="text-xs text-[#64748B] dark:text-[#94A3B8]">
            {isNativeApk
              ? 'تم اكتشاف بيئة الأندرويد الأصلية'
              : 'متاح على نسخة APK فقط — تعمل مراقبة التبويب على الويب تلقائياً'}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4 dark:border-[#232936] dark:bg-[#0E1116]">
            <div className="space-y-1">
              <p className="text-sm font-semibold">1. الظهور فوق التطبيقات</p>
              <p className="font-mono-tabular text-[11px] text-[#64748B]">SYSTEM_ALERT_WINDOW</p>
            </div>
            {!isNativeApk ? (
              <span className="shrink-0 text-xs font-medium text-[#64748B] dark:text-[#94A3B8]">
                متاح على نسخة APK فقط
              </span>
            ) : (
              <Button
                variant={settings.androidOverlayGranted ? 'secondary' : 'primary'}
                size="sm"
                onClick={handleRequestOverlay}
              >
                {settings.androidOverlayGranted ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-500" strokeWidth={1.75} />
                    <span>مهيأة</span>
                  </>
                ) : (
                  <span>تفعيل الآن</span>
                )}
              </Button>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4 dark:border-[#232936] dark:bg-[#0E1116]">
            <div className="space-y-1">
              <p className="text-sm font-semibold">2. الوصول لبيانات الاستخدام</p>
              <p className="font-mono-tabular text-[11px] text-[#64748B]">
                PACKAGE_USAGE_STATS
              </p>
            </div>
            {!isNativeApk ? (
              <span className="shrink-0 text-xs font-medium text-[#64748B] dark:text-[#94A3B8]">
                متاح على نسخة APK فقط
              </span>
            ) : (
              <Button
                variant={settings.androidUsageStatsGranted ? 'secondary' : 'primary'}
                size="sm"
                onClick={handleRequestUsageStats}
              >
                {settings.androidUsageStatsGranted ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-500" strokeWidth={1.75} />
                    <span>مهيأة</span>
                  </>
                ) : (
                  <span>تفعيل الآن</span>
                )}
              </Button>
            )}
          </div>
        </div>

        {permissionNotice && (
          <p className="text-xs text-blue-600 dark:text-blue-400">{permissionNotice}</p>
        )}
      </Surface>

      {/* Section 5: Collapsed-by-default Developer Tools Accordion */}
      <Surface className="overflow-hidden">
        <button
          type="button"
          onClick={() => setDevToolsOpen((prev) => !prev)}
          aria-expanded={devToolsOpen}
          className="flex min-h-[56px] w-full cursor-pointer items-center justify-between gap-4 px-5 py-4 text-right transition-colors hover:bg-[#F8FAFC] dark:hover:bg-[#171B23]"
        >
          <div className="flex items-center gap-2.5">
            <Code2 className="h-4 w-4 text-[#64748B] dark:text-[#94A3B8]" strokeWidth={1.75} />
            <div>
              <span className="block text-sm font-semibold">أدوات المطور (متقدم)</span>
              <span className="block text-xs text-[#64748B] dark:text-[#94A3B8]">
                مخطط Supabase SQL + RLS الكامل وتصاريح AndroidManifest.xml
              </span>
            </div>
          </div>
          {devToolsOpen ? (
            <ChevronUp className="h-4 w-4 shrink-0 text-[#64748B]" strokeWidth={1.75} />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-[#64748B]" strokeWidth={1.75} />
          )}
        </button>

        {devToolsOpen && (
          <div className="space-y-6 border-t border-[#E2E8F0] p-5 dark:border-[#232936]">
            {/* Supabase SQL Schema */}
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold">
                  مخطط قاعدة البيانات السحابية (Supabase PostgreSQL + RLS)
                </span>
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
                    <span>تنزيل schema.sql</span>
                  </Button>
                </div>
              </div>
              <pre
                dir="ltr"
                className="font-mono-tabular max-h-80 overflow-auto rounded-xl border border-[#E2E8F0] bg-[#0B0D10] p-4 text-[11px] leading-relaxed text-[#CBD5E1] dark:border-[#232936]"
              >
                {SUPABASE_SCHEMA_SQL}
              </pre>
            </div>

            {/* Android Manifest Permissions */}
            <div className="space-y-2.5 border-t border-[#E2E8F0] pt-5 dark:border-[#232936]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold">
                  تصاريح AndroidManifest.xml الجاهزة لحزمة APK
                </span>
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
                  <span>{copiedTarget === 'manifest' ? 'تم النسخ' : 'نسخ التصاريح'}</span>
                </Button>
              </div>
              <pre
                dir="ltr"
                className="font-mono-tabular overflow-x-auto rounded-xl border border-[#E2E8F0] bg-[#0B0D10] p-3.5 text-[11px] leading-relaxed text-[#CBD5E1] dark:border-[#232936]"
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
