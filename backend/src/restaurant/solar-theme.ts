// Solar calculations for MOLO, Soniachna Naberezhna 21, Dnipro.
// These coordinates are for sunrise/sunset only: never used by the table map.
const RESTAURANT_LATITUDE = 48.477278;
const RESTAURANT_LONGITUDE = 35.077159;
const KYIV_TIME_ZONE = 'Europe/Kyiv';
const RADIANS = Math.PI / 180;

function normalizeDegrees(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

function kyivDateParts(at: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: KYIV_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);

  const get = (type: 'year' | 'month' | 'day') =>
    Number(parts.find((part) => part.type === type)?.value);

  return { year: get('year'), month: get('month'), day: get('day') };
}

// Standard solar zenith includes atmospheric refraction (90°50').
// The result is an absolute UTC timestamp, independent of the server time zone.
function solarEventUtc(
  year: number,
  month: number,
  day: number,
  sunrise: boolean,
): number {
  const midnight = Date.UTC(year, month - 1, day);
  const dayOfYear =
    (midnight - Date.UTC(year, 0, 0)) / (24 * 60 * 60 * 1000);
  const longitudeHour = RESTAURANT_LONGITUDE / 15;
  const approximate = dayOfYear +
    ((sunrise ? 6 : 18) - longitudeHour) / 24;
  const meanAnomaly = 0.9856 * approximate - 3.289;
  const trueLongitude = normalizeDegrees(
    meanAnomaly +
      1.916 * Math.sin(meanAnomaly * RADIANS) +
      0.02 * Math.sin(2 * meanAnomaly * RADIANS) +
      282.634,
  );
  let rightAscension = normalizeDegrees(
    Math.atan(0.91764 * Math.tan(trueLongitude * RADIANS)) / RADIANS,
  );
  rightAscension +=
    Math.floor(trueLongitude / 90) * 90 -
    Math.floor(rightAscension / 90) * 90;
  rightAscension /= 15;

  const sineDeclination = 0.39782 * Math.sin(trueLongitude * RADIANS);
  const cosineDeclination = Math.cos(Math.asin(sineDeclination));
  const cosineHourAngle =
    (Math.cos(90.833 * RADIANS) -
      sineDeclination * Math.sin(RESTAURANT_LATITUDE * RADIANS)) /
    (cosineDeclination * Math.cos(RESTAURANT_LATITUDE * RADIANS));
  if (cosineHourAngle < -1 || cosineHourAngle > 1) {
    throw new Error('Sunrise/sunset unavailable for the configured coordinates');
  }

  const hourAngle = sunrise
    ? 360 - Math.acos(cosineHourAngle) / RADIANS
    : Math.acos(cosineHourAngle) / RADIANS;
  const localMeanTime =
    hourAngle / 15 + rightAscension - 0.06571 * approximate - 6.622;
  const utcHour = ((localMeanTime - longitudeHour) % 24 + 24) % 24;

  return midnight + utcHour * 60 * 60 * 1000;
}

export function solarSiteMode(at: Date = new Date()): 'day' | 'night' {
  const { year, month, day } = kyivDateParts(at);
  const sunrise = solarEventUtc(year, month, day, true);
  const sunset = solarEventUtc(year, month, day, false);
  return at.getTime() >= sunrise && at.getTime() < sunset ? 'day' : 'night';
}

export function resolveSiteMode(
  storedMode: 'day' | 'night' | 'holiday',
  autoThemeEnabled: boolean,
  at: Date = new Date(),
): 'day' | 'night' | 'holiday' {
  return autoThemeEnabled ? solarSiteMode(at) : storedMode;
}
