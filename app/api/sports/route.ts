import { createSportsHandlers } from './handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const { board } = createSportsHandlers();

export function GET(request: Request) {
  return board(request);
}
