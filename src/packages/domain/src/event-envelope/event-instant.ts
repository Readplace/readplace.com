import { z } from "zod";

export function floorToSecond(at: Date): Date {
	return new Date(Math.floor(at.getTime() / 1000) * 1000);
}

export const EventInstantSchema = z.iso
	.datetime()
	.transform((value) => floorToSecond(new Date(value)).toISOString().replace(".000Z", "Z"))
	.brand<"EventInstant">();

export type EventInstant = z.infer<typeof EventInstantSchema>;

export function toEventInstant(at: Date): EventInstant {
	return EventInstantSchema.parse(at.toISOString());
}
