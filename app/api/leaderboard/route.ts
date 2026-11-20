import { getAccountBackend } from "../../lib/store-backend";
import { response, safely } from "../account/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public, privacy-opt-in free-pick accuracy ranking. Aggregate counts only —
// no user ids, tokens, stakes, or payout values are exposed.
export const GET = () => safely(async () =>
  response({ entries: await getAccountBackend().publicLeaderboard() }));
