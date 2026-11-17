import { AccountStore } from "../../lib/account-store";
import { getLiveEvent } from "../../lib/live-sports";
import { PickService } from "../../lib/pick-service";
import { createPickHandlers } from "./handlers";
import { sharedMutationLimiter } from "../account/handlers";

export const pickHandlers = createPickHandlers({
  service: new PickService({ store: new AccountStore(), getEvent: getLiveEvent }),
  limiter: sharedMutationLimiter("picks", { limit: 30, windowMs: 60000 }),
});
