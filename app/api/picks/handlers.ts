import { createHash } from "node:crypto";
import { AccountError } from "../../lib/account-store";
import { PickService } from "../../lib/pick-service";
import { assertSameOrigin, MutationLimiter, readJson, response, safely, sessionToken } from "../account/handlers";

export function createPickHandlers({ service, limiter = new MutationLimiter({ limit: 30, windowMs: 60000 }) }: { service: PickService; limiter?: MutationLimiter }) {
  const mutation = async (request: Request) => {
    assertSameOrigin(request);
    const token = sessionToken(request);
    await service.list(token); // Require authentication before parsing or contacting the event provider.
    limiter.check("picks-global", 120);
    limiter.check("session:" + createHash("sha256").update(token!).digest("hex"));
    return token;
  };
  return {
    GET: (request: Request) => safely(async () => response({ tickets: await service.list(sessionToken(request)) })),
    POST: (request: Request) => safely(async () => {
      const token = await mutation(request);
      const body = await readJson(request, ["eventId", "league", "side", "requestId"]);
      return response({ ticket: await service.submit(token, body) });
    }),
    BATCH: (request: Request) => safely(async () => {
      const token = await mutation(request);
      const body = await readJson(request, ["picks"]);
      return response({ tickets: await service.submitBatch(token, body.picks) });
    }),
    PATCH: (request: Request) => safely(async () => {
      const token = await mutation(request);
      const body = await readJson(request, ["id", "side", "revision"]);
      return response({ ticket: await service.edit(token, body) });
    }),
    REFRESH: (request: Request) => safely(async () => {
      const token = await mutation(request);
      if (request.body) await readJson(request, []);
      return response({ tickets: await service.refresh(token) });
    }),
    DELETE: (request: Request) => safely(async () => {
      const token = await mutation(request);
      const params = new URL(request.url).searchParams;
      if (params.getAll("id").length !== 1 || [...params.keys()].some((key) => key !== "id")) {
        throw new AccountError("invalid_input", "Supply exactly one ticket id query parameter.");
      }
      return response({ ticket: await service.cancel(token, params.get("id")) });
    }),
  };
}
