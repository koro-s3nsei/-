import { useCallback, useEffect, useRef, useState } from 'react';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import {
  isNativeCapacitorPlatform,
  requestMicrophonePermission,
} from '../native/capacitorBridge';

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      0: { transcript: string };
    };
  };
}

interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

export function useSpeechRecognition(onFinalTranscript: (chunk: string) => void) {
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(false);

  const webRecognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const nativeLatestTranscriptRef = useRef<string>('');
  const callbackRef = useRef(onFinalTranscript);

  useEffect(() => {
    callbackRef.current = onFinalTranscript;
  }, [onFinalTranscript]);

  useEffect(() => {
    let mounted = true;

    const checkSupport = async () => {
      if (isNativeCapacitorPlatform()) {
        try {
          const { available } = await SpeechRecognition.available();
          if (mounted) setIsSupported(available);
        } catch {
          if (mounted) setIsSupported(true);
        }
        return;
      }

      const win = window as unknown as {
        SpeechRecognition?: SpeechRecognitionCtor;
        webkitSpeechRecognition?: SpeechRecognitionCtor;
      };
      if (mounted) {
        setIsSupported(Boolean(win.SpeechRecognition || win.webkitSpeechRecognition));
      }
    };

    void checkSupport();

    return () => {
      mounted = false;
      webRecognitionRef.current?.stop();
      if (isNativeCapacitorPlatform()) {
        void SpeechRecognition.removeAllListeners().catch(() => {});
        void SpeechRecognition.stop().catch(() => {});
      }
    };
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const commitNativeTranscriptIfAny = useCallback(() => {
    const latest = nativeLatestTranscriptRef.current.trim();
    if (latest) {
      nativeLatestTranscriptRef.current = '';
      callbackRef.current(latest);
    }
    setInterimText('');
  }, []);

  const startListening = useCallback(async () => {
    setError(null);

    // 1. Native Android / Capacitor Speech Recognition (triggers official Android "Allow / سماح" dialog)
    if (isNativeCapacitorPlatform()) {
      const perm = await requestMicrophonePermission();
      if (!perm.granted) {
        setError(perm.message || 'لم يتم منح إذن الميكروفون.');
        return;
      }

      try {
        nativeLatestTranscriptRef.current = '';
        await SpeechRecognition.removeAllListeners();

        await SpeechRecognition.addListener('partialResults', (data: { matches?: string[] }) => {
          const text = data?.matches?.[0]?.trim() ?? '';
          if (text) {
            nativeLatestTranscriptRef.current = text;
            setInterimText(text);
          }
        });

        await SpeechRecognition.addListener(
          'listeningState',
          (state: { status: 'started' | 'stopped' }) => {
            if (state.status === 'stopped') {
              setIsListening(false);
              commitNativeTranscriptIfAny();
            }
          }
        );

        setIsListening(true);
        const result = await SpeechRecognition.start({
          language: 'ar-SA',
          maxResults: 3,
          prompt: 'تحدث الآن باللغة العربية...',
          partialResults: true,
          popup: false,
        });

        if (result?.matches && result.matches.length > 0 && result.matches[0].trim()) {
          nativeLatestTranscriptRef.current = '';
          callbackRef.current(result.matches[0].trim());
          setInterimText('');
          setIsListening(false);
        }
      } catch (err) {
        setIsListening(false);
        setInterimText('');
        setError(
          err instanceof Error
            ? `تعذر بدء الإملاء الصوتي الأصلي: ${err.message}`
            : 'تعذر بدء الإملاء الصوتي على هذا الجهاز.'
        );
      }
      return;
    }

    // 2. Web / PWA Speech Recognition
    const win = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    const Ctor = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!Ctor) {
      setError('المتصفح لا يدعم الإملاء الصوتي. استخدم Chrome أو نسخة الأندرويد APK.');
      return;
    }

    const perm = await requestMicrophonePermission();
    if (!perm.granted) {
      setError(perm.message);
      return;
    }

    try {
      const recognition = new Ctor();
      recognition.lang = 'ar-SA';
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onresult = (event) => {
        let finalStr = '';
        let interimStr = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0]?.transcript ?? '';
          if (event.results[i].isFinal) {
            finalStr += `${transcript} `;
          } else {
            interimStr += transcript;
          }
        }
        setInterimText(interimStr);
        if (finalStr.trim()) {
          callbackRef.current(finalStr.trim());
        }
      };

      recognition.onerror = (ev) => {
        if (ev.error === 'not-allowed') {
          setError('تم رفض صلاحية الميكروفون. فعّل الوصول للميكروفون من إعدادات المتصفح.');
        } else if (ev.error !== 'aborted') {
          setError(`تعذر التسجيل الصوتي (${ev.error}).`);
        }
        setIsListening(false);
        setInterimText('');
      };

      recognition.onend = () => {
        setIsListening(false);
        setInterimText('');
      };

      webRecognitionRef.current = recognition;
      recognition.start();
      setIsListening(true);
    } catch {
      setError('تعذر بدء التسجيل الصوتي المحلي.');
      setIsListening(false);
    }
  }, [commitNativeTranscriptIfAny]);

  const stopListening = useCallback(async () => {
    if (isNativeCapacitorPlatform()) {
      try {
        await SpeechRecognition.stop();
      } catch {
        // Ignore stop errors if already stopped
      }
      commitNativeTranscriptIfAny();
      setIsListening(false);
      return;
    }

    webRecognitionRef.current?.stop();
    setIsListening(false);
    setInterimText('');
  }, [commitNativeTranscriptIfAny]);

  return {
    isSupported,
    isListening,
    interimText,
    error,
    clearError,
    startListening,
    stopListening,
  };
}
