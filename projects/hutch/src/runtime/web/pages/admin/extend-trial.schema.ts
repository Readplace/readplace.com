import { z } from "zod";

/** `<input type="datetime-local">` posts a bare wall clock (`YYYY-MM-DDTHH:mm`)
 * with no zone. Every instant this codebase stores is a UTC ISO string, so the
 * value is read as UTC and the field is labelled UTC — deterministic, and no
 * client bundle needed to ship an offset. */
const DATETIME_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

export const ExtendTrialSchema = z.object({
	email: z.email({ message: "Enter a valid email address" }),
	trialEndsAt: z
		.string()
		.regex(DATETIME_LOCAL, "Choose a date and time")
		.refine((value) => !Number.isNaN(Date.parse(`${value}Z`)), "Choose a valid date and time")
		.transform((value) => new Date(`${value}Z`).toISOString()),
});
