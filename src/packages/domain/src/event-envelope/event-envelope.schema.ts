import { z } from "zod";
import { EventInstantSchema } from "./event-instant";

export const EventEnvelope = z.object({ detail: z.unknown(), time: EventInstantSchema });
