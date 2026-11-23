import type { MicroStepRecord, ProjectRecord, TaskRecord } from '../types/models';
import { HORIZON_LABELS } from '../lib/utils';

/**
 * 100% Local High-Resolution PNG Summary & Roadmap Renderer (3x Retina Canvas).
 * Draws crisp Arabic RTL typography directly from local IndexedDB project data
 * with ZERO external API calls and ZERO Gemini quota consumption.
 * Features strict RTL Arabic word wrapping (explicit newlines, long-token breaking,
 * measureText width clamping, and per-column Canvas clipping).
 */

function breakLongToken(
  ctx: CanvasRenderingContext2D,
  token: string,
  maxWidth: number
): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const ch of Array.from(token)) {
    const candidate = current + ch;
    if (current && ctx.measureText(candidate).width > maxWidth) {
      chunks.push(current);
      current = ch;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [token];
}

function clampWithEllipsis(
  ctx: CanvasRenderingContext2D,
  line: string,
  maxWidth: number
): string {
  const ellipsis = '...';
  if (ctx.measureText(line).width <= maxWidth) return line;
  const chars = Array.from(line);
  while (chars.length > 1 && ctx.measureText(chars.join('') + ellipsis).width > maxWidth) {
    chars.pop();
  }
  return `${chars.join('').trimEnd()}${ellipsis}`;
}

export function wrapArabicText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const safeMaxWidth = Math.max(40, maxWidth);
  const paragraphs = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return [];

  const allWrapped: string[] = [];

  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    let currentLine = '';

    for (const rawWord of words) {
      // If a single word exceeds maxWidth on its own, split it cleanly
      if (ctx.measureText(rawWord).width > safeMaxWidth) {
        if (currentLine) {
          allWrapped.push(currentLine);
          currentLine = '';
        }
        const splitPieces = breakLongToken(ctx, rawWord, safeMaxWidth);
        for (let i = 0; i < splitPieces.length; i++) {
          if (i < splitPieces.length - 1) {
            allWrapped.push(splitPieces[i]);
          } else {
            currentLine = splitPieces[i];
          }
        }
        continue;
      }

      const candidate = currentLine ? `${currentLine} ${rawWord}` : rawWord;
      if (ctx.measureText(candidate).width <= safeMaxWidth) {
        currentLine = candidate;
      } else {
        if (currentLine) allWrapped.push(currentLine);
        currentLine = rawWord;
      }
    }

    if (currentLine) {
      allWrapped.push(currentLine);
    }
  }

  if (allWrapped.length <= maxLines) {
    return allWrapped.map((ln) => clampWithEllipsis(ctx, ln, safeMaxWidth));
  }

  const trimmed = allWrapped.slice(0, maxLines);
  trimmed[maxLines - 1] = clampWithEllipsis(
    ctx,
    `${trimmed[maxLines - 1]} ${allWrapped[maxLines] ?? ''}`.trim(),
    safeMaxWidth
  );
  return trimmed;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export async function renderProjectSummaryPng(
  project: ProjectRecord,
  tasks: TaskRecord[],
  steps: MicroStepRecord[],
  themeMode: 'dark' | 'light' = 'dark'
): Promise<string> {
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // Proceed if font observer fails
    }
  }

  const logicalWidth = 1040;
  const logicalHeight = 640;
  const dpr = 3; // 3x ultra-sharp Retina PNG (3120x1920)

  const canvas = document.createElement('canvas');
  canvas.width = logicalWidth * dpr;
  canvas.height = logicalHeight * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('تعذر تهيئة محرك الرسم المحلي (Canvas 2D).');
  }

  ctx.scale(dpr, dpr);
  ctx.direction = 'rtl';
  ctx.textBaseline = 'top';

  const palette =
    themeMode === 'dark'
      ? {
          bg: '#0C0D10',
          surface: '#14171E',
          surfaceAlt: '#1A1E28',
          border: '#262B36',
          text: '#F4F5F7',
          muted: '#9CA3AF',
          accent: '#3B82F6',
          success: '#22C55E',
          track: '#232834',
        }
      : {
          bg: '#FAFAFA',
          surface: '#FFFFFF',
          surfaceAlt: '#F3F4F6',
          border: '#E5E7EB',
          text: '#111318',
          muted: '#6B7280',
          accent: '#2563EB',
          success: '#16A34A',
          track: '#E5E7EB',
        };

  // Canvas background
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, logicalWidth, logicalHeight);

  // Subtle geometric dot grid
  ctx.fillStyle = themeMode === 'dark' ? 'rgba(255,255,255,0.032)' : 'rgba(17,19,24,0.035)';
  for (let gx = 28; gx < logicalWidth; gx += 28) {
    for (let gy = 28; gy < logicalHeight; gy += 28) {
      ctx.fillRect(gx, gy, 1.5, 1.5);
    }
  }

  // Outer card frame with clipping boundary
  const cardX = 28;
  const cardY = 28;
  const cardW = logicalWidth - 56;
  const cardH = logicalHeight - 56;

  drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 20);
  ctx.fillStyle = palette.surface;
  ctx.fill();
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = palette.border;
  ctx.stroke();

  ctx.save();
  drawRoundedRect(ctx, cardX + 1, cardY + 1, cardW - 2, cardH - 2, 19);
  ctx.clip();

  const padX = 60;
  const contentRight = logicalWidth - padX;
  const contentWidth = logicalWidth - padX * 2;

  // Header metadata row
  ctx.font = '600 13px "IBM Plex Sans Arabic", "Inter", sans-serif';
  ctx.fillStyle = palette.accent;
  ctx.textAlign = 'right';
  ctx.fillText('الفيلسوف مبعسس  ·  ملخص خطة المشروع', contentRight, 56);

  const pct =
    project.totalStepsCount > 0
      ? Math.round((project.completedStepsCount / project.totalStepsCount) * 100)
      : 0;
  const metaLeft = `${HORIZON_LABELS[project.horizon]}  ·  ${project.completedStepsCount}/${project.totalStepsCount} خطوة  ·  ${project.totalEstimatedMinutes} دقيقة`;
  ctx.font = '500 13px "Inter", "IBM Plex Sans Arabic", sans-serif';
  ctx.fillStyle = palette.muted;
  ctx.textAlign = 'left';
  ctx.fillText(clampWithEllipsis(ctx, metaLeft, contentWidth * 0.48), padX, 56);

  // Project Title (strict RTL word wrap)
  ctx.textAlign = 'right';
  ctx.font = '700 26px "IBM Plex Sans Arabic", "Inter", sans-serif';
  ctx.fillStyle = palette.text;
  const titleLines = wrapArabicText(ctx, project.title, contentWidth, 2);
  let cursorY = 88;
  for (const line of titleLines) {
    ctx.fillText(line, contentRight, cursorY);
    cursorY += 36;
  }

  // Project Objective (strict RTL word wrap)
  if (project.objective) {
    ctx.font = '400 14px "IBM Plex Sans Arabic", "Inter", sans-serif';
    ctx.fillStyle = palette.muted;
    const objLines = wrapArabicText(ctx, project.objective, contentWidth, 2);
    for (const line of objLines) {
      ctx.fillText(line, contentRight, cursorY + 2);
      cursorY += 22;
    }
  }

  // Progress bar
  const barY = Math.max(cursorY + 14, 184);
  const barW = contentWidth - 74;
  drawRoundedRect(ctx, padX + 74, barY + 5, barW, 8, 4);
  ctx.fillStyle = palette.track;
  ctx.fill();

  const fillW = Math.max(pct > 0 ? 12 : 0, Math.round((barW * pct) / 100));
  if (fillW > 0) {
    drawRoundedRect(ctx, padX + 74 + (barW - fillW), barY + 5, fillW, 8, 4);
    ctx.fillStyle = pct === 100 ? palette.success : palette.accent;
    ctx.fill();
  }

  ctx.textAlign = 'left';
  ctx.font = '600 14px "Inter", sans-serif';
  ctx.fillStyle = pct === 100 ? palette.success : palette.accent;
  ctx.fillText(`${pct}%`, padX, barY);

  // Divider
  const gridTop = barY + 34;
  ctx.beginPath();
  ctx.moveTo(padX, gridTop - 12);
  ctx.lineTo(contentRight, gridTop - 12);
  ctx.lineWidth = 1;
  ctx.strokeStyle = palette.border;
  ctx.stroke();

  // Task Columns (up to 3 columns, RTL order, each column strictly clipped)
  const sortedTasks = [...tasks].sort((a, b) => a.orderIndex - b.orderIndex).slice(0, 3);
  const colCount = Math.max(1, sortedTasks.length);
  const gap = 18;
  const colWidth = (contentWidth - gap * (colCount - 1)) / colCount;
  const colHeight = logicalHeight - gridTop - 72;

  sortedTasks.forEach((task, idx) => {
    const colX = contentRight - (idx + 1) * colWidth - idx * gap;
    drawRoundedRect(ctx, colX, gridTop, colWidth, colHeight, 14);
    ctx.fillStyle = palette.surfaceAlt;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = palette.border;
    ctx.stroke();

    // Clip every column internally so text can NEVER overflow the column border
    ctx.save();
    drawRoundedRect(ctx, colX + 2, gridTop + 2, colWidth - 4, colHeight - 4, 12);
    ctx.clip();

    const colPad = 18;
    const innerRight = colX + colWidth - colPad;
    const innerWidth = colWidth - colPad * 2;

    ctx.textAlign = 'right';
    ctx.font = '600 12px "Inter", "IBM Plex Sans Arabic", sans-serif';
    ctx.fillStyle = palette.accent;
    ctx.fillText(`المرحلة ${String(idx + 1).padStart(2, '0')}`, innerRight, gridTop + 16);

    ctx.font = '700 15px "IBM Plex Sans Arabic", "Inter", sans-serif';
    ctx.fillStyle = palette.text;
    const taskLines = wrapArabicText(ctx, task.title, innerWidth, 2);
    let stepY = gridTop + 38;
    for (const tl of taskLines) {
      ctx.fillText(tl, innerRight, stepY);
      stepY += 22;
    }

    stepY += 8;
    ctx.beginPath();
    ctx.moveTo(colX + colPad, stepY);
    ctx.lineTo(colX + colWidth - colPad, stepY);
    ctx.strokeStyle = palette.border;
    ctx.stroke();
    stepY += 14;

    const taskSteps = steps
      .filter((s) => s.taskId === task.id)
      .sort((a, b) => a.orderIndex - b.orderIndex);

    const maxBottomY = gridTop + colHeight - 16;

    for (const st of taskSteps) {
      const isDone = st.status === 'completed';
      ctx.font = '500 13px "IBM Plex Sans Arabic", "Inter", sans-serif';
      const stepTextMaxWidth = innerWidth - 24;
      const lines = wrapArabicText(ctx, st.title, stepTextMaxWidth, 2);
      const blockHeight = lines.length * 19 + 10;

      if (stepY + blockHeight > maxBottomY) break;

      const cx = innerRight - 7;
      const cy = stepY + 9;
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      if (isDone) {
        ctx.fillStyle = palette.success;
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(cx - 3, cy);
        ctx.lineTo(cx - 0.5, cy + 2.5);
        ctx.lineTo(cx + 3.2, cy - 2.2);
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1.6;
        ctx.stroke();
      } else {
        ctx.strokeStyle = palette.muted;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }

      ctx.fillStyle = isDone ? palette.muted : palette.text;
      lines.forEach((ln, lnIdx) => {
        const yPos = stepY + lnIdx * 19;
        ctx.fillText(ln, innerRight - 22, yPos);
        if (isDone) {
          const textW = Math.min(stepTextMaxWidth, ctx.measureText(ln).width);
          ctx.beginPath();
          ctx.moveTo(innerRight - 22, yPos + 9);
          ctx.lineTo(innerRight - 22 - textW, yPos + 9);
          ctx.strokeStyle = palette.muted;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      });

      stepY += blockHeight;
    }

    ctx.restore();
  });

  // Footer
  const footerY = logicalHeight - 54;
  ctx.textAlign = 'right';
  ctx.font = '400 12px "IBM Plex Sans Arabic", "Inter", sans-serif';
  ctx.fillStyle = palette.muted;
  ctx.fillText('توليد محلي عالي الدقة (PNG 3x) — بدون استهلاك API', contentRight, footerY);

  ctx.textAlign = 'left';
  ctx.font = '500 12px "Inter", sans-serif';
  ctx.fillText(new Date().toLocaleDateString('en-CA'), padX, footerY);

  ctx.restore();
  return canvas.toDataURL('image/png');
}

export function downloadPngDataUrl(dataUrl: string, projectTitle: string): void {
  const safeName = projectTitle
    .trim()
    .replace(/[^\u0600-\u06FFa-zA-Z0-9_-]+/g, '-')
    .slice(0, 36);
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = `${safeName || 'project-plan'}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
