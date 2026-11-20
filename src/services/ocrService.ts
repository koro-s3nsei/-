import { createWorker } from 'tesseract.js';

export interface OcrProgressUpdate {
  status: string;
  progress: number; // 0..100
}

/**
 * Extracts readable text locally on the device (Zero-Quota / Offline).
 * - Plain text / markdown / CSV files are read directly.
 * - Image files run through Tesseract.js ('ara+eng').
 * - PDF files attempt local stream text extraction with clean fallback notice.
 */
export async function extractTextLocallyFromFile(
  file: File,
  onProgress?: (update: OcrProgressUpdate) => void
): Promise<string> {
  const nameLower = file.name.toLowerCase();

  if (
    file.type.startsWith('text/') ||
    nameLower.endsWith('.txt') ||
    nameLower.endsWith('.md') ||
    nameLower.endsWith('.csv') ||
    nameLower.endsWith('.json')
  ) {
    onProgress?.({ status: 'قراءة الملف النصي محلياً...', progress: 65 });
    const text = await file.text();
    onProgress?.({ status: 'اكتملت القراءة المحلية', progress: 100 });
    return text.trim();
  }

  if (file.type === 'application/pdf' || nameLower.endsWith('.pdf')) {
    onProgress?.({ status: 'تحليل مستند PDF محلياً...', progress: 40 });
    const buffer = await file.arrayBuffer();
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const raw = decoder.decode(buffer);

    // Extract literal text chunks inside PDF text operators (BT...ET / (...) Tj)
    const extractedPieces: string[] = [];
    const literalRegex = /\(([^()\\]{3,200})\)\s*Tj/g;
    let match: RegExpExecArray | null;
    while ((match = literalRegex.exec(raw)) !== null) {
      const cleaned = match[1].replace(/[^\u0600-\u06FFa-zA-Z0-9\s:.,/-]/g, '').trim();
      if (cleaned.length >= 3) extractedPieces.push(cleaned);
    }

    onProgress?.({ status: 'اكتمل تحليل المستند', progress: 100 });
    if (extractedPieces.length > 0) {
      return extractedPieces.join('\n').trim();
    }
    throw new Error(
      'ملف PDF هذا ممسوح ضوئياً كصورة أو مضغوط. التقط لقطة شاشة للصفحة وارفعها كصورة ليقرأها محرك Tesseract.js محلياً.'
    );
  }

  if (!file.type.startsWith('image/')) {
    throw new Error('نوع الملف غير مدعوم. ارفع صورة (PNG/JPG/WEBP) أو ملف نصي أو PDF.');
  }

  onProgress?.({ status: 'تهيئة محرك OCR المحلي (Tesseract.js)...', progress: 10 });
  const worker = await createWorker('ara+eng', 1, {
    logger: (info) => {
      if (info.status === 'recognizing text') {
        const pct = Math.min(99, Math.max(20, Math.round(info.progress * 100)));
        onProgress?.({ status: 'استخراج النصوص من الصورة محلياً...', progress: pct });
      } else if (info.status === 'loading language traineddata') {
        onProgress?.({ status: 'تحميل بيانات اللغة العربية والإنجليزية...', progress: 25 });
      }
    },
  });

  try {
    const result = await worker.recognize(file);
    onProgress?.({ status: 'اكتمل استخراج النص محلياً', progress: 100 });
    return (result.data.text ?? '').trim();
  } finally {
    await worker.terminate();
  }
}
