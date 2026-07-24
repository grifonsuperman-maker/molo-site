import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';

import { getAccessToken } from '../api/client';
import { waiterCallsApi } from '../api/waiterCalls';

const POLLING_MS = 15_000;
const TOKEN_WATCH_MS = 1_000;
const SOUND_REPEAT_MS = 5_000;
const SOUND_ENABLED_KEY = 'molo_waiter_sound_enabled_v1';

type AudioContextConstructor = typeof AudioContext;

type MelodyNote = {
  frequency: number;
  offset: number;
  duration: number;
};

type ActiveMelody = {
  output: GainNode;
  oscillators: OscillatorNode[];
};

const MELODY: MelodyNote[] = [
  { frequency: 659.25, offset: 0, duration: 0.18 },
  { frequency: 783.99, offset: 0.2, duration: 0.18 },
  { frequency: 987.77, offset: 0.4, duration: 0.24 },
  { frequency: 783.99, offset: 0.68, duration: 0.3 },
];

let audioContext: AudioContext | null = null;
const activeMelodies = new Set<ActiveMelody>();

function readSoundEnabled() {
  try {
    return localStorage.getItem(SOUND_ENABLED_KEY) !== 'false';
  } catch {
    return true;
  }
}

function getAudioContext() {
  if (audioContext) return audioContext;

  const AudioContextClass = window.AudioContext
    || (window as typeof window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;

  if (!AudioContextClass) return null;

  audioContext = new AudioContextClass();
  return audioContext;
}

async function unlockAudio() {
  const context = getAudioContext();
  if (!context) return false;

  if (context.state === 'suspended') {
    try {
      await context.resume();
    } catch {
      return false;
    }
  }

  if (context.state !== 'running') return false;

  // Короткий беззвучний імпульс у межах натискання надійніше розблоковує звук на Android.
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.00001, context.currentTime);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(context.currentTime);
  oscillator.stop(context.currentTime + 0.02);

  return true;
}

function stopActiveMelodies() {
  const context = audioContext;

  activeMelodies.forEach((melody) => {
    try {
      if (context) {
        melody.output.gain.cancelScheduledValues(context.currentTime);
        melody.output.gain.setValueAtTime(0, context.currentTime);
      }
      melody.oscillators.forEach((oscillator) => {
        try { oscillator.stop(); } catch {}
      });
      melody.output.disconnect();
    } catch {}
  });

  activeMelodies.clear();
}

function scheduleTone(
  context: AudioContext,
  compressor: DynamicsCompressorNode,
  note: MelodyNote,
  oscillators: OscillatorNode[],
) {
  const startAt = context.currentTime + 0.04 + note.offset;
  const stopAt = startAt + note.duration;

  const oscillator = context.createOscillator();
  const harmonic = context.createOscillator();
  const gain = context.createGain();
  const harmonicGain = context.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(note.frequency, startAt);

  harmonic.type = 'triangle';
  harmonic.frequency.setValueAtTime(note.frequency * 2, startAt);

  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.82, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);

  harmonicGain.gain.setValueAtTime(0.0001, startAt);
  harmonicGain.gain.exponentialRampToValueAtTime(0.24, startAt + 0.02);
  harmonicGain.gain.exponentialRampToValueAtTime(0.0001, stopAt);

  oscillator.connect(gain);
  gain.connect(compressor);
  harmonic.connect(harmonicGain);
  harmonicGain.connect(compressor);

  oscillator.start(startAt);
  harmonic.start(startAt);
  oscillator.stop(stopAt + 0.03);
  harmonic.stop(stopAt + 0.03);
  oscillators.push(oscillator, harmonic);
}

async function playCallMelody() {
  const context = getAudioContext();
  if (!context) return false;

  if (context.state === 'suspended') {
    try {
      await context.resume();
    } catch {
      return false;
    }
  }

  if (context.state !== 'running') return false;

  const output = context.createGain();
  const compressor = context.createDynamicsCompressor();
  const oscillators: OscillatorNode[] = [];
  const activeMelody = { output, oscillators };

  // Максимальний рівень усередині застосунку без перевантаження та хрипу.
  output.gain.setValueAtTime(1, context.currentTime);
  compressor.threshold.setValueAtTime(-12, context.currentTime);
  compressor.knee.setValueAtTime(12, context.currentTime);
  compressor.ratio.setValueAtTime(8, context.currentTime);
  compressor.attack.setValueAtTime(0.003, context.currentTime);
  compressor.release.setValueAtTime(0.22, context.currentTime);
  compressor.connect(output);
  output.connect(context.destination);

  activeMelodies.add(activeMelody);
  MELODY.forEach((note) => scheduleTone(context, compressor, note, oscillators));

  window.setTimeout(() => {
    try { output.disconnect(); } catch {}
    activeMelodies.delete(activeMelody);
  }, 1_300);

  return true;
}

