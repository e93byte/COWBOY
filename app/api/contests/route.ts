import { AccountError } from "../../lib/account-store";
import { getAccountBackend } from "../../lib/store-backend";
import { assertSameOrigin, readJson, response, safely, sessionToken } from "../account/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = () => safely(async () =>
  response({ contests: await getAccountBackend().listContests() }));

export const POST = (request: Request) => safely(async () => {
  assertSameOrigin(request);
  const token = sessionToken(request);
  if (!token) throw new AccountError("unauthorized", "Sign in to join a contest.", 401);
  const body = await readJson(request, ["contestId"]);
  if (typeof body.contestId !== "string" || !body.contestId.trim()) {
    throw new AccountError("invalid_input", "Supply a contest id.");
  }
  const result = await getAccountBackend().joinContest(body.contestId, token);
  return response(result);
});
