import React from 'react';
import { AlertCircle, Check, X } from 'lucide-react';
import { Button } from './primitives';

interface ErrorActionBannerProps {
  message: string;
  fixLabel?: string;
  onApplyFix?: () => void;
  onIgnore: () => void;
}

/**
 * Standard Non-Blocking Error Banner.
 * Always gives the user two clear choices: "تطبيق الإصلاح" or "تجاهل والاستمرار كما هو"
 * without blocking or locking the screen.
 */
export const ErrorActionBanner: React.FC<ErrorActionBannerProps> = ({
  message,
  fixLabel = 'تطبيق الإصلاح',
  onApplyFix,
  onIgnore,
}) => {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-xl border border-red-500/25 bg-red-500/8 p-3.5 text-xs sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-2.5 text-red-700 dark:text-red-300">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
        <span className="leading-relaxed">{message}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        {onApplyFix && (
          <Button variant="primary" size="sm" onClick={onApplyFix}>
            <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span>{fixLabel}</span>
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onIgnore}>
          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span>تجاهل والاستمرار كما هو</span>
        </Button>
      </div>
    </div>
  );
};
