import { AccountError } from "../../../lib/account-store";
import { getAccountBackend } from "../../../lib/store-backend";
import { assertSameOrigin, readJson, response, safely, sessionToken, sharedMutationLimiter } from "../handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const limiter = sharedMutationLimiter("leaderboard-opt-in", { limit: 10, windowMs: 15 * 60 * 1000 });

export const GET = (request: Request) => safely(async () => {
  const user = await getAccountBackend().getUser(sessionToken(request));
  if (!user) throw new AccountError("unauthorized", "Sign in to manage your leaderboard profile.", 401);
  return response({ enabled: user.leaderboardOptIn === true });
});

export const POST = (request: Request) => safely(async () => {
  assertSameOrigin(request);
  limiter.check("leaderboard", 10);
  const token = sessionToken(request);
  if (!token) throw new AccountError("unauthorized", "Sign in to manage your leaderboard profile.", 401);
  const body = await readJson(request, ["enabled"]);
  if (typeof body.enabled !== "boolean") throw new AccountError("invalid_input", "Supply a boolean enabled flag.");
  const user = await getAccountBackend().setLeaderboardOptIn(token, body.enabled);
  return response({ enabled: user.leaderboardOptIn === true });
});
