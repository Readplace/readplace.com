import { stripTrackingParams } from "./strip-tracking-params";

function normalizeUrl(url: string): string {
	const parsed = new URL(url);
	const port = parsed.port ? `:${parsed.port}` : "";
	return `${parsed.hostname}${port}${parsed.pathname}${parsed.search}`;
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
		return `content/${encodeURIComponent(this.value)}/content.html`;
	}
	toS3ImageKey(filename: string): string {
		return `content/${encodeURIComponent(this.value)}/images/${filename}`;
	}
	toS3PendingHtmlKey(): string {
		return `pending-html/${encodeURIComponent(this.value)}.html`;
	}
	toS3RefreshHtmlKey(): string {
		return `refresh-html/${encodeURIComponent(this.value)}.html`;
	}
	toS3SourceKey({ tier }: { tier: string }): string {
		return `articles/${encodeURIComponent(this.value)}/sources/${tier}.html`;
	}
	toS3SourceMetadataKey({ tier }: { tier: string }): string {
		return `articles/${encodeURIComponent(this.value)}/sources/${tier}.metadata.json`;
	}
	toImageCdnUrl({ baseUrl, filename }: { baseUrl: string; filename: string }): string {
		// Double-encoded: the CDN URL-decodes once before looking up the singly-encoded S3 key.
		return `${baseUrl}/content/${encodeURIComponent(encodeURIComponent(this.value))}/images/${filename}`;
	}
	toString(): string {
		return this.value;
	}
}
