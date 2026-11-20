import { useCallback, useEffect, useRef, useState } from 'react';

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
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const callbackRef = useRef(onFinalTranscript);

  useEffect(() => {
    callbackRef.current = onFinalTranscript;
  }, [onFinalTranscript]);

  useEffect(() => {
    const win = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    setIsSupported(Boolean(win.SpeechRecognition || win.webkitSpeechRecognition));
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  const startListening = useCallback(() => {
    setError(null);
    const win = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    const Ctor = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!Ctor) {
      setError('المتصفح لا يدعم Web Speech API. استخدم Chrome أو تطبيق الأندرويد.');
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

      recognitionRef.current = recognition;
      recognition.start();
      setIsListening(true);
    } catch {
      setError('تعذر بدء التسجيل الصوتي المحلي.');
      setIsListening(false);
    }
  }, []);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
    setInterimText('');
  }, []);

  return {
    isSupported,
    isListening,
    interimText,
    error,
    startListening,
    stopListening,
  };
}
