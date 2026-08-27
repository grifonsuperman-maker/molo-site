function hourWord(hours: number): string {
  if (hours === 1) return 'година';
  if (hours >= 2 && hours <= 4) return 'години';
  return 'годин';
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} хв`;

  const hours = minutes / 60;

  if (Number.isInteger(hours)) {
    return `${hours} ${hourWord(hours)}`;
  }

  return `${String(hours).replace('.', ',')} години`;
}
