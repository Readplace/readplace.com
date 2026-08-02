import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
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
	toS3PendingHtmlKey(): string {
		return `pending-html/${toS3KeySegment(this.value)}.html`;
	}
	toS3PendingPdfKey(): string {
		return `pending-pdf/${toS3KeySegment(this.value)}.pdf`;
	}
	toS3RefreshHtmlKey(): string {
		return `refresh-html/${toS3KeySegment(this.value)}.html`;
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

export function toCrawlVersionMinuteId(iso: string): string {
	return `${new Date(iso).toISOString().slice(0, 16)}Z`;
}

export { resolveCanonicalUrl, type CanonicalSignals } from "./resolve-canonical-url";
export { extractCanonicalCandidates, type CanonicalDocument } from "./extract-canonical-candidates";
