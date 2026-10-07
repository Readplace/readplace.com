import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import { toCanonicalHostUrl } from "./equivalent-hosts";
import { stripTrackingParams } from "./strip-tracking-params";

const MAX_ENCODED_SEGMENT_LENGTH = 900;

function normalizeUrl(url: string): string {
	const parsed = new URL(url);
	const port = parsed.port ? `:${parsed.port}` : "";
	return `${parsed.hostname}${port}${parsed.pathname}${parsed.search}`;
}

function toS3KeySegment(value: string): string {
	const encoded = encodeURIComponent(value);
	if (encoded.length <= MAX_ENCODED_SEGMENT_LENGTH) return encoded;
	return `sha256-${bytesToHex(sha256(value))}`;
}

export class ArticleResourceUniqueId {
	readonly value: string;
	private constructor(value: string) {
		this.value = value;
	}
	static parse(url: string): ArticleResourceUniqueId {
		return new ArticleResourceUniqueId(normalizeUrl(stripTrackingParams(url)));
	}
	toS3ContentKey(): string {
		return `content/${toS3KeySegment(this.value)}/content.html`;
	}
	toS3ImageKey(filename: string): string {
		return `content/${toS3KeySegment(this.value)}/images/${filename}`;
	}
	toS3PendingHtmlKey(saveAttemptId: string): string {
		return `pending-html/${toS3KeySegment(this.value)}/${toS3KeySegment(saveAttemptId)}.html`;
	}
	toS3PendingPdfKey(saveAttemptId: string): string {
		return `pending-pdf/${toS3KeySegment(this.value)}/${toS3KeySegment(saveAttemptId)}.pdf`;
	}
	toS3RefreshHtmlKey(saveAttemptId: string): string {
		return `refresh-html/${toS3KeySegment(this.value)}/${toS3KeySegment(saveAttemptId)}.html`;
	}
	toS3RefreshEvaluationHtmlKey(saveAttemptId: string): string {
		return `${this.toS3RefreshHtmlKey(saveAttemptId)}.evaluation`;
	}
	toS3SourceKey({ tier }: { tier: string }): string {
		return `articles/${toS3KeySegment(this.value)}/sources/${tier}.html`;
	}
	toS3ContentVersionKey({ minuteId }: { minuteId: string }): string {
		return `content-versions/${toS3KeySegment(this.value)}/${minuteId.replaceAll(":", "-")}/content.html`;
	}
	toS3ImagePrefix(): string {
		return `content/${toS3KeySegment(this.value)}/images/`;
	}
	toS3SourcesPrefix(): string {
		return `articles/${toS3KeySegment(this.value)}/sources/`;
	}
	toS3CandidatesPrefix({ tier }: { tier: string }): string {
		return `${this.toS3SourceKey({ tier })}.candidates/`;
	}
	toS3MediaOwnersPrefix(): string {
		return `${this.toS3SourcesPrefix()}media-owners/`;
	}
	toS3ContentVersionsPrefix(): string {
		return `content-versions/${toS3KeySegment(this.value)}/`;
	}
	toS3SourceMetadataKey({ tier }: { tier: string }): string {
		return `articles/${toS3KeySegment(this.value)}/sources/${tier}.metadata.json`;
	}
	toImageCdnUrl({ baseUrl, filename }: { baseUrl: string; filename: string }): string {
		// Double-encoded: the CDN URL-decodes once before looking up the singly-encoded S3 key.
		return `${baseUrl}/content/${encodeURIComponent(toS3KeySegment(this.value))}/images/${filename}`;
	}
	toString(): string {
		return this.value;
	}
}

export function canonicalIdentityOf(url: string): string {
	return ArticleResourceUniqueId.parse(toCanonicalHostUrl(url)).value;
}

export function toCrawlVersionMinuteId(iso: string): string {
	return `${new Date(iso).toISOString().slice(0, 16)}Z`;
}

export { equivalentHostUrls, toCanonicalHostUrl } from "./equivalent-hosts";
export { resolveCanonicalUrl, type CanonicalSignals } from "./resolve-canonical-url";
export { extractCanonicalCandidates, type CanonicalDocument } from "./extract-canonical-candidates";
