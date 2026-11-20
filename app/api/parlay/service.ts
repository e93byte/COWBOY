import { getLiveEvent } from "../../lib/live-sports";
import { ParlayService } from "../../lib/parlay-service";
import { getAccountBackend } from "../../lib/store-backend";
import { createParlayHandlers } from "./handlers";
import { sharedMutationLimiter } from "../account/handlers";

export const parlayHandlers = createParlayHandlers({
  service: new ParlayService({ store: getAccountBackend(), getEvent: getLiveEvent }),
  limiter: sharedMutationLimiter("parlays", { limit: 30, windowMs: 60000 }),
});