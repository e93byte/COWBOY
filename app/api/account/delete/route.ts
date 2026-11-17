import {createAccountDataHandlers} from '../data-handlers';
import {sharedMutationLimiter} from '../handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const DELETE = createAccountDataHandlers({limiter:sharedMutationLimiter('account-delete',{limit:5,windowMs:60000})}).delete;
