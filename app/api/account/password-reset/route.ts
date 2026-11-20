import { createPasswordResetHandlers } from "../email-handlers";
import { sharedMutationLimiter } from "../handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createPasswordResetHandlers({
  limiter: sharedMutationLimiter("password-reset", { limit: 5, windowMs: 15 * 60 * 1000 }),
}).REQUEST;
