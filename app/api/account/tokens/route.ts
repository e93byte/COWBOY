import { getAccountBackend } from "../../../lib/store-backend";
import { response, safely, sessionToken } from "../handlers";
import { AccountError } from "../../../lib/account-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: Request) => safely(async () => {
  const token = sessionToken(request);
  if (!token) throw new AccountError("unauthorized", "Sign in to view your tokens.", 401);
  const backend = getAccountBackend();
  const result = await backend.getTokens(token);
  return response(result);
});
