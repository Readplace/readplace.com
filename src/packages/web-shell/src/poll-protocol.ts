import { z } from "zod";

/**
 * Hard cap on how many `every 3s` poll ticks an article slot or card emits
 * before the client stops. 300 × 3s = 900s, matching the comprehensive-crawl
 * orchestrator Lambda timeout. Past that, the orchestrator has given up —
 * polling further can't reveal new state.
 */
export const MAX_POLLS = 300;

/**
 * The same cursor, budgeted for an on-device capture rather than the server
 * pipeline: the device render is a ~12s operation, so 20 × 3s = 60s covers it
 * plus the upload and the row leaving `failed`. Past that the capture is not
 * coming back, and continuing to claim it is in progress would be false.
 */
export const MAX_CAPTURE_POLLS = 20;

/**
 * The htmx poll cursor arrives as an untrusted query string, so a non-numeric
 * `?poll=` (e.g. `?poll=abc`) coerces to NaN. Left as NaN it defeats the
 * `pollCount > maxPolls` budget check (every comparison with NaN is false), so
 * the card would poll forever and never reach its give-up state. Coerce invalid
 * input to 0 and clamp the upper bound so a client can never request beyond the
 * budget. Shared by the queue card and the inbox link-preview card, which run
 * the identical poll-budget protocol against MAX_POLLS.
 */
const PollCountSchema = z.coerce.number().int().nonnegative();

export function parsePollParam(raw: unknown, maxPolls: number): number {
	const parsed = PollCountSchema.safeParse(raw);
	const value = parsed.success ? parsed.data : 0;
	return Math.min(value, maxPolls);
}
