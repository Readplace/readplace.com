import { z } from "zod";
import { type NewsletterFromRefusal, NewsletterNameSchema, checkNewsletterFrom } from "@packages/domain/newsletter-catalog";
import { formFields } from "./admin-newsletters.url";

export const ADMIN_NEWSLETTER_FIELD_MESSAGES = {
	from: "Enter the exact FROM address, such as newsletter@example.com, or *@example.com for every sender at that domain.",
	newFrom: "Enter the exact corrected FROM address, such as newsletter@example.com, or *@example.com for every sender at that domain.",
	unsupportedWildcard: "A * only works as the whole name before the @, like *@example.com.",
	name: "Keep the newsletter name to 80 characters.",
	evidenceUrl: "Enter a full https:// link to the publisher page.",
	evidenceNote: "Keep the evidence note to 500 characters.",
	evidenceRequired: "Add a publisher link or a note that shows where this FROM address comes from.",
	duplicateFrom: "The catalog already has a record for this FROM address.",
} as const;

function senderField(invalidMessage: string) {
	const messages: Record<NewsletterFromRefusal, string> = {
		"unsupported-wildcard": ADMIN_NEWSLETTER_FIELD_MESSAGES.unsupportedWildcard,
		invalid: invalidMessage,
	};
	return z.string().transform((value, ctx) => {
		const check = checkNewsletterFrom(value);
		if (!check.ok) ctx.addIssue(messages[check.reason]);
		return check.ok ? check.from : z.NEVER;
	});
}

export const FromCheckCandidateSchema = z.string().catch("");

const NameField = z
	.string()
	.trim()
	.max(80, { error: ADMIN_NEWSLETTER_FIELD_MESSAGES.name })
	.transform((value) => (value === "" ? undefined : NewsletterNameSchema.parse(value)));

const EvidenceUrlField = z
	.string()
	.trim()
	.refine((value) => value === "" || z.url({ protocol: /^https?$/ }).safeParse(value).success, {
		error: ADMIN_NEWSLETTER_FIELD_MESSAGES.evidenceUrl,
	})
	.transform((value) => (value === "" ? undefined : value));

const EvidenceNoteField = z
	.string()
	.trim()
	.max(500, { error: ADMIN_NEWSLETTER_FIELD_MESSAGES.evidenceNote })
	.transform((value) => (value === "" ? undefined : value));

const ReviewedRecordFields = {
	from: senderField(ADMIN_NEWSLETTER_FIELD_MESSAGES.from),
	updated_at: z.iso.datetime(),
};

export const CreateNewsletterBodySchema = z.object({
	from: senderField(ADMIN_NEWSLETTER_FIELD_MESSAGES.from),
	name: NameField,
	evidence_url: EvidenceUrlField,
	evidence_note: EvidenceNoteField,
});

export const UpdateNewsletterBodySchema = z.object({
	...ReviewedRecordFields,
	name: NameField,
	evidence_url: EvidenceUrlField,
	evidence_note: EvidenceNoteField,
});

export const CorrectNewsletterBodySchema = z.object({
	...ReviewedRecordFields,
	new_from: senderField(ADMIN_NEWSLETTER_FIELD_MESSAGES.newFrom),
});

export const ReviewNewsletterBodySchema = z.object(ReviewedRecordFields);

export const CreateNewsletterValuesSchema = formFields(
	z.object({
		from: z.string().catch(""),
		name: z.string().catch(""),
		evidence_url: z.string().catch(""),
		evidence_note: z.string().catch(""),
	}),
);
export type CreateNewsletterValues = z.infer<typeof CreateNewsletterValuesSchema>;

export const EditNewsletterValuesSchema = formFields(
	z.object({
		name: z.string().catch(""),
		evidence_url: z.string().catch(""),
		evidence_note: z.string().catch(""),
	}),
);
export type EditNewsletterValues = z.infer<typeof EditNewsletterValuesSchema>;

export const CorrectNewsletterValuesSchema = formFields(
	z.object({
		new_from: z.string().catch(""),
	}),
);
export type CorrectNewsletterValues = z.infer<typeof CorrectNewsletterValuesSchema>;

export const AttemptedRecordSchema = formFields(
	z.object({
		from: z.string().catch(""),
		updated_at: z.string().catch(""),
	}),
);
