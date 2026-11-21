import { createHash } from "node:crypto";
import { AccountError } from "../../lib/account-store";
import { ParlayService } from "../../lib/parlay-service";
import { assertSameOrigin, MutationLimiter, readJson, response, safely, sessionToken } from "../account/handlers";

export function createParlayHandlers({ service, limiter = new MutationLimiter({ limit: 30, windowMs: 60000 }) }: { service: ParlayService; limiter?: MutationLimiter }) {
  const mutation = async (request: Request) => {
    assertSameOrigin(request);
    const token = sessionToken(request);
    await service.list(token);
    limiter.check("parlays-global", 120);
    limiter.check("session:" + createHash("sha256").update(token!).digest("hex"));
    return token;
  };
  return {
    GET: (request: Request) => safely(async () => response({ parlays: await service.list(sessionToken(request)) })),
    POST: (request: Request) => safely(async () => {
      const token = await mutation(request);
      const body = await readJson(request, ["legs", "chipStake"]);
      const input = body as { legs: Array<{ eventId: string; league: string; market: "moneyline" | "spread" | "total"; side: "home" | "away" | "draw" | "over" | "under"; line: number | null; requestId: string }>; chipStake?: number };
      return response({ parlay: await service.submit(token, { legs: input.legs, chipStake: input.chipStake }) });
    }),
    REFRESH: (request: Request) => safely(async () => {
      const token = await mutation(request);
      if (request.body) await readJson(request, []);
      return response({ parlays: await service.refresh(token) });
    }),
  };
}