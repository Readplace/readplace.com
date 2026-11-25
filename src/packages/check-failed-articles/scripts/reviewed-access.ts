import { z } from "zod";

const ReviewedAccessCategorySchema = z.enum([
	"public-reader-opened-before-failure",
	"signed-in-reader-opened-before-failure",
	"readlist-admission-reader-history-incomplete",
	"authenticated-submission",
	"scheduled-digest-preparation",
	"operator-recrawl",
]);
const ReviewedAccessSchema = z.array(z.tuple([
	z.string().length(64).regex(/^[0-9a-f]{64}$/),
	ReviewedAccessCategorySchema,
]));
const INVALID_ACCESS = "FAILED_ARTICLES_REVIEWED_ACCESS must be a JSON array of [unique lowercase SHA-256 hex digest, known access category] pairs";

export type ReviewedAccessCategory = z.infer<typeof ReviewedAccessCategorySchema>;

export function parseReviewedAccess(raw: string | undefined): ReadonlyMap<string, ReviewedAccessCategory> {
	const reviewedAccess = new Map<string, ReviewedAccessCategory>();
	if (raw === undefined || raw === "") return reviewedAccess;
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch {
		throw new Error(INVALID_ACCESS);
	}
	const parsed = ReviewedAccessSchema.safeParse(json);
	if (!parsed.success) throw new Error(INVALID_ACCESS);
	for (const [digest, category] of parsed.data) {
		if (reviewedAccess.has(digest)) throw new Error(INVALID_ACCESS);
		reviewedAccess.set(digest, category);
	}
	return reviewedAccess;
}
