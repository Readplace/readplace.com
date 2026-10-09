import assert from "node:assert/strict";
import { MinutesSchema } from "@packages/domain/article";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import type { ArticleStoreBundle, AuthBundle } from "@packages/web-test-harness";

export async function seedInto(
	harness: {
		auth: Pick<AuthBundle, "findUserByEmail">;
		articleStore: Pick<ArticleStoreBundle, "saveReadlistArticle">;
	},
	seed: { readlist: string; url: string },
) {
	const user = await harness.auth.findUserByEmail("test@example.com");
	assert(user, "seeded login user must exist");
	return harness.articleStore.saveReadlistArticle({
		userId: user.userId,
		readlist: ReadlistSlugSchema.parse(seed.readlist),
		url: seed.url,
		metadata: { title: seed.url, siteName: "example.com", excerpt: "", wordCount: 0 },
		estimatedReadTime: MinutesSchema.parse(0),
		provenance: { kind: "web" },
		savedAt: new Date(),
	});
}
