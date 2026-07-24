import { useEffect, useRef } from 'react';

import { getAccessToken } from '../api/client';
import { waiterCallsApi } from '../api/waiterCalls';

const POLLING_MS = 15_000;
const TOKEN_WATCH_MS = 1_000;

type AudioContextConstructor = typeof AudioContext;

type MelodyNote = {
  frequency: number;
  offset: number;
  duration: number;
};

const MELODY: MelodyNote[] = [
  { frequency: 659.25, offset: 0, duration: 0.18 },
  { frequency: 783.99, offset: 0.2, duration: 0.18 },
  { frequency: 987.77, offset: 0.4, duration: 0.24 },
  { frequency: 783.99, offset: 0.68, duration: 0.3 },
];

let audioContext: AudioContext | null = null;

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
  if (!context || context.state !== 'suspended') return;

  try {
    await context.resume();
  } catch {
    // Мобільний браузер може дозволити звук лише після наступного натискання.
  }
}

function scheduleTone(context: AudioContext, note: MelodyNote) {
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
  gain.gain.exponentialRampToValueAtTime(0.14, startAt + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);

  harmonicGain.gain.setValueAtTime(0.0001, startAt);
  harmonicGain.gain.exponentialRampToValueAtTime(0.035, startAt + 0.025);
  harmonicGain.gain.exponentialRampToValueAtTime(0.0001, stopAt);

  oscillator.connect(gain);
  gain.connect(context.destination);
  harmonic.connect(harmonicGain);
  harmonicGain.connect(context.destination);

  oscillator.start(startAt);
  harmonic.start(startAt);
  oscillator.stop(stopAt + 0.03);
  harmonic.stop(stopAt + 0.03);
}

async function playCallMelody() {
  const context = getAudioContext();
  if (!context) return;

  if (context.state === 'suspended') {
    try {
      await context.resume();
    } catch {
      return;
    }
  }

  MELODY.forEach((note) => scheduleTone(context, note));
}

export default function WaiterCallAlertController() {
  const knownCallIdsRef = useRef<Set<string>>(new Set());
  const baselineReadyRef = useRef(false);
  const accessTokenRef = useRef('');
  const checkingRef = useRef(false);

  useEffect(() => {
    const handleInteraction = () => {
      void unlockAudio();
    };

    window.addEventListener('pointerdown', handleInteraction, { capture: true });
    window.addEventListener('keydown', handleInteraction, { capture: true });

    async function checkCalls() {
      if (checkingRef.current) return;

      const accessToken = getAccessToken() || '';
      if (!accessToken) {
        accessTokenRef.current = '';
        baselineReadyRef.current = false;
        knownCallIdsRef.current.clear();
        return;
      }

      if (accessTokenRef.current !== accessToken) {
        accessTokenRef.current = accessToken;
        baselineReadyRef.current = false;
        knownCallIdsRef.current.clear();
      }

      checkingRef.current = true;

      try {
        const calls = await waiterCallsApi.list();
        const newCalls = calls.filter(
          (call) => call.status === 'new' && !knownCallIdsRef.current.has(call.id),
        );

        calls.forEach((call) => knownCallIdsRef.current.add(call.id));

        if (baselineReadyRef.current && newCalls.length > 0) {
          await playCallMelody();
        }

        baselineReadyRef.current = true;
      } catch {
        // Основний пульт сам покаже помилку завантаження; контролер звуку мовчить.
      } finally {
        checkingRef.current = false;
      }
    }

    void checkCalls();
    const pollingTimer = window.setInterval(() => void checkCalls(), POLLING_MS);
    const tokenTimer = window.setInterval(() => {
      const currentToken = getAccessToken() || '';
      if (currentToken !== accessTokenRef.current) {
        void checkCalls();
      }
    }, TOKEN_WATCH_MS);

    return () => {
      window.clearInterval(pollingTimer);
      window.clearInterval(tokenTimer);
      window.removeEventListener('pointerdown', handleInteraction, { capture: true });
      window.removeEventListener('keydown', handleInteraction, { capture: true });
    };
  }, []);

  return null;
}
