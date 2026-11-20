import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDaysToISODate(baseDate: Date, offsetDays: number): string {
  const d = new Date(baseDate.getTime());
  d.setDate(d.getDate() + offsetDays);
  return toISODate(d);
}

export function parseTimeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map((n) => parseInt(n, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

export function formatMinutesToTime(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(totalMinutes)));
  const hours = Math.floor(clamped / 60);
  const mins = clamped % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

export const ARABIC_DAYS_SHORT: Record<number, string> = {
  0: 'الأحد',
  1: 'الإثنين',
  2: 'الثلاثاء',
  3: 'الأربعاء',
  4: 'الخميس',
  5: 'الجمعة',
  6: 'السبت',
};

export const HORIZON_LABELS: Record<'day' | 'week' | 'month' | 'year', string> = {
  day: 'يوم واحد',
  week: 'أسبوع',
  month: 'شهر',
  year: 'سنة',
};

export const COMMITMENT_CATEGORY_LABELS: Record<
  'work' | 'study' | 'sleep' | 'personal' | 'other',
  string
> = {
  work: 'عمل',
  study: 'دراسة',
  sleep: 'نوم',
  personal: 'التزام شخصي',
  other: 'أخرى',
};

export function formatArabicDate(isoDate?: string): string {
  if (!isoDate) return 'غير مجدول';
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  const dateObj = new Date(y, m - 1, d);
  const dayName = ARABIC_DAYS_SHORT[dateObj.getDay()] ?? '';
  return `${dayName} ${d}/${m}`;
}
