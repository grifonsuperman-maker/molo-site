import { useLayoutEffect, useRef } from 'react';
import type { InputHTMLAttributes } from 'react';

import { editGuestPhoneInput } from '../services/contactValidation';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: string;
  onChange: (value: string) => void;
};

export default function GuestPhoneInput({ value, onChange, onFocus, onBlur, onKeyDown, ...props }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const nextCaret = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (nextCaret.current !== null && input.current === document.activeElement) {
      input.current.setSelectionRange(nextCaret.current, nextCaret.current);
    }
    nextCaret.current = null;
  });

  function update(raw: string, caret: number, inputType = '') {
    const edited = editGuestPhoneInput(raw, value, caret, inputType);
    nextCaret.current = edited.caret;
    onChange(edited.value);
  }

  return (
    <input
      {...props}
      ref={input}
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      placeholder="+380 (XX) XXX-XX-XX"
      value={value}
      onFocus={(event) => {
        if (!value) {
          nextCaret.current = 4;
          onChange('+380');
        }
        onFocus?.(event);
      }}
      onChange={(event) => update(event.target.value, event.target.selectionStart ?? event.target.value.length, (event.nativeEvent as InputEvent).inputType)}
      onBlur={(event) => {
        if (value === '+380') onChange('');
        onBlur?.(event);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.key !== 'Backspace' && event.key !== 'Delete') return;
        const field = event.currentTarget;
        const start = field.selectionStart ?? 0;
        if (start !== field.selectionEnd || !value.startsWith('+380')) return;
        const direction = event.key === 'Backspace' ? -1 : 1;
        let index = direction === -1 ? start - 1 : start;
        // Skip mask separators when deleting, keeping the country prefix intact.
        while (index >= 4 && index < value.length && !/\d/.test(value[index])) index += direction;
        event.preventDefault();
        if (index >= 4 && index < value.length) {
          update(value.slice(0, index) + value.slice(index + 1), direction === -1 ? index : start);
        }
      }}
    />
  );
}
