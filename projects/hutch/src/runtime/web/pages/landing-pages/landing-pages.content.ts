import { AI_READING_LIST_CONTENT } from "./ai-reading-list.content";
import { PDF_OCR_CONTENT } from "./pdf-ocr.content";
import { POCKET_ALTERNATIVE_CONTENT } from "./pocket-alternative.content";
import { READ_IT_LATER_THAT_WONT_DIE_CONTENT } from "./read-it-later-that-wont-die.content";
import type { LandingPageContent, LandingPageSlug } from "./landing-pages.types";

/**
 * The registry the routes and the sitemap enumerate. Keyed by `LandingPageSlug`
 * rather than a bare object so adding a slug to the union without writing its
 * page — or shipping a page nothing routes to — fails the build instead of
 * quietly serving a 404 from an advertised URL.
 */
export const LANDING_PAGE_CONTENT: Record<LandingPageSlug, LandingPageContent> = {
	"pocket-alternative": POCKET_ALTERNATIVE_CONTENT,
	"pdf-ocr": PDF_OCR_CONTENT,
	"ai-reading-list": AI_READING_LIST_CONTENT,
	"read-it-later-that-wont-die": READ_IT_LATER_THAT_WONT_DIE_CONTENT,
};
