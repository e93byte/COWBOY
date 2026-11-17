export type FollowPreference = {
  kind: 'game' | 'team' | 'league';
  id: string;
  league: string;
  name: string;
};

export function followKey(item: FollowPreference) {
  return `${item.kind}:${item.id}`;
}

export function isFollowPreference(value: unknown): value is FollowPreference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<FollowPreference>;
  if (typeof item.league !== 'string' || !/^[a-z0-9-]{1,24}$/.test(item.league) ||
      typeof item.id !== 'string' || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 160 ||
      /[\u0000-\u001f\u007f]/.test(item.name)) return false;
  if (item.kind === 'league') return item.id === item.league;
  if (!item.id.startsWith(item.league + ':')) return false;
  const id = item.id.slice(item.league.length + 1);
  if (item.kind === 'game') return /^[0-9]{1,16}(?:-[0-9]{1,16})?$/.test(id);
  return item.kind === 'team' && /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(id);
}