export default function WaiterCallAlertController() {
  const [soundEnabled, setSoundEnabled] = useState(readSoundEnabled);
  const [hasAccess, setHasAccess] = useState(() => Boolean(getAccessToken()));
  const [ringing, setRinging] = useState(false);
  const soundEnabledRef = useRef(soundEnabled);
  const audioReadyRef = useRef(false);
  const hasNewCallsRef = useRef(false);
  const accessTokenRef = useRef('');
  const checkingRef = useRef(false);
  const repeatTimerRef = useRef<number | null>(null);
  const checkCallsRef = useRef<() => Promise<void>>(async () => {});

  function clearRepeatTimer() {
    if (repeatTimerRef.current !== null) {
      window.clearInterval(repeatTimerRef.current);
      repeatTimerRef.current = null;
    }
  }

  async function playIfNeeded() {
    if (!soundEnabledRef.current || !hasNewCallsRef.current) return;
    const ready = audioReadyRef.current || await unlockAudio();
    audioReadyRef.current = ready;
    if (ready) await playCallMelody();
  }

  function startRepeatTimer() {
    if (!soundEnabledRef.current || !hasNewCallsRef.current || repeatTimerRef.current !== null) return;
    void playIfNeeded();
    repeatTimerRef.current = window.setInterval(() => void playIfNeeded(), SOUND_REPEAT_MS);
  }

  function applyCallState(hasNewCalls: boolean) {
    hasNewCallsRef.current = hasNewCalls;
    setRinging(hasNewCalls);

    if (!hasNewCalls || !soundEnabledRef.current) {
      clearRepeatTimer();
      stopActiveMelodies();
      return;
    }

    startRepeatTimer();
  }

  function toggleSound() {
    const next = !soundEnabledRef.current;
    soundEnabledRef.current = next;
    setSoundEnabled(next);

    try {
      localStorage.setItem(SOUND_ENABLED_KEY, String(next));
    } catch {}

    if (!next) {
      clearRepeatTimer();
      stopActiveMelodies();
      return;
    }

    void unlockAudio().then((ready) => {
      audioReadyRef.current = ready;
      if (hasNewCallsRef.current) startRepeatTimer();
    });
  }

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  useEffect(() => {
    async function checkCalls() {
      if (checkingRef.current) return;

      const accessToken = getAccessToken() || '';
      accessTokenRef.current = accessToken;
      setHasAccess(Boolean(accessToken));

      if (!accessToken) {
        applyCallState(false);
        return;
      }

      checkingRef.current = true;

      try {
        const calls = await waiterCallsApi.list();
        applyCallState(calls.some((call) => call.status === 'new'));
      } catch {
        // Основний пульт сам покаже помилку завантаження; поточний звуковий стан не змінюємо.
      } finally {
        checkingRef.current = false;
      }
    }

    checkCallsRef.current = checkCalls;

    const handleInteraction = (event: Event) => {
      if (!audioReadyRef.current) {
        void unlockAudio().then((ready) => {
          audioReadyRef.current = ready;
          if (ready && soundEnabledRef.current && hasNewCallsRef.current) {
            clearRepeatTimer();
            startRepeatTimer();
          }
        });
      }

      const target = event.target;
      const button = target instanceof Element ? target.closest('button') : null;
      if (button?.textContent?.includes('Прийняв')) {
        // Після прийняття одразу звіряємо стан, не чекаючи наступного 15-секундного циклу.
        window.setTimeout(() => void checkCalls(), 350);
        window.setTimeout(() => void checkCalls(), 1_200);
      }
    };

    window.addEventListener('pointerdown', handleInteraction, { capture: true });
    window.addEventListener('keydown', handleInteraction, { capture: true });

    void checkCalls();
    const pollingTimer = window.setInterval(() => void checkCalls(), POLLING_MS);
    const tokenTimer = window.setInterval(() => {
      const currentToken = getAccessToken() || '';
      if (currentToken !== accessTokenRef.current) void checkCalls();
    }, TOKEN_WATCH_MS);

    return () => {
      window.clearInterval(pollingTimer);
      window.clearInterval(tokenTimer);
      clearRepeatTimer();
      stopActiveMelodies();
      window.removeEventListener('pointerdown', handleInteraction, { capture: true });
      window.removeEventListener('keydown', handleInteraction, { capture: true });
    };
  }, []);

  if (!hasAccess) return null;

  return (
    <button
      type="button"
      onClick={toggleSound}
      aria-label={soundEnabled ? 'Вимкнути звук викликів' : 'Увімкнути звук викликів'}
      title={soundEnabled ? 'Вимкнути звук викликів' : 'Увімкнути звук викликів'}
      className={`fixed top-5 z-[70] inline-flex h-12 items-center justify-center gap-2 rounded-2xl border bg-black/80 px-3 font-black backdrop-blur-xl transition active:scale-95 ${
        soundEnabled
          ? ringing
            ? 'animate-pulse border-orange-300/80 text-orange-100 shadow-[0_0_34px_rgba(251,146,60,.42)]'
            : 'border-emerald-300/55 text-emerald-100 shadow-[0_0_22px_rgba(52,211,153,.18)]'
          : 'border-red-300/55 text-red-100 shadow-[0_0_18px_rgba(248,113,113,.14)]'
      }`}
      style={{ right: 'max(76px, calc((100vw - 896px) / 2 + 76px))' }}
    >
      {soundEnabled ? <Volume2 size={19} /> : <VolumeX size={19} />}
      <span className="hidden sm:inline">{soundEnabled ? 'Звук' : 'Вимкнено'}</span>
    </button>
  );
}
