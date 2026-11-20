import { createPasswordResetHandlers } from "../../email-handlers";
import { sharedMutationLimiter } from "../../handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createPasswordResetHandlers({
  limiter: sharedMutationLimiter("password-reset-confirm", { limit: 10, windowMs: 15 * 60 * 1000 }),
}).CONFIRM;
