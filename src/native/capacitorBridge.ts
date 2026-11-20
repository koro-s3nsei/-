import { Capacitor } from '@capacitor/core';

/**
 * CapacitorJS Native Android Bridge Adapter.
 * Uses real Capacitor.isNativePlatform() detection to distinguish compiled Android APK
 * from Web/Desktop browser sessions (no fake "granted" statuses on web).
 */

interface FocusGuardPlugin {
  requestOverlayPermission?: () => Promise<{ granted: boolean }>;
  requestUsageStatsPermission?: () => Promise<{ granted: boolean }>;
  getForegroundAppName?: () => Promise<{ appName: string }>;
}

interface CapacitorPluginWindow extends Window {
  Capacitor?: {
    Plugins?: {
      FocusGuard?: FocusGuardPlugin;
    };
  };
}

export function isNativeCapacitorPlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function isCapacitorAndroidRuntime(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
}

export function getRuntimeEnvironmentLabel(): string {
  if (isCapacitorAndroidRuntime()) {
    return 'Android APK (Capacitor Native)';
  }
  if (isNativeCapacitorPlatform()) {
    return `تطبيق أصلي (${Capacitor.getPlatform()})`;
  }
  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true);
  return isStandalone ? 'تطبيق ويب مثبت (PWA Standalone)' : 'متصفح ويب (PWA Mode)';
}

export async function requestAndroidOverlayPermission(): Promise<{
  granted: boolean;
  isNative: boolean;
  message: string;
}> {
  if (!isNativeCapacitorPlatform()) {
    return {
      granted: false,
      isNative: false,
      message: 'متاح على نسخة APK فقط. قم بتثبيت حزمة الأندرويد لتفعيل الظهور فوق التطبيقات.',
    };
  }

  const plugin = (window as CapacitorPluginWindow).Capacitor?.Plugins?.FocusGuard;
  if (plugin?.requestOverlayPermission) {
    const res = await plugin.requestOverlayPermission();
    return {
      granted: res.granted,
      isNative: true,
      message: res.granted
        ? 'تم تفعيل صلاحية الظهور فوق التطبيقات على النظام.'
        : 'يرجى تفعيل الخيار من إعدادات الأندرويد المفتوحة ثم العودة.',
    };
  }

  return {
    granted: false,
    isNative: true,
    message: 'افتح إعدادات التطبيق في أندرويد وفعّل خيار «الظهور فوق التطبيقات الأخرى».',
  };
}

export async function requestAndroidUsageStatsPermission(): Promise<{
  granted: boolean;
  isNative: boolean;
  message: string;
}> {
  if (!isNativeCapacitorPlatform()) {
    return {
      granted: false,
      isNative: false,
      message: 'متاح على نسخة APK فقط. في الويب تُستخدم Page Visibility API تلقائياً.',
    };
  }

  const plugin = (window as CapacitorPluginWindow).Capacitor?.Plugins?.FocusGuard;
  if (plugin?.requestUsageStatsPermission) {
    const res = await plugin.requestUsageStatsPermission();
    return {
      granted: res.granted,
      isNative: true,
      message: res.granted
        ? 'تم تفعيل صلاحية الوصول لبيانات الاستخدام (UsageStatsManager).'
        : 'يرجى منح صلاحية بيانات الاستخدام لتطبيق الفيلسوف مبعسس في إعدادات النظام.',
    };
  }

  return {
    granted: false,
    isNative: true,
    message: 'افتح «الوصول إلى بيانات الاستخدام» في أندرويد وفعّل الصلاحية لتطبيق الفيلسوف مبعسس.',
  };
}

export async function detectDistractionActivityLabel(): Promise<{
  activityName: string;
  source: 'page-visibility' | 'window-blur' | 'android-usage-stats';
}> {
  if (isNativeCapacitorPlatform()) {
    const plugin = (window as CapacitorPluginWindow).Capacitor?.Plugins?.FocusGuard;
    if (plugin?.getForegroundAppName) {
      try {
        const res = await plugin.getForegroundAppName();
        if (res?.appName) {
          return { activityName: res.appName, source: 'android-usage-stats' };
        }
      } catch {
        // Fallback to web visibility below
      }
    }
  }

  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    return {
      activityName: 'تبويب أو تطبيق خارجي آخر',
      source: 'page-visibility',
    };
  }
  return {
    activityName: 'نافذة خارجية بعيدة عن المهمة',
    source: 'window-blur',
  };
}
