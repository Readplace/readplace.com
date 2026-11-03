import { z } from "zod";

export const FOUNDER_NOTE_CHOICES = ["day-1", "day-12"] as const;

export const FormFieldsSchema = z
	.object({
		email: z.string().catch(""),
		note: z.string().catch(""),
		sentAt: z.string().catch(""),
	})
	.catch({ email: "", note: "", sentAt: "" });

export type FounderNoteFormFields = z.infer<typeof FormFieldsSchema>;

const LATEST_LOCAL_OFFSET_MS = 14 * 60 * 60 * 1000;

function utcDateOf(date: Date): string {
	return date.toISOString().slice(0, 10);
}

function isCalendarDate(value: string): boolean {
	const time = Date.parse(`${value}T00:00:00.000Z`);
	return !Number.isNaN(time) && utcDateOf(new Date(time)) === value;
}

export function founderNoteSchema(now: Date) {
	const today = utcDateOf(now);
	const latest = utcDateOf(new Date(now.getTime() + LATEST_LOCAL_OFFSET_MS));
	return z.object({
		email: z.email({ message: "Enter a valid email address" }),
		note: z.enum(FOUNDER_NOTE_CHOICES, { message: "Choose which note you sent" }),
		sentAt: z
			.string()
			.transform((value) => (value === "" ? today : value))
			.pipe(
				z
					.string()
					.refine(isCalendarDate, "Choose a valid date")
					.refine((value) => value <= latest, `Choose a date no later than ${latest}`)
					.transform((value) => `${value}T00:00:00.000Z`),
			),
	});
}
