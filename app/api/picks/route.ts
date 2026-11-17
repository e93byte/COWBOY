import { pickHandlers } from "./service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = pickHandlers.GET;
export const POST = pickHandlers.POST;
export const PATCH = pickHandlers.PATCH;
export const DELETE = pickHandlers.DELETE;
