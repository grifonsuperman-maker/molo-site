import { useEffect, useState } from 'react';

type InitialValue<T> = T | (() => T);

function resolveInitialValue<T>(value: InitialValue<T>): T {
  return typeof value === 'function'
    ? (value as () => T)()
    : value;
}

export function usePersistentState<T>(
  storageKey: string,
  initialValue: InitialValue<T>,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    const fallbackValue = resolveInitialValue(initialValue);

    if (typeof window === 'undefined') {
      return fallbackValue;
    }

    try {
      const savedValue = window.sessionStorage.getItem(storageKey);

      if (savedValue === null) {
        return fallbackValue;
      }

      return JSON.parse(savedValue) as T;
    } catch {
      return fallbackValue;
    }
  });

  useEffect(() => {
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // Якщо браузер заборонив storage, сайт продовжує працювати без збереження екрана.
    }
  }, [storageKey, value]);

  return [value, setValue];
}
