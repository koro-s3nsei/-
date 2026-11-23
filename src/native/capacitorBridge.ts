import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import type { MicroStepRecord } from '../types/models';

/**
 * Native CapacitorJS Bridge for Standard Android Runtime Permissions:
 * - LocalNotifications (POST_NOTIFICATIONS + SCHEDULE_EXACT_ALARM)
 * - SpeechRecognition / Microphone (RECORD_AUDIO)
 * Triggers official Android "Allow / سماح" system dialogs immediately on tap.
 */

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
    return 'Android APK';
  }
  if (isNativeCapacitorPlatform()) {
    return Capacitor.getPlatform();
  }
  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true);
  return isStandalone ? 'PWA مثبت' : 'متصفح ويب';
}

export async function checkPermissionsStatus(): Promise<{
  notificationsGranted: boolean;
  microphoneGranted: boolean;
}> {
  if (isNativeCapacitorPlatform()) {
    let notificationsGranted = false;
    let microphoneGranted = false;

    try {
      const notif = await LocalNotifications.checkPermissions();
      notificationsGranted = notif.display === 'granted';
    } catch {
      notificationsGranted = false;
    }

    try {
      const speech = await SpeechRecognition.checkPermissions();
      microphoneGranted = speech.speechRecognition === 'granted';
    } catch {
      microphoneGranted = false;
    }

    return { notificationsGranted, microphoneGranted };
  }

  // Web/PWA check
  const notificationsGranted =
    typeof Notification !== 'undefined' && Notification.permission === 'granted';
  let microphoneGranted = false;
  if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
    try {
      const mic = await navigator.permissions.query({
        name: 'microphone' as PermissionName,
      });
      microphoneGranted = mic.state === 'granted';
    } catch {
      microphoneGranted = false;
    }
  }
  return { notificationsGranted, microphoneGranted };
}

export async function ensureAlarmNotificationChannel(): Promise<void> {
  if (!isCapacitorAndroidRuntime()) return;
  try {
    await LocalNotifications.createChannel({
      id: 'strict-focus-alarm',
      name: 'منبه المهام الصارم',
      description: 'تنبيهات مواعيد الخطوات التنفيذية المجدولة',
      importance: 5,
      visibility: 1,
      vibration: true,
    });
  } catch {
    // Channel already exists or platform ignores channels
  }
}

export async function requestAlarmNotificationPermission(): Promise<{
  granted: boolean;
  message: string;
}> {
  if (isNativeCapacitorPlatform()) {
    try {
      await ensureAlarmNotificationChannel();
      const result = await LocalNotifications.requestPermissions();
      const granted = result.display === 'granted';
      return {
        granted,
        message: granted
          ? 'تم منح إذن الإشعارات والمنبه بنجاح.'
          : 'لم يتم منح إذن الإشعارات. يمكنك إعادة المحاولة أو المتابعة بالمنبه داخل التطبيق.',
      };
    } catch (err) {
      return {
        granted: false,
        message: err instanceof Error ? err.message : 'تعذر طلب إذن الإشعارات من النظام.',
      };
    }
  }

  // Web browser standard Notification API
  if (typeof Notification === 'undefined') {
    return {
      granted: false,
      message: 'متاح على نسخة APK والمتصفحات الداعمة للإشعارات.',
    };
  }

  try {
    const res = await Notification.requestPermission();
    const granted = res === 'granted';
    return {
      granted,
      message: granted
        ? 'تم تفعيل إشعارات المتصفح للمنبه.'
        : 'تم رفض إذن الإشعارات في المتصفح.',
    };
  } catch {
    return {
      granted: false,
      message: 'تعذر طلب إذن الإشعارات في هذا المتصفح.',
    };
  }
}

export async function requestMicrophonePermission(): Promise<{
  granted: boolean;
  message: string;
}> {
  if (isNativeCapacitorPlatform()) {
    try {
      const result = await SpeechRecognition.requestPermissions();
      const granted = result.speechRecognition === 'granted';
      return {
        granted,
        message: granted
          ? 'تم منح إذن الميكروفون والإملاء الصوتي بنجاح.'
          : 'لم يتم منح إذن الميكروفون.',
      };
    } catch {
      // Fallback to getUserMedia inside WebView
    }
  }

  if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      return {
        granted: true,
        message: 'تم منح إذن الميكروفون بنجاح.',
      };
    } catch {
      return {
        granted: false,
        message: 'تم رفض الوصول للميكروفون أو لا يوجد ميكروفون متصل.',
      };
    }
  }

  return {
    granted: false,
    message: 'إذن الميكروفون غير متاح في هذه البيئة.',
  };
}

export async function scheduleNativeStepNotification(
  step: MicroStepRecord,
  projectTitle: string
): Promise<boolean> {
  if (!isNativeCapacitorPlatform() || !step.scheduledDate || !step.scheduledStartTime) {
    return false;
  }
  try {
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') return false;
    await ensureAlarmNotificationChannel();

    const [y, m, d] = step.scheduledDate.split('-').map(Number);
    const [hh, mm] = step.scheduledStartTime.split(':').map(Number);
    const fireAt = new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0);
    if (fireAt.getTime() <= Date.now()) return false;

    const numericId = Math.abs(
      step.id.split('').reduce((acc, ch) => ((acc << 5) - acc + ch.charCodeAt(0)) | 0, 0)
    ) % 2147483000;

    await LocalNotifications.schedule({
      notifications: [
        {
          id: numericId || 1001,
          title: `حان موعد المهمة · ${projectTitle}`,
          body: step.title,
          channelId: 'strict-focus-alarm',
          schedule: { at: fireAt, allowWhileIdle: true },
        },
      ],
    });
    return true;
  } catch {
    return false;
  }
}

export async function fireImmediateTestNotification(): Promise<boolean> {
  if (isNativeCapacitorPlatform()) {
    try {
      const perm = await LocalNotifications.requestPermissions();
      if (perm.display !== 'granted') return false;
      await ensureAlarmNotificationChannel();
      await LocalNotifications.schedule({
        notifications: [
          {
            id: Math.floor(Date.now() % 1000000),
            title: 'منبه الفيلسوف مبعسس',
            body: 'اختبار إشعار المنبه الأصلي بنجاح.',
            channelId: 'strict-focus-alarm',
            schedule: { at: new Date(Date.now() + 1500), allowWhileIdle: true },
          },
        ],
      });
      return true;
    } catch {
      return false;
    }
  }
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification('منبه الفيلسوف مبعسس', {
      body: 'إشعار المنبه يعمل بنجاح.',
    });
    return true;
  }
  return false;
}

export async function detectDistractionActivityLabel(): Promise<{
  activityName: string;
  source: 'page-visibility' | 'window-blur' | 'android-usage-stats';
}> {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    return {
      activityName: 'تطبيق أو تبويب آخر',
      source: 'page-visibility',
    };
  }
  return {
    activityName: 'نافذة خارجية',
    source: 'window-blur',
  };
}
