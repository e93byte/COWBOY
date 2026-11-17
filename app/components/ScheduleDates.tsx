import { TabIcon } from './SportIcon';

export function scheduleDateLabel(day: string, today: string, tomorrow: string) {
  if (day === 'all') return 'All dates';
  if (day === today) return 'Today';
  if (day === tomorrow) return 'Tomorrow';
  return new Date(`${day}T12:00:00Z`).toLocaleDateString([], {timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric'});
}

export function ScheduleDates({value, counts, today, tomorrow, onChange}: {
  value: string;
  counts: ReadonlyMap<string, number>;
  today: string;
  tomorrow: string;
  onChange: (date: string) => void;
}) {
  const days = [...counts.keys()].sort();
  const quick = ['all', today, tomorrow, ...days.filter(day => day > tomorrow).slice(0, 3)];
  const options = value !== 'all' && !counts.has(value) ? [...days, value].sort() : days;
  const previous = value === 'all' ? undefined : days.filter(day => day < value).at(-1);
  const next = value === 'all' ? undefined : days.find(day => day > value);

  return <div className="cw-schedule-dates">
    <div className="cw-date-tabs" role="group" aria-label="Game date">
      {quick.map(day => (
        <button key={day} aria-pressed={value === day} onClick={() => onChange(day)}>
          <TabIcon tab="calendar"/>{scheduleDateLabel(day, today, tomorrow)}
        </button>
      ))}
    </div>
    <div className="cw-date-picker">
      <button aria-label="Previous available date" disabled={!previous} onClick={() => previous && onChange(previous)}>‹</button>
      <label><span className="sr-only">Choose a date from the schedule</span>
        <select value={value} onChange={event => onChange(event.target.value)}>
          <option value="all">All schedule dates</option>
          {options.map(day => {
            const count = counts.get(day) ?? 0;
            return <option key={day} value={day}>
              {scheduleDateLabel(day, today, tomorrow)} · {count} {count === 1 ? 'game' : 'games'}
            </option>;
          })}
        </select>
      </label>
      <button aria-label="Next available date" disabled={!next} onClick={() => next && onChange(next)}>›</button>
    </div>
  </div>;
}
