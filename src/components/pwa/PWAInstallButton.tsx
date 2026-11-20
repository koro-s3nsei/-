import React, { useState } from 'react';
import { Download, Share, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../../hooks/usePWAInstall';
import { Button } from '../ui/primitives';

interface PWAInstallButtonProps {
  compact?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      await install();
    } else {
      setShowGuide(true);
    }
  };

  return (
    <>
      <Button
        variant={compact ? 'outline' : 'primary'}
        size={compact ? 'sm' : 'md'}
        onClick={handleClick}
      >
        <Download className="h-4 w-4" strokeWidth={1.75} />
        <span>{compact ? 'تثبيت التطبيق' : 'تثبيت التطبيق على الجهاز (PWA)'}</span>
      </Button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="تعليمات تثبيت التطبيق"
        >
          <div className="w-full max-w-md rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-6 dark:border-[#232936] dark:bg-[#13161C]">
            <div className="flex items-center justify-between gap-4 border-b border-[#E2E8F0] pb-4 dark:border-[#232936]">
              <h3 className="text-base font-semibold">تثبيت تطبيق الفيلسوف مبعسس</h3>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="إغلاق"
                className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-[#64748B] hover:bg-[#EEF1F6] dark:hover:bg-[#1A1F28]"
              >
                <X className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-sm leading-relaxed text-[#475569] dark:text-[#CBD5E1]">
              {isIOS ? (
                <>
                  <p>لتثبيت التطبيق على iPhone أو iPad عبر Safari:</p>
                  <ol className="list-decimal space-y-2 pr-5">
                    <li className="flex items-center gap-1.5">
                      <span>اضغط على زر المشاركة</span>
                      <Share className="inline h-4 w-4 text-blue-500" strokeWidth={1.75} />
                      <span>في شريط Safari السفلي.</span>
                    </li>
                    <li>مرّر للأسفل واختر «إضافة إلى الشاشة الرئيسية» (Add to Home Screen).</li>
                    <li>اضغط «إضافة» ليعمل التطبيق بملء الشاشة ودون إنترنت.</li>
                  </ol>
                </>
              ) : (
                <>
                  <p>لتثبيت التطبيق كـ PWA يعمل محلياً دون إنترنت:</p>
                  <ol className="list-decimal space-y-2 pr-5">
                    <li>افتح قائمة المتصفح (Chrome / Edge) من الزاوية العلوية.</li>
                    <li>اختر «تثبيت التطبيق» (Install App) أو «إضافة إلى الشاشة الرئيسية».</li>
                    <li>يمكنك أيضاً بناء حزمة APK أصلية للأندرويد عبر Capacitor من الإعدادات.</li>
                  </ol>
                </>
              )}
            </div>

            <div className="mt-6 flex justify-end">
              <Button variant="secondary" onClick={() => setShowGuide(false)}>
                إغلاق
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-20 left-4 z-40 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-600 px-3.5 py-2 text-xs font-medium text-white shadow-lg lg:bottom-4"
    >
      <WifiOff className="h-4 w-4 shrink-0" strokeWidth={1.75} />
      <span>وضع عدم الاتصال — يعمل التخزين المحلي IndexedDB والمحرك الاحتياطي بكفاءة.</span>
    </div>
  );
};
