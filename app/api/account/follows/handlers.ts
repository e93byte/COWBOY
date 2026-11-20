import { AccountError } from '../../../lib/account-store';
import type { AccountBackend } from '../../../lib/store-backend';
import { getAccountBackend } from '../../../lib/store-backend';
import { followKey, isFollowPreference, type FollowPreference } from '../../../lib/follow-preferences';
import { LIVE_LEAGUES } from '../../../lib/live-sports';
import { assertSameOrigin, MutationLimiter, readJson, response, safely, sessionToken } from '../handlers';

export function createFollowHandlers({store = getAccountBackend(), limiter = new MutationLimiter({limit:40,windowMs:60000})}: {store?: AccountBackend; limiter?: MutationLimiter} = {}) {
  return {
    GET: (request: Request) => safely(async () => response({follows: await store.getFollows(sessionToken(request))})),
    PATCH: (request: Request) => safely(async () => {
      assertSameOrigin(request);
      const token = sessionToken(request);
      const owner = await store.getUser(token);
      if (!owner) throw new AccountError('unauthorized','Sign in to manage your follows.',401);
      limiter.check('follows-global',160);
      limiter.check('follows-owner:'+owner.id);
      const {entries, following} = await readJson(request,['entries','following']);
      if (typeof following !== 'boolean' || !Array.isArray(entries) || !entries.length || entries.length > 8 ||
          entries.some(entry => !isFollowPreference(entry) ||
            !LIVE_LEAGUES.some(league=>league.id===entry.league && (league.sport!=='golf' || entry.kind==='league')))) {
        throw new AccountError('invalid_input','Choose valid games, teams or leagues to update.');
      }
      const changes: FollowPreference[] = entries.map(({kind,id,league,name})=>({kind,id,league,name:name.trim()}));
      const current = new Map((await store.getFollows(token)).map(item=>[followKey(item),item]));
      for (const item of changes) {
        const key = followKey(item);
        if (following) current.set(key,item);
        else current.delete(key);
      }
      const follows = await store.setFollows(token, [...current.values()]);
      return response({follows});
    }),
  };
}
