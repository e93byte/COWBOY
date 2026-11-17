import { AccountError, AccountStore, type StoreData } from '../../../lib/account-store';
import { followKey, isFollowPreference, type FollowPreference } from '../../../lib/follow-preferences';
import { LIVE_LEAGUES } from '../../../lib/live-sports';
import { assertSameOrigin, MutationLimiter, readJson, response, safely, sessionToken } from '../handlers';

export function createFollowHandlers({store = new AccountStore(), limiter = new MutationLimiter({limit:40,windowMs:60000})} = {}) {
  const ownUser = (data: StoreData, token: string|null) => {
    const {id} = store.requireUser(data,token);
    return data.users.find(user=>user.id===id)!;
  };
  return {
    GET: (request: Request) => safely(async () => response({follows: await store.transaction(data =>
      ownUser(data,sessionToken(request)).follows ?? [],false)})),
    PATCH: (request: Request) => safely(async () => {
      assertSameOrigin(request);
      const token = sessionToken(request);
      const owner = await store.transaction(data=>store.requireUser(data,token).id,false);
      limiter.check('follows-global',160);
      limiter.check('follows-owner:'+owner);
      const {entries, following} = await readJson(request,['entries','following']);
      if (typeof following !== 'boolean' || !Array.isArray(entries) || !entries.length || entries.length > 8 ||
          entries.some(entry => !isFollowPreference(entry) ||
            !LIVE_LEAGUES.some(league=>league.id===entry.league && (league.sport!=='golf' || entry.kind==='league')))) {
        throw new AccountError('invalid_input','Choose valid games, teams or leagues to update.');
      }
      const changes: FollowPreference[] = entries.map(({kind,id,league,name})=>({kind,id,league,name:name.trim()}));
      const follows = await store.transaction(data => {
        const user = ownUser(data,token);
        const current = new Map((user.follows ?? []).map(item=>[followKey(item),item]));
        for (const item of changes) {
          const key = followKey(item);
          if (following) current.set(key,item);
          else current.delete(key);
        }
        user.follows = [...current.values()];
        return user.follows;
      });
      return response({follows});
    }),
  };
}
