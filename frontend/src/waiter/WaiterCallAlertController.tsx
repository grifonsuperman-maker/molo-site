import { useEffect, useRef } from 'react';

import { getAccessToken } from '../api/client';
import { waiterCallsApi } from '../api/waiterCalls';

const POLLING_MS = 15_000;
const TOKEN_WATCH_MS = 1_000;
const PLAYED_CALLS_KEY = 'molo_waiter_played_call_sounds_v1';

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

function readPlayedCallIds() {
  try {
    const value = JSON.parse(sessionStorage.getItem(PLAYED_CALLS_KEY) || '[]');
    return new Set<string>(Array.isArray(value) ? value.map(String) : []);
  } catch {
    return new Set<string>();
  }
}

function savePlayedCallIds(ids: Set<string>) {
  try {
    sessionStorage.setItem(PLAYED_CALLS_KEY, JSON.stringify([...ids].slice(-200)));
  } catch {
    // У приватному режимі sessionStorage може бути недоступним.
  }
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
  gain.gain.exponentialRampToValueAtTime(0.22, startAt + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);

  harmonicGain.gain.setValueAtTime(0.0001, startAt);
  harmonicGain.gain.exponentialRampToValueAtTime(0.055, startAt + 0.025);
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
  if (!context) return false;

  if (context.state === 'suspended') {
    try {
      await context.resume();
    } catch {
      return false;
    }
  }

  if (context.state !== 'running') return false;

  MELODY.forEach((note) => scheduleTone(context, note));
  return true;
}

export default function WaiterCallAlertController() {
  const playedCallIdsRef = useRef<Set<string>>(readPlayedCallIds());
  const accessTokenRef = useRef('');
  const checkingRef = useRef(false);

  useEffect(() => {
    async function checkCalls() {
      if (checkingRef.current) return;

      const accessToken = getAccessToken() || '';
      if (!accessToken) {
        accessTokenRef.current = '';
        return;
      }

      accessTokenRef.current = accessToken;
      checkingRef.current = true;

      try {
        const calls = await waiterCallsApi.list();
        const callsWithoutSound = calls.filter(
          (call) => call.status === 'new' && !playedCallIdsRef.current.has(call.id),
        );

        if (callsWithoutSound.length > 0) {
          const played = await playCallMelody();
          if (played) {
            callsWithoutSound.forEach((call) => playedCallIdsRef.current.add(call.id));
            savePlayedCallIds(playedCallIdsRef.current);
          }
        }
      } catch {
        // Основний пульт сам покаже помилку завантаження; контролер звуку мовчить.
      } finally {
        checkingRef.current = false;
      }
    }

    const handleInteraction = () => {
      void unlockAudio().then(() => checkCalls());
    };

    window.addEventListener('pointerdown', handleInteraction, { capture: true });
    window.addEventListener('keydown', handleInteraction, { capture: true });

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
