import { z } from "zod";

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
