'use client';

import {createContext} from 'react';
import {allScheduleZones, type ScheduleZone} from '../lib/schedule-time';

export const ScheduleTimeZone = createContext<string>('local');

export function ScheduleZoneSelect({value,onChange}: {
  value: string;
  onChange: (zone: ScheduleZone) => void;
}) {
  const zones = allScheduleZones();
  return <label className="cw-schedule-zone">
    <span className="sr-only">Schedule timezone</span>
    <select value={value} onChange={event => {
      const zone = zones.find(option => option.id === event.target.value);
      if (zone) onChange(zone.id);
    }}>
      {!zones.some(zone => zone.id === value) && <option value={value}>{value.replaceAll('_', ' ')}</option>}
      {zones.map(zone => <option key={zone.id} value={zone.id}>{zone.label}</option>)}
    </select>
  </label>;
}
