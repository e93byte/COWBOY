import { getLiveEvent } from "../../lib/live-sports";
import { PickService } from "../../lib/pick-service";
import { getAccountBackend } from "../../lib/store-backend";
import { createPickHandlers } from "./handlers";
import { sharedMutationLimiter } from "../account/handlers";

export const pickHandlers = createPickHandlers({
  service: new PickService({ store: getAccountBackend(), getEvent: getLiveEvent }),
  limiter: sharedMutationLimiter("picks", { limit: 30, windowMs: 60000 }),
});
