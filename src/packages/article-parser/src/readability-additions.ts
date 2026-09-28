import type { ReadabilityAdditions } from "./article-parser.types";
import { normalizeImplicitBody } from "./normalize-implicit-body";
import { promoteBrParagraphHosts } from "./promote-br-paragraph-hosts";
import { replaceEmbedsWithFacade } from "./replace-embeds-with-facade";
import { replaceVideosWithPlaceholder } from "./replace-videos-with-placeholder";
import { resolveRelativeUrls } from "./resolve-relative-urls";
import { restoreRetaggedTables } from "./restore-retagged-tables";

export const readabilityAdditions: ReadabilityAdditions = {
	normalizeImplicitBody,
	replaceVideosWithPlaceholder,
	replaceEmbedsWithFacade,
	promoteBrParagraphHosts,
	restoreRetaggedTables,
	resolveRelativeUrls,
};
