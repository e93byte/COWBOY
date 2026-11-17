import { createAccountHandlers, sharedMutationLimiter } from "./handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handlers = createAccountHandlers({ limiter: sharedMutationLimiter("accounts") });
export const GET = handlers.GET;
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
