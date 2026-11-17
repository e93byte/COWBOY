import {createAccountDataHandlers} from '../data-handlers';
import {sharedMutationLimiter} from '../handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = createAccountDataHandlers({limiter:sharedMutationLimiter('sessions',{limit:30,windowMs:60000})}).revokeSessions;
