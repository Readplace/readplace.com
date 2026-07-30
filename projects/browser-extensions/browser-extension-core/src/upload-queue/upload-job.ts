import "../zod-config";
import { z } from "zod";

const UploadJobBaseSchema = z.object({
	id: z.string(),
	url: z.string(),
	title: z.string().optional(),
	attempts: z.number().int().nonnegative(),
	nextAttemptAt: z.number().int(),
	createdAt: z.number().int(),
});

const UploadJobSchema = z.discriminatedUnion("state", [
	UploadJobBaseSchema.extend({
		state: z.literal("capturing"),
		tabId: z.number().optional(),
	}),
	UploadJobBaseSchema.extend({
		state: z.literal("ready"),
		mediaType: z.string(),
	}),
]);

export type UploadJob = z.infer<typeof UploadJobSchema>;

export function parseUploadJobs(raw: unknown): UploadJob[] {
	const stored = z.array(z.unknown()).safeParse(raw);
	if (!stored.success) return [];
	return stored.data.flatMap((entry) => {
		const job = UploadJobSchema.safeParse(entry);
		return job.success ? [job.data] : [];
	});
}
