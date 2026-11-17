import { createSportsHandlers } from '../handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = createSportsHandlers().event;
