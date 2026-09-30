import { z } from "zod";
import { ForwardableSenderSchema } from "../gmail/build-forwarding-filter-query";

export const NewsletterNameSchema = z.string().trim().min(1).max(80).brand<"NewsletterName">();
export type NewsletterName = z.infer<typeof NewsletterNameSchema>;

export const NewsletterStatusSchema = z.enum(["pending", "approved", "rejected"]);
export type NewsletterStatus = z.infer<typeof NewsletterStatusSchema>;

export const NewsletterEvidenceSchema = z.object({
	kind: z.enum(["seed", "user-submission", "admin"]),
	url: z.url().optional(),
	note: z.string().max(500).optional(),
	addedAt: z.iso.datetime(),
});
export type NewsletterEvidence = z.infer<typeof NewsletterEvidenceSchema>;

export const NewsletterCatalogRecordSchema = z.object({
	from: ForwardableSenderSchema,
	name: NewsletterNameSchema.optional(),
	status: NewsletterStatusSchema,
	evidence: z.array(NewsletterEvidenceSchema),
	replacedBy: ForwardableSenderSchema.optional(),
	createdAt: z.iso.datetime(),
	updatedAt: z.iso.datetime(),
	reviewedAt: z.iso.datetime().optional(),
});
export type NewsletterCatalogRecord = z.infer<typeof NewsletterCatalogRecordSchema>;

export const NewsletterCatalogDocumentSchema = z
	.object({
		version: z.literal(1),
		records: z.array(NewsletterCatalogRecordSchema),
	})
	.refine((document) => new Set(document.records.map((record) => record.from)).size === document.records.length, {
		message: "Each newsletter FROM address appears in one catalog record",
	});
export type NewsletterCatalogDocument = z.infer<typeof NewsletterCatalogDocumentSchema>;

export const NewsletterCatalogSeedSchema = z.object({
	version: z.literal(1),
	entries: z.array(
		z.object({
			from: ForwardableSenderSchema,
			name: NewsletterNameSchema,
			evidence: z.array(z.object({ url: z.url().optional(), note: z.string().max(500) })).min(1),
		}),
	),
});
export type NewsletterCatalogSeed = z.infer<typeof NewsletterCatalogSeedSchema>;

export const NewsletterListStatusSchema = z.enum(["pending", "approved", "rejected", "all"]);
export type NewsletterListStatus = z.infer<typeof NewsletterListStatusSchema>;

export const NEWSLETTER_ADMIN_PAGE_SIZE = 50;
