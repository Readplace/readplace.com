import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { MAX_HTML_BYTES, MAX_PDF_BYTES } from "@packages/crawl-article";
import {
	MAX_BULK_PAGE_CONTENT_BYTES,
	MAX_PAGES_PER_BULK_SAVE,
	MAX_UPLOAD_CONTENT_BYTES,
	MAX_UPLOAD_REQUEST_BYTES,
} from "@packages/domain/article";
import { READLIST_LABEL_MAX_LENGTH, READLIST_MAX_PER_USER } from "@packages/domain/readlist";
import { SAMPLE_TEXT } from "@packages/api-samples";
import { ADVERTISED_CLIENTS, clientCategoryOfGroup } from "@packages/supported-clients";
import { MARKDOWN_MEDIA_TYPE, render, withInternalTracking } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";
import { ACTIVE_TTL_SECONDS, IDLE_TTL_SECONDS } from "../../../providers/oauth/dynamodb-oauth-clients";
import { AGENT_SCOPES_SUPPORTED } from "../../agent-auth";
import type { ArticleEntityProperties } from "../../api/article-siren";
import type { CollectionProperties, SearchFieldName } from "../../api/collection-siren";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { REFRESH_TOKEN_LIFETIME_SECONDS } from "../../oauth/oauth.routes";
import type { ArticleFrontmatter } from "../../shared/article-markdown/article-markdown";
import { megabytesLabel } from "../../shared/bytes-to-mb";

import { DEVELOPERS_STYLES } from "./developers.styles";

const DEVELOPERS_TEMPLATE = readFileSync(join(__dirname, "developers.template.html"), "utf-8");

const ORIGIN = "https://readplace.com";
const CANONICAL_URL = `${ORIGIN}/developers`;

const DEVELOPERS_TITLE = "Build on the Readplace API";

const DEVELOPERS_DESCRIPTION =
	"Register an OAuth client, discover the Siren API from one URL, then save, list, read and file a reader's articles.";

export const SampleLanguageSchema = z.enum(["http", "typescript", "swift"]);
export type SampleLanguage = z.infer<typeof SampleLanguageSchema>;
export const DEFAULT_SAMPLE_LANGUAGE: SampleLanguage = "http";

const LANGUAGE_TABS = [
	{ key: "http", label: "HTTP", path: "/developers" },
	{ key: "typescript", label: "TypeScript", path: "/developers?l=typescript" },
	{ key: "swift", label: "Swift", path: "/developers?l=swift" },
] as const satisfies readonly { key: SampleLanguage; label: string; path: string }[];

const DEVELOPERS_SCRIPT = `<script src="/client-dist/developers.client.js" defer></script>`;

function languageTabs(language: SampleLanguage) {
	return LANGUAGE_TABS.map((tab) => ({
		key: tab.key,
		label: tab.label,
		current: tab.key === language,
		href: withInternalTracking(tab.path, { source: "developers", content: `samples-${tab.key}` }),
	}));
}

function sampleVariants(language: SampleLanguage) {
	if (language === "http") {
		return { language, label: "HTTP", discovery: undefined, saveArticle: undefined };
	}
	const tab = LANGUAGE_TABS.find((candidate) => candidate.key === language);
	assert(tab, `no tab for the ${language} samples`);
	return {
		language,
		label: tab.label,
		discovery: SAMPLE_TEXT[language].discover,
		saveArticle: SAMPLE_TEXT[language].saveArticle,
	};
}

const CONTENT_CAPTURE_CLIENTS = ADVERTISED_CLIENTS.flatMap((client) =>
	clientCategoryOfGroup(client.group) === "contentCapture" ? [client.displayName] : [],
);

const COLLECTION_PROPERTY_DOCS = {
	tabs: "the To Read and Read tabs, each a <code>{label, rel, href}</code>. The tab you're on has the rel <code>current</code>. A listing holds one tab only, so walk both to see everything.",
	pages:
		"one <code>{label, rel, href}</code> per page, where the page you're on has the rel <code>current</code>. The <code>next</code> and <code>prev</code> links step one page at a time, and the <code>self</code> link is the page you're on.",
	readlists:
		"All and each named readlist, each a <code>{label, rel, href}</code>. Follow an href to open that readlist, or send it in a save's <code>readlists</code> field.",
	total: "a <code>{label}</code> to show the reader, not a number to compute with.",
	sort: "one <code>{label, rel, order, href}</code> per order, where the order you're on has the rel <code>current</code>. Follow an href to change the order.",
	pageSize: "presentation. The server picks the page size.",
	appearance: "presentation.",
	warning: "appears only on a <code>422</code> answer to <code>save-article</code>.",
	messages: "on a listing, these are only for Readplace's own apps.",
} satisfies Record<keyof CollectionProperties, string>;

const SEARCH_FIELD_DOCS = {
	status: "<code>unread</code> or <code>read</code>.",
	order: "<code>asc</code> or <code>desc</code>.",
	page: "1 or more.",
	url: "keeps only the article saved under that URL, if it's on the page you asked for.",
} satisfies Record<SearchFieldName, string>;

