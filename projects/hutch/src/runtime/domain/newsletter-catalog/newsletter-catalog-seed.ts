import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type NewsletterCatalogSeed, NewsletterCatalogSeedSchema } from "@packages/domain/newsletter-catalog";

export function readNewsletterCatalogSeed(): NewsletterCatalogSeed {
	return NewsletterCatalogSeedSchema.parse(JSON.parse(readFileSync(join(__dirname, "newsletter-catalog.seed.json"), "utf-8")));
}
