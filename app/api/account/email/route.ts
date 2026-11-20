import { createEmailHandlers } from "../email-handlers";
import { sharedMutationLimiter } from "../handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handlers = createEmailHandlers({ limiter: sharedMutationLimiter("account-email", { limit: 10, windowMs: 15 * 60 * 1000 }) });
export const POST = handlers.POST;
export const GET = handlers.VERIFY;