const ARTICLE_PROPERTY_DOCS = {
	id: "the article's id.",
	url: "the article's URL. When the saved link redirected, it's the destination.",
	title: "what to show.",
	siteName: "what to show.",
	excerpt: "what to show.",
	imageUrl: "an image URL, or <code>null</code>.",
	readTime:
		"<code>{value, label}</code>, where <code>value</code> is the minutes as a string and <code>label</code> is display text such as <code>5 min read</code>, or <code>null</code> when Readplace has no word count for the article.",
	sectionCount: "present on a document with sections, such as a PDF: how many it has.",
	status: "<code>unread</code> or <code>read</code>.",
	isRead: "the same fact as <code>status</code>, as a boolean.",
	savedAt: "an ISO 8601 UTC timestamp.",
	readAt: "an ISO 8601 UTC timestamp, or <code>null</code> until the article is read.",
	publishedOn:
		"the date the source published the article, as <code>YYYY-MM-DD</code>, or <code>null</code> when Readplace doesn't know it.",
	needsBrowserCapture:
		"<code>true</code> when the site blocked Readplace's fetch, so a capture from the reader's browser through <code>save-content</code> would get the article.",
	contentState:
		"<code>available</code>, <code>processing</code> or <code>unavailable</code>: whether the article has readable content, is still being prepared, or ended without any.",
	contentVersion:
		"changes when the article's content, metadata, crawl outcome or summary changes. Fetch the document again when it does.",
	mediaKind:
		'the kind of an uploaded file, such as <code>"book"</code> or <code>"audio"</code>; <code>null</code> for a saved link.',
	durationSeconds: "the length in seconds of an uploaded audio file the reader owns; <code>null</code> otherwise.",
	processing:
		"present only while Readplace is still working on the article. <code>label</code> is display text, <code>estimate</code> is an optional time left, and <code>refresh</code> gives the <code>href</code> to fetch after <code>afterSeconds</code> for the article's next version. When the next version has no <code>processing</code>, the work has settled or Readplace has stopped waiting, and a <code>messages</code> warning may say why.",
	messages: "server-authored messages to show the reader, present only when there are any; see Save links and pages.",
} satisfies Record<keyof ArticleEntityProperties, string>;

const FRONTMATTER_DOCS = {
	title: "the article's title.",
	source: "the article's URL.",
	site: "the article's site.",
	description: "when Readplace has it.",
	words: "when Readplace has it.",
	created: "when the reader saved it.",
	published: "the date the source published the article, as <code>YYYY-MM-DD</code>, when Readplace knows it.",
	readplace_id: "the article's id in Readplace.",
	readplace_url: "a link to the article in Readplace. Treat the link as opaque.",
	readplace_status: "the article's status.",
	readplace_read_at: "once it's read.",
	readplace_read_time: "in minutes, when known.",
	readplace_readlists: "the labels of the readlists that hold it.",
	readplace_content_status:
		"<code>processing</code>, <code>ready</code>, <code>failed</code> or <code>not-an-article</code>.",
	readplace_summary_status:
		"while the content is processing or ready: <code>pending</code>, <code>ready</code>, <code>failed</code> or <code>skipped</code>.",
	readplace_summary: "appears once the summary is ready.",
} satisfies Record<keyof ArticleFrontmatter, string>;

function documented(docs: Record<string, string>): { name: string; description: string }[] {
	return Object.entries(docs).map(([name, description]) => ({
		name,
		description,
	}));
}

const SECONDS_PER_HOUR = 60 * 60;
const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR;

export function DevelopersPage(input: { language: SampleLanguage }): PageBody {
	return {
		seo: {
			title: `${DEVELOPERS_TITLE} — Readplace`,
			description: DEVELOPERS_DESCRIPTION,
			canonicalUrl: CANONICAL_URL,
			robots: "noindex",
			structuredData: [
				{
					"@context": "https://schema.org",
					"@type": "WebPage",
					"@id": CANONICAL_URL,
					name: DEVELOPERS_TITLE,
					url: CANONICAL_URL,
					description: DEVELOPERS_DESCRIPTION,
					isPartOf: { "@type": "WebSite", name: "Readplace", url: ORIGIN },
					about: { "@id": `${ORIGIN}/#app` },
				},
			],
		},
		styles: DEVELOPERS_STYLES,
		bodyClass: "page-developers",
		scripts: DEVELOPERS_SCRIPT,
		content: {
			html: render(DEVELOPERS_TEMPLATE, {
				languageTabs: languageTabs(input.language),
				variants: sampleVariants(input.language),
				sirenMediaType: SIREN_MEDIA_TYPE,
				markdownMediaType: MARKDOWN_MEDIA_TYPE,
				scopeLabel: AGENT_SCOPES_SUPPORTED[0],
				contentCaptureClients: CONTENT_CAPTURE_CLIENTS,
				idleRegistrationHours: IDLE_TTL_SECONDS / SECONDS_PER_HOUR,
				activeRegistrationDays: ACTIVE_TTL_SECONDS / SECONDS_PER_DAY,
				refreshTokenDays: REFRESH_TOKEN_LIFETIME_SECONDS / SECONDS_PER_DAY,
				readlistLimit: READLIST_MAX_PER_USER,
				readlistNameLimit: READLIST_LABEL_MAX_LENGTH,
				inlineFileLimit: megabytesLabel(MAX_UPLOAD_CONTENT_BYTES),
				requestLimit: megabytesLabel(MAX_UPLOAD_REQUEST_BYTES),
				bulkPageCount: MAX_PAGES_PER_BULK_SAVE,
				bulkPageLimit: megabytesLabel(MAX_BULK_PAGE_CONTENT_BYTES),
				pdfUploadLimit: MAX_PDF_BYTES.label,
				htmlUploadLimit: MAX_HTML_BYTES.label,
				collectionProperties: documented(COLLECTION_PROPERTY_DOCS),
				searchFields: documented(SEARCH_FIELD_DOCS),
				articleProperties: documented(ARTICLE_PROPERTY_DOCS),
				frontmatterKeys: documented(FRONTMATTER_DOCS),
			}),
		},
	};
}
