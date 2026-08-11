import "../zod-config";
import { z } from "zod";

const BulkSaveJobSchema = z.object({
	id: z.string(),
	url: z.string(),
	title: z.string().optional(),
	mediaType: z.string().optional(),
	attempts: z.number().int().nonnegative(),
	nextAttemptAt: z.number().int(),
	createdAt: z.number().int(),
});

export type BulkSaveJob = z.infer<typeof BulkSaveJobSchema>;

export function parseBulkSaveJobs(raw: unknown): BulkSaveJob[] {
	const stored = z.array(z.unknown()).safeParse(raw);
	if (!stored.success) return [];
	return stored.data.flatMap((entry) => {
		const job = BulkSaveJobSchema.safeParse(entry);
		return job.success ? [job.data] : [];
	});
}
