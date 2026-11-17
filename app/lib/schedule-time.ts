export const scheduleZones = [
  {id: 'local', label: 'Device timezone'},
  {id: 'America/New_York', label: 'Eastern'},
  {id: 'America/Chicago', label: 'Central'},
  {id: 'America/Denver', label: 'Mountain'},
  {id: 'America/Los_Angeles', label: 'Pacific'},
  {id: 'UTC', label: 'UTC'},
  {id: 'Europe/London', label: 'London'},
  {id: 'Europe/Paris', label: 'Central Europe'},
  {id: 'Australia/Sydney', label: 'Sydney'},
] as const;

export type ScheduleZone = (typeof scheduleZones)[number]['id'];

const dayFormats = new Map<string, Intl.DateTimeFormat>();
const timeFormats = new Map<string, Intl.DateTimeFormat>();

function zoneName(zone: string) {
  return zone === 'local' ? undefined : zone;
}

export function scheduleDay(value: string | number, zone: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  let formatter = dayFormats.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('sv-SE', {
      calendar: 'gregory', numberingSystem: 'latn', timeZone: zoneName(zone),
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
    dayFormats.set(zone, formatter);
  }
  const parts = formatter.formatToParts(date);
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find(field => field.type === name)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function parseScheduleDate(params: URLSearchParams) {
  const values = params.getAll('date');
  if (values.length !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(values[0])) return 'all';
  const date = new Date(values[0] + 'T12:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === values[0] ? values[0] : 'all';
}

export function parseSharedScheduleZone(params: URLSearchParams) {
  const values = params.getAll('tz');
  if (values.length !== 1 || !/^[A-Za-z0-9_+/-]{1,64}$/.test(values[0])) return null;
  try {
    return new Intl.DateTimeFormat('en', {timeZone: values[0]}).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

export function resolvedScheduleZone(zone: string) {
  return zone === 'local' ? new Intl.DateTimeFormat().resolvedOptions().timeZone : zone;
}

export function nextScheduleDay(day: string) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function scheduleTime(value: string, zone: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Time unavailable';
  let formatter = timeFormats.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(undefined, {
      timeZone: zoneName(zone), month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    });
    timeFormats.set(zone, formatter);
  }
  return formatter.format(date);
}
