import React, { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertCircle,
  Check,
  Copy,
  Edit3,
  FileText,
  Lightbulb,
  Plus,
  Save,
  X,
} from 'lucide-react';
import { db, enqueueSyncChange } from '../../db/dexie';
import type { LogicalErrorSpan } from '../../types/models';
import { ErrorActionBanner } from '../ui/ErrorActionBanner';
import { Button, Textarea } from '../ui/primitives';

interface OriginalTextModalProps {
  captureId: string;
  title?: string;
  onClose: () => void;
}

/**
 * Standalone Verbatim Original Text Window.
 * Displays exactly what the user wrote/dictated without splitting it into tasks,
 * alongside optional highlighted logical errors (Apply Fix / Ignore & Continue)
 * and extra suggested ideas that can be kept or merged into the note anytime.
 */
export const OriginalTextModal: React.FC<OriginalTextModalProps> = ({
  captureId,
  title,
  onClose,
}) => {
  const capture = useLiveQuery(() => db.captures.get(captureId), [captureId]);

  const [isEditing, setIsEditing] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [openErrorId, setOpenErrorId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<{
    message: string;
    onFix?: () => void;
  } | null>(null);

  useEffect(() => {
    if (capture && !isEditing) {
      setDraftText(capture.rawInput);
    }
  }, [capture, isEditing]);

  const rawText = capture?.rawInput ?? '';
  const logicalErrors = capture?.logicalErrors ?? [];
  const extraIdeas = capture?.extraIdeas ?? [];

  const persistCaptureUpdate = async (
    patch: Partial<{
      rawInput: string;
      logicalErrors: LogicalErrorSpan[];
      extraIdeas: string[];
    }>,
    successMessage?: string
  ) => {
    if (!capture) return;
    setErrorState(null);
    const now = new Date().toISOString();
    const updated = {
      ...capture,
      ...patch,
      updatedAt: now,
    };
    try {
      await db.captures.put(updated);
      await enqueueSyncChange('captures', capture.id, 'upsert', updated);
      if (successMessage) {
        setNotice(successMessage);
        setTimeout(() => setNotice(null), 2200);
      }
    } catch (err) {
      setErrorState({
        message: err instanceof Error ? err.message : 'تعذر حفظ التعديلات محلياً.',
        onFix: () => {
          setErrorState(null);
          void persistCaptureUpdate(patch, successMessage);
        },
      });
    }
  };

  const handleSaveManualEdit = async () => {
    await persistCaptureUpdate({ rawInput: draftText }, 'تم حفظ النص الأصلي.');
    setIsEditing(false);
  };

  const handleApplyErrorFix = async (errItem: LogicalErrorSpan) => {
    const nextText = rawText.replace(errItem.originalSegment, errItem.suggestedFix);
    const nextErrors = logicalErrors.filter((item) => item.id !== errItem.id);
    setOpenErrorId(null);
    await persistCaptureUpdate(
      { rawInput: nextText, logicalErrors: nextErrors },
      'تم تطبيق الإصلاح على النص.'
    );
  };

  const handleIgnoreError = async (errId: string) => {
    const nextErrors = logicalErrors.filter((item) => item.id !== errId);
    setOpenErrorId(null);
    await persistCaptureUpdate({ logicalErrors: nextErrors });
  };

  const handleAppendIdeaToText = async (idea: string) => {
    const nextText = rawText.trim() ? `${rawText.trim()}\n- ${idea}` : idea;
    const nextIdeas = extraIdeas.filter((item) => item !== idea);
    await persistCaptureUpdate(
      { rawInput: nextText, extraIdeas: nextIdeas },
      'تم إدراج الإضافة داخل النص.'
    );
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(rawText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setErrorState({
        message: 'تعذر النسخ التلقائي إلى الحافظة.',
        onFix: () => {
          setErrorState(null);
          void handleCopy();
        },
      });
    }
  };

  const annotatedSegments = useMemo(() => {
    if (!rawText.trim() || logicalErrors.length === 0) return null;

    interface MatchSpan {
      start: number;
      end: number;
      error: LogicalErrorSpan;
    }

    const spans: MatchSpan[] = [];
    for (const err of logicalErrors) {
      const idx = rawText.indexOf(err.originalSegment);
      if (idx !== -1) {
        spans.push({ start: idx, end: idx + err.originalSegment.length, error: err });
      }
    }

    if (spans.length === 0) return null;
    spans.sort((a, b) => a.start - b.start);

    const cleanSpans: MatchSpan[] = [];
    let lastEnd = 0;
    for (const sp of spans) {
      if (sp.start >= lastEnd) {
        cleanSpans.push(sp);
        lastEnd = sp.end;
      }
    }

    const parts: Array<
      { type: 'text'; value: string } | { type: 'error'; error: LogicalErrorSpan }
    > = [];
    let cursor = 0;
    for (const sp of cleanSpans) {
      if (sp.start > cursor) {
        parts.push({ type: 'text', value: rawText.slice(cursor, sp.start) });
      }
      parts.push({ type: 'error', error: sp.error });
      cursor = sp.end;
    }
    if (cursor < rawText.length) {
      parts.push({ type: 'text', value: rawText.slice(cursor) });
    }
    return parts;
  }, [rawText, logicalErrors]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 backdrop-blur-xs sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="نافذة النص الأصلي المحفوظ"
    >
      <div className="flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white text-[#111318] shadow-2xl dark:border-[#222630] dark:bg-[#13151B] dark:text-[#F4F5F7]">
        {/* Header */}
        <header className="flex items-center justify-between gap-3 border-b border-[#E5E7EB] px-5 py-3.5 dark:border-[#222630]">
          <div className="flex min-w-0 items-center gap-2.5">
            <FileText className="h-4 w-4 shrink-0 text-blue-500" strokeWidth={1.75} />
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold">
                {title ? `النص الأصلي · ${title}` : 'النص الأصلي كما كُتب'}
              </h2>
              {capture && (
                <p className="font-mono-tabular text-[11px] text-[#6B7280] dark:text-[#9CA3AF]">
                  محفوظ نصاً دون تقسيم ·{' '}
                  {new Date(capture.updatedAt).toLocaleDateString('ar-SA')}
                </p>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => void handleCopy()}>
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-500" strokeWidth={1.75} />
              ) : (
                <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
              )}
              <span>{copied ? 'نُسخ' : 'نسخ'}</span>
            </Button>

            {isEditing ? (
              <Button variant="primary" size="sm" onClick={() => void handleSaveManualEdit()}>
                <Save className="h-3.5 w-3.5" strokeWidth={1.75} />
                <span>حفظ</span>
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                <Edit3 className="h-3.5 w-3.5" strokeWidth={1.75} />
                <span>تعديل</span>
              </Button>
            )}

            <Button variant="ghost" size="icon" onClick={onClose} aria-label="إغلاق">
              <X className="h-4 w-4" strokeWidth={1.75} />
            </Button>
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {errorState && (
            <ErrorActionBanner
              message={errorState.message}
              onApplyFix={errorState.onFix}
              onIgnore={() => setErrorState(null)}
            />
          )}

          {notice && (
            <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">{notice}</p>
          )}

          {!capture ? (
            <p className="py-10 text-center text-sm text-[#6B7280] dark:text-[#9CA3AF]">
              لم يُعثر على النص المحفوظ.
            </p>
          ) : (
            <>
              {/* Verbatim Text Area */}
              <div className="rounded-xl border border-[#E5E7EB] bg-[#FAFAFA] p-4 dark:border-[#222630] dark:bg-[#0E1015]">
                {isEditing ? (
                  <div className="space-y-3">
                    <Textarea
                      rows={9}
                      value={draftText}
                      onChange={(e) => setDraftText(e.target.value)}
                      className="bg-white dark:bg-[#13151B]"
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setDraftText(rawText);
                          setIsEditing(false);
                        }}
                      >
                        إلغاء
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => void handleSaveManualEdit()}
                      >
                        حفظ التعديل
                      </Button>
                    </div>
                  </div>
                ) : annotatedSegments ? (
                  <div className="text-sm leading-8 text-[#111318] dark:text-[#F4F5F7]">
                    {annotatedSegments.map((seg, idx) => {
                      if (seg.type === 'text') {
                        return (
                          <span key={`seg-${idx}`} className="whitespace-pre-wrap">
                            {seg.value}
                          </span>
                        );
                      }
                      const isOpen = openErrorId === seg.error.id;
                      return (
                        <span key={seg.error.id} className="inline">
                          <span className="rounded border-b-2 border-red-500 bg-red-500/12 px-1 py-0.5">
                            {seg.error.originalSegment}
                          </span>
                          <button
                            type="button"
                            onClick={() => setOpenErrorId(isOpen ? null : seg.error.id)}
                            aria-label="ملاحظة اختيارية"
                            className="mx-1 inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md bg-red-500/12 align-middle text-red-600 hover:bg-red-500/20 dark:text-red-400"
                          >
                            <AlertCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap text-sm leading-8 text-[#111318] dark:text-[#F4F5F7]">
                    {rawText}
                  </p>
                )}
              </div>

              {/* Optional Logical Errors Section (Two-Choice Non-Blocking) */}
              {logicalErrors.length > 0 && (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h3 className="flex items-center gap-1.5 text-xs font-semibold text-red-600 dark:text-red-400">
                      <AlertCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
                      <span>أخطاء اختيارية للتعديل ({logicalErrors.length})</span>
                    </h3>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void persistCaptureUpdate({ logicalErrors: [] })}
                    >
                      تجاهل الكل
                    </Button>
                  </div>

                  <div className="space-y-2">
                    {logicalErrors.map((err) => (
                      <div
                        key={err.id}
                        className={`rounded-xl border p-3.5 text-xs ${
                          openErrorId === err.id
                            ? 'border-red-500/50 bg-red-500/8'
                            : 'border-[#E5E7EB] bg-[#FAFAFA] dark:border-[#222630] dark:bg-[#0E1015]'
                        }`}
                      >
                        <p className="font-semibold text-red-600 dark:text-red-400">
                          {err.reason}
                        </p>
                        <p className="mt-1 text-[#6B7280] dark:text-[#9CA3AF]">
                          النص: «{err.originalSegment}»
                        </p>
                        <p className="mt-1 text-[#111318] dark:text-[#E5E7EB]">
                          المقترح: {err.suggestedFix}
                        </p>
                        <div className="mt-3 flex flex-wrap justify-end gap-2">
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => void handleApplyErrorFix(err)}
                          >
                            <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
                            <span>تطبيق الإصلاح</span>
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void handleIgnoreError(err.id)}
                          >
                            <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                            <span>تجاهل والاستمرار كما هو</span>
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Extra Ideas Section */}
              {extraIdeas.length > 0 && (
                <div className="space-y-2.5 border-t border-[#E5E7EB] pt-4 dark:border-[#222630]">
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold text-[#6B7280] dark:text-[#9CA3AF]">
                    <Lightbulb className="h-3.5 w-3.5 text-blue-500" strokeWidth={1.75} />
                    <span>إضافات مقترحة ({extraIdeas.length})</span>
                  </h3>
                  <ul className="space-y-2">
                    {extraIdeas.map((idea, idx) => (
                      <li
                        key={idx}
                        className="flex flex-col gap-2 rounded-xl border border-[#E5E7EB] bg-[#FAFAFA] p-3 text-xs sm:flex-row sm:items-center sm:justify-between dark:border-[#222630] dark:bg-[#0E1015]"
                      >
                        <span className="leading-relaxed text-[#111318] dark:text-[#E5E7EB]">
                          {idea}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void handleAppendIdeaToText(idea)}
                        >
                          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                          <span>إدراج في النص</span>
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
