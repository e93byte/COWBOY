import {createAccountDataHandlers} from '../data-handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = createAccountDataHandlers().export;
