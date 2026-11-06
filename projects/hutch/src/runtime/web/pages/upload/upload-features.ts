import { z } from "zod";

const TRANSCRIPTS_FEATURE = "transcripts";

const FeaturesQuery = z.object({ features: z.string() });

export function isMeteredStart(query: Readonly<Record<string, unknown>>): boolean {
	const parsed = FeaturesQuery.safeParse(query);
	return parsed.success && parsed.data.features.split(",").includes(TRANSCRIPTS_FEATURE);
}

export function uploadStartPathOf(metered: boolean): string {
	return metered ? `/upload?features=${TRANSCRIPTS_FEATURE}` : "/upload";
}
