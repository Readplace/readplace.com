import { publishedOnFrom } from "@packages/domain/article";
import type { ReadabilityAdditions } from "./article-parser.types";
import { demoteBodyHeadings } from "./demote-body-headings";
import { normalizeImplicitBody } from "./normalize-implicit-body";
import { normalizeMalformedTitleEndTag, preserveQualifiedTitleHeading } from "./normalize-malformed-title-end-tag";
import { promoteBrParagraphHosts } from "./promote-br-paragraph-hosts";
import { replaceEmbedsWithFacade } from "./replace-embeds-with-facade";
import { replaceVideosWithPlaceholder } from "./replace-videos-with-placeholder";
import { resolveRelativeUrls } from "./resolve-relative-urls";
import { preserveSubstackImagePreview } from "./substack-image-preview";
import { restoreRetaggedTables } from "./restore-retagged-tables";
import { unwrapArticleBodyTemplates } from "./unwrap-article-body-templates";

export const readabilityAdditions: ReadabilityAdditions = {
	normalizeMalformedTitleEndTag,
	preserveQualifiedTitleHeading,
	normalizeImplicitBody,
	preserveSubstackImagePreview,
	unwrapArticleBodyTemplates,
	replaceVideosWithPlaceholder,
	replaceEmbedsWithFacade,
	demoteBodyHeadings,
	promoteBrParagraphHosts,
	restoreRetaggedTables,
	resolveRelativeUrls,
	publishedOnFrom,
};
