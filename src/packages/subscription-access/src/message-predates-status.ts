import type { EventInstant } from "@packages/domain/event-envelope";

export function messagePredatesStatus(params: {
	statusEnteredAt: string | undefined;
	eventTime: EventInstant;
}): boolean {
	return params.statusEnteredAt !== undefined && params.statusEnteredAt > params.eventTime;
}
