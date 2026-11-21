type HomeInterests = {sports: string[]; recent: string[]};
const key = 'cowboy.homeInterests.v1';
export const emptyHomeInterests: HomeInterests = {sports:[],recent:[]};

export function readHomeInterests(): HomeInterests {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null');
    const strings = (values: unknown, pattern: RegExp, limit: number) => Array.isArray(values)
      ? [...new Set(values.filter((value): value is string=>typeof value === 'string' && pattern.test(value)))].slice(0,limit)
      : [];
    return {
      sports: strings(saved?.sports,/^[a-z_]{1,24}$/,16),
      recent: strings(saved?.recent,/^[a-z0-9-]{1,24}:[a-z0-9-]{1,35}$/,20),
    };
  } catch {
    return emptyHomeInterests;
  }
}

export function saveHomeInterests(value: HomeInterests) {
  try { localStorage.setItem(key,JSON.stringify(value)); } catch {}
}
