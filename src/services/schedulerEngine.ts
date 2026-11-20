import type {
  FixedCommitmentRecord,
  FreeTimeWindow,
  MicroStepRecord,
  ProjectHorizon,
} from '../types/models';
import {
  addDaysToISODate,
  formatMinutesToTime,
  parseTimeToMinutes,
  toISODate,
} from '../lib/utils';

const DAY_START_MIN = 6 * 60; // 06:00
const DAY_END_MIN = 23 * 60 + 30; // 23:30
const BUFFER_MINUTES = 10;

interface Interval {
  start: number;
  end: number;
}

function mergeBusyIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = sorted[i];
    if (curr.start <= prev.end) {
      prev.end = Math.max(prev.end, curr.end);
    } else {
      merged.push({ ...curr });
    }
  }
  return merged;
}

/**
 * Calculates real free-time windows for a given date after subtracting active fixed commitments
 * and optionally already-scheduled micro-steps.
 */
export function computeFreeWindowsForDate(
  date: Date,
  commitments: FixedCommitmentRecord[],
  existingScheduledSteps: MicroStepRecord[] = []
): FreeTimeWindow[] {
  const isoDate = toISODate(date);
  const dayOfWeek = date.getDay();

  const busyIntervals: Interval[] = [];

  for (const c of commitments) {
    if (!c.isActive || !c.daysOfWeek.includes(dayOfWeek)) continue;
    const start = parseTimeToMinutes(c.startTime);
    const end = parseTimeToMinutes(c.endTime);

    if (end > start) {
      busyIntervals.push({
        start: Math.max(DAY_START_MIN, start),
        end: Math.min(DAY_END_MIN, end),
      });
    } else if (end < start) {
      // Cross-midnight commitment (e.g., sleep 23:00 -> 06:30)
      busyIntervals.push({ start: Math.max(DAY_START_MIN, start), end: DAY_END_MIN });
      busyIntervals.push({ start: DAY_START_MIN, end: Math.min(DAY_END_MIN, end) });
    }
  }

  for (const step of existingScheduledSteps) {
    if (
      step.scheduledDate === isoDate &&
      step.scheduledStartTime &&
      step.scheduledEndTime &&
      step.status !== 'completed'
    ) {
      const start = parseTimeToMinutes(step.scheduledStartTime);
      const end = parseTimeToMinutes(step.scheduledEndTime);
      if (end > start) {
        busyIntervals.push({
          start: Math.max(DAY_START_MIN, start),
          end: Math.min(DAY_END_MIN, end + BUFFER_MINUTES),
        });
      }
    }
  }

  const validBusy = busyIntervals.filter((b) => b.end > b.start);
  const merged = mergeBusyIntervals(validBusy);

  const freeWindows: FreeTimeWindow[] = [];
  let cursor = DAY_START_MIN;

  for (const block of merged) {
    if (block.start - cursor >= 15) {
      freeWindows.push({
        date: isoDate,
        dayOfWeek,
        startTime: formatMinutesToTime(cursor),
        endTime: formatMinutesToTime(block.start),
        durationMinutes: block.start - cursor,
      });
    }
    cursor = Math.max(cursor, block.end);
  }

  if (DAY_END_MIN - cursor >= 15) {
    freeWindows.push({
      date: isoDate,
      dayOfWeek,
      startTime: formatMinutesToTime(cursor),
      endTime: formatMinutesToTime(DAY_END_MIN),
      durationMinutes: DAY_END_MIN - cursor,
    });
  }

  return freeWindows;
}

export function getHorizonDaysCount(horizon: ProjectHorizon): number {
  switch (horizon) {
    case 'day':
      return 1;
    case 'week':
      return 7;
    case 'month':
      return 30;
    case 'year':
      return 365;
  }
}

/**
 * Distributes pre-computed micro-steps cleanly into real available free-time windows
 * over the selected horizon (day / week / month / year).
 */
export function allocateStepsAcrossFreeTime(
  stepsToSchedule: MicroStepRecord[],
  commitments: FixedCommitmentRecord[],
  alreadyScheduledSteps: MicroStepRecord[],
  horizon: ProjectHorizon,
  startDate: Date = new Date()
): MicroStepRecord[] {
  const maxDays = Math.min(getHorizonDaysCount(horizon), 365);
  const pendingSteps = [...stepsToSchedule].sort((a, b) => a.orderIndex - b.orderIndex);
  if (pendingSteps.length === 0) return [];

  // Spread cadence across longer horizons so a month/year project distributes sustainably
  const stepSpacingDays =
    horizon === 'year'
      ? Math.max(1, Math.floor(Math.min(180, maxDays) / Math.max(1, pendingSteps.length)))
      : horizon === 'month'
        ? Math.max(1, Math.floor(Math.min(28, maxDays) / Math.max(1, pendingSteps.length)))
        : 0;

  const workingScheduled = [...alreadyScheduledSteps];
  const result: MicroStepRecord[] = [];
  let dayPointer = 0;

  for (const step of pendingSteps) {
    const duration = Math.max(10, step.durationMinutes || 20);
    let placed = false;

    for (let offset = dayPointer; offset < maxDays + 14; offset++) {
      const targetDate = new Date(startDate.getTime());
      targetDate.setDate(targetDate.getDate() + offset);
      const isoDate = toISODate(targetDate);
      const freeWindows = computeFreeWindowsForDate(targetDate, commitments, workingScheduled);

      const fittingWindow = freeWindows.find((w) => w.durationMinutes >= duration);
      if (fittingWindow) {
        const startMin = parseTimeToMinutes(fittingWindow.startTime);
        const endMin = startMin + duration;
        const scheduledStep: MicroStepRecord = {
          ...step,
          scheduledDate: isoDate,
          scheduledStartTime: formatMinutesToTime(startMin),
          scheduledEndTime: formatMinutesToTime(endMin),
          updatedAt: new Date().toISOString(),
        };
        result.push(scheduledStep);
        workingScheduled.push(scheduledStep);
        placed = true;
        if (stepSpacingDays > 0) {
          dayPointer = offset + stepSpacingDays;
        } else {
          dayPointer = offset;
        }
        break;
      }
    }

    if (!placed) {
      // Fallback to end of horizon window if completely packed
      const fallbackDate = addDaysToISODate(startDate, dayPointer);
      result.push({
        ...step,
        scheduledDate: fallbackDate,
        scheduledStartTime: '20:00',
        scheduledEndTime: formatMinutesToTime(20 * 60 + duration),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  return result;
}
