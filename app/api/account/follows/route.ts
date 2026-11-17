import { sharedMutationLimiter } from '../handlers';
import { createFollowHandlers } from './handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handlers = createFollowHandlers({limiter:sharedMutationLimiter('follows',{limit:40,windowMs:60000})});
export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
