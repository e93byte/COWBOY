import { getAccountBackend } from "../../../../lib/store-backend";
import { response, safely } from "../../../account/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ contestId: string }> }) {
  const { contestId } = await context.params;
  return safely(async () =>
    response({ standings: await getAccountBackend().contestStandings(contestId) }));
}
