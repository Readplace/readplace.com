import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_HTML_BYTES, MAX_PDF_BYTES } from "@packages/crawl-article";
import {
	MAX_BULK_PAGE_CONTENT_BYTES,
	MAX_PAGES_PER_BULK_SAVE,
	MAX_UPLOAD_CONTENT_BYTES,
	MAX_UPLOAD_REQUEST_BYTES,
} from "@packages/domain/article";
import { READLIST_LABEL_MAX_LENGTH, READLIST_MAX_PER_USER } from "@packages/domain/readlist";
import { ADVERTISED_CLIENTS, clientCategoryOfGroup } from "@packages/supported-clients";
import { MARKDOWN_MEDIA_TYPE, render } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";
import { ACTIVE_TTL_SECONDS, IDLE_TTL_SECONDS } from "../../../providers/oauth/dynamodb-oauth-clients";
import { AGENT_SCOPES_SUPPORTED } from "../../agent-auth";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { REFRESH_TOKEN_LIFETIME_SECONDS } from "../../oauth/oauth.routes";
import { bytesToMb } from "../../shared/bytes-to-mb";

import { DEVELOPERS_STYLES } from "./developers.styles";

const DEVELOPERS_TEMPLATE = readFileSync(join(__dirname, "developers.template.html"), "utf-8");

const ORIGIN = "https://readplace.com";
const CANONICAL_URL = `${ORIGIN}/developers`;

const DEVELOPERS_TITLE = "Build on the Readplace API";

const DEVELOPERS_DESCRIPTION =
	"Register an OAuth client, discover the Siren API from one URL, then save, list, read and file a reader's articles.";

const CONTENT_CAPTURE_CLIENTS = ADVERTISED_CLIENTS.flatMap((client) =>
	clientCategoryOfGroup(client.group) === "contentCapture" ? [client.displayName] : [],
);

const SECONDS_PER_HOUR = 60 * 60;
const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR;

function megabytes(bytes: number): string {
	return `${bytesToMb(bytes)} MB`;
}

export function DevelopersPage(): PageBody {
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
		content: {
			html: render(DEVELOPERS_TEMPLATE, {
				sirenMediaType: SIREN_MEDIA_TYPE,
				markdownMediaType: MARKDOWN_MEDIA_TYPE,
				scopeLabel: AGENT_SCOPES_SUPPORTED[0],
				contentCaptureClients: CONTENT_CAPTURE_CLIENTS,
				idleRegistrationHours: IDLE_TTL_SECONDS / SECONDS_PER_HOUR,
				activeRegistrationDays: ACTIVE_TTL_SECONDS / SECONDS_PER_DAY,
				refreshTokenDays: REFRESH_TOKEN_LIFETIME_SECONDS / SECONDS_PER_DAY,
				readlistLimit: READLIST_MAX_PER_USER,
				readlistNameLimit: READLIST_LABEL_MAX_LENGTH,
				inlineFileLimit: megabytes(MAX_UPLOAD_CONTENT_BYTES),
				requestLimit: megabytes(MAX_UPLOAD_REQUEST_BYTES),
				bulkPageCount: MAX_PAGES_PER_BULK_SAVE,
				bulkPageLimit: megabytes(MAX_BULK_PAGE_CONTENT_BYTES),
				pdfUploadLimit: MAX_PDF_BYTES.label,
				htmlUploadLimit: MAX_HTML_BYTES.label,
			}),
		},
	};
}
