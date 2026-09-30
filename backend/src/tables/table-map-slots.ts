// Physical slots verified against both existing visual maps. Numbers here are
// frozen slot labels, never the current restaurant table number.
export const TABLE_MAP_SLOTS = [
  { key: 'hall:1', location: 'hall', number: '1' },
  { key: 'hall:2', location: 'hall', number: '2' },
  { key: 'hall:3', location: 'hall', number: '3' },
  { key: 'hall:4', location: 'hall', number: '4' },
  { key: 'hall:5', location: 'hall', number: '5' },
  { key: 'hall:6', location: 'hall', number: '6' },
  { key: 'hall:7', location: 'hall', number: '7' },
  { key: 'hall:8', location: 'hall', number: '8' },
  { key: 'hall:9', location: 'hall', number: '9' },
  { key: 'hall:10', location: 'hall', number: '10' },
  { key: 'hall:11', location: 'hall', number: '11' },
  { key: 'hall:12', location: 'hall', number: '12' },
  { key: 'hall:13', location: 'hall', number: '13' },
  { key: 'hall:14', location: 'hall', number: '14' },
  { key: 'canopy:15', location: 'canopy', number: '15' },
  { key: 'canopy:16', location: 'canopy', number: '16' },
  { key: 'canopy:17', location: 'canopy', number: '17' },
  { key: 'canopy:18', location: 'canopy', number: '18' },
  { key: 'canopy:19', location: 'canopy', number: '19' },
  { key: 'canopy:20', location: 'canopy', number: '20' },
  { key: 'gazebo:21', location: 'gazebo', number: '21' },
  { key: 'gazebo:22', location: 'gazebo', number: '22' },
  { key: 'gazebo:23', location: 'gazebo', number: '23' },
  { key: 'gazebo:24', location: 'gazebo', number: '24' },
  { key: 'gazebo:25', location: 'gazebo', number: '25' },
  { key: 'gazebo:26', location: 'gazebo', number: '26' },
  { key: 'gazebo:27', location: 'gazebo', number: '27' },
  { key: 'gazebo:28', location: 'gazebo', number: '28' },
  { key: 'gazebo:29', location: 'gazebo', number: '29' },
  { key: 'gazebo:30', location: 'gazebo', number: '30' },
  { key: 'gazebo:31', location: 'gazebo', number: '31' },
  { key: 'gazebo:32', location: 'gazebo', number: '32' },
  { key: 'gazebo:33', location: 'gazebo', number: '33' },
  { key: 'gazebo:34', location: 'gazebo', number: '34' },
  { key: 'gazebo:35', location: 'gazebo', number: '35' },
  { key: 'gazebo:36', location: 'gazebo', number: '36' },
  { key: 'rotang:37', location: 'rotang', number: '37' },
  { key: 'rotang:38', location: 'rotang', number: '38' },
  { key: 'rotang:39', location: 'rotang', number: '39' },
  { key: 'embankment:40', location: 'embankment', number: '40' },
  { key: 'embankment:41', location: 'embankment', number: '41' },
  { key: 'embankment:42', location: 'embankment', number: '42' },
  { key: 'embankment:43', location: 'embankment', number: '43' },
  { key: 'embankment:44', location: 'embankment', number: '44' },
  { key: 'glass_gazebo:45', location: 'glass_gazebo', number: '45' },
  { key: 'glass_gazebo:46', location: 'glass_gazebo', number: '46' },
  { key: 'glass_gazebo:47', location: 'glass_gazebo', number: '47' },
  { key: 'glass_gazebo:48', location: 'glass_gazebo', number: '48' },
  { key: 'glass_gazebo:49', location: 'glass_gazebo', number: '49' },
  { key: 'glass_gazebo:50', location: 'glass_gazebo', number: '50' },
  { key: 'water_gazebo:100', location: 'water_gazebo', number: '100' },
  { key: 'water_gazebo:101', location: 'water_gazebo', number: '101' },
  { key: 'water_gazebo:102', location: 'water_gazebo', number: '102' },
  { key: 'water_gazebo:103', location: 'water_gazebo', number: '103' },
  { key: 'water_gazebo:104', location: 'water_gazebo', number: '104' },
  { key: 'water_gazebo:105', location: 'water_gazebo', number: '105' },
  { key: 'water_gazebo:106', location: 'water_gazebo', number: '106' },
  { key: 'water_gazebo:107', location: 'water_gazebo', number: '107' },
  { key: 'water_gazebo:108', location: 'water_gazebo', number: '108' },
  { key: 'water_gazebo:109', location: 'water_gazebo', number: '109' },
] as const;

const slotsByKey = new Map<string, (typeof TABLE_MAP_SLOTS)[number]>(
  TABLE_MAP_SLOTS.map((slot) => [slot.key, slot]),
);

export function canonicalTableNumber(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  if (!/^[0-9]{1,12}$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) && number > 0 ? String(number) : null;
}

export function legacyMapSlot(value: unknown) {
  const number = canonicalTableNumber(value);
  return TABLE_MAP_SLOTS.find((slot) => slot.number === number) || null;
}

export function physicalMapSlot(key: string | null | undefined) {
  return typeof key === 'string' ? slotsByKey.get(key) || null : null;
}
