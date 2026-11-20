import {AccountError} from '../../lib/account-store';
import type {AccountBackend} from '../../lib/store-backend';
import {getAccountBackend} from '../../lib/store-backend';
import {assertSameOrigin, MutationLimiter, readJson, response, safely, sessionCookie, sessionToken} from './handlers';

export function createAccountDataHandlers({store = getAccountBackend(), limiter = new MutationLimiter()}: {store?: AccountBackend; limiter?: MutationLimiter} = {}) {
  return {
    export: (request: Request) => safely(async () => {
      const data = await store.exportAccount(sessionToken(request));
      return response(data,200,{'Content-Disposition':'attachment; filename="cowboy-account.json"'});
    }),
    delete: (request: Request) => safely(async () => {
      assertSameOrigin(request);
      const token = sessionToken(request);
      const owner = await store.getUser(token);
      if (!owner) throw new AccountError('unauthorized','Sign in before deleting your account.',401);
      limiter.check('delete-global',30);
      limiter.check('delete:'+owner.id,5);
      const {password} = await readJson(request,['password']);
      if (typeof password !== 'string') throw new AccountError('invalid_input','Enter your current password.');
      await store.deleteAccount(token,password);
      return response({user:null},200,{'Set-Cookie':sessionCookie(request,'',0)});
    }),
    revokeSessions: (request: Request) => safely(async () => {
      assertSameOrigin(request);
      const token = sessionToken(request);
      const owner = await store.getUser(token);
      if (!owner) throw new AccountError('unauthorized','Sign in to manage account sessions.',401);
      limiter.check('revoke-global',60);
      limiter.check('revoke:'+owner.id);
      await readJson(request,[]);
      return response({revoked: await store.revokeOtherSessions(token)});
    }),
  };
}
