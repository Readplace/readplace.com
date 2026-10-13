import { z } from "zod";

const SiteLabelSchema = z.string().brand<"SiteLabel">();
const ArticleDestinationUrlSchema = z.string().brand<"ArticleDestinationUrl">();
export type SiteLabel = z.infer<typeof SiteLabelSchema>;
export type ArticleDestinationUrl = z.infer<typeof ArticleDestinationUrlSchema>;

export function articleFromHostTitle(host: string): string {
	return `Article from ${host}`;
}
export function savedFromHostExcerpt(host: string): string {
	return `Saved from ${host}.`;
}
export function contentSavedFromHostExcerpt(host: string): string {
	return `Content saved from ${host}.`;
}
export function imageSavedFromHostExcerpt(host: string): string {
	return `Image saved from ${host}.`;
}

export interface ArticleLocation {
	url: string;
	displayUrl: string | undefined;
}

export function articleDestinationUrl(article: ArticleLocation): ArticleDestinationUrl {
	return ArticleDestinationUrlSchema.parse(article.displayUrl ?? article.url);
}

export interface ComparableArticle {
	url: string;
	originalUrl?: string | undefined;
	displayUrl?: string | undefined;
	title?: string | undefined;
}

function comparableTitle(title: string | undefined): string {
	return (title ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function comparableDestination(article: ComparableArticle): string {
	return (article.displayUrl ?? article.originalUrl ?? article.url)
		.replace(/^[a-z][a-z\d+.-]*:\/\//i, "")
		.replace(/^www\./i, "")
		.replace(/#.*$/, "")
		.replace(/\/$/, "");
}

export function isSameArticle(pair: { article: ComparableArticle; other: ComparableArticle }): boolean {
	const title = comparableTitle(pair.article.title);
	if (title !== "" && title === comparableTitle(pair.other.title)) return true;
	return comparableDestination(pair.article) === comparableDestination(pair.other);
}

export function articleDestinationHost(destinationUrl: ArticleDestinationUrl): string {
	return new URL(destinationUrl).hostname;
}

interface StoredDisplayMetadata {
	url: string;
	destinationUrl: ArticleDestinationUrl;
	title: string;
	siteName: string;
	excerpt: string;
}

function rehostTitle(params: {
	title: string;
	siteName: string;
	savedHost: string;
	destinationHost: string;
}): string {
	const { title, siteName, savedHost, destinationHost } = params;
	if (title === articleFromHostTitle(savedHost)) return articleFromHostTitle(destinationHost);
	if (title === savedHost && siteName === savedHost) return destinationHost;
	return title;
}

function rehostExcerpt(params: {
	excerpt: string;
	savedHost: string;
	destinationHost: string;
}): string {
	const { excerpt, savedHost, destinationHost } = params;
	if (excerpt === savedFromHostExcerpt(savedHost)) return savedFromHostExcerpt(destinationHost);
	if (excerpt === contentSavedFromHostExcerpt(savedHost)) return contentSavedFromHostExcerpt(destinationHost);
	if (excerpt === imageSavedFromHostExcerpt(savedHost)) return imageSavedFromHostExcerpt(destinationHost);
	return excerpt;
}

export function articleDisplayMetadata(stored: StoredDisplayMetadata): {
	title: string;
	siteName: SiteLabel;
	excerpt: string;
} {
	if (stored.destinationUrl === stored.url) {
		return {
			title: stored.title,
			siteName: SiteLabelSchema.parse(stored.siteName),
			excerpt: stored.excerpt,
		};
	}
	const savedHost = new URL(stored.url).hostname;
	const destinationHost = new URL(stored.destinationUrl).hostname;
	if (savedHost === destinationHost) {
		return {
			title: stored.title,
			siteName: SiteLabelSchema.parse(stored.siteName),
			excerpt: stored.excerpt,
		};
	}
	return {
		title: rehostTitle({ title: stored.title, siteName: stored.siteName, savedHost, destinationHost }),
		siteName: SiteLabelSchema.parse(stored.siteName === savedHost ? destinationHost : stored.siteName),
		excerpt: rehostExcerpt({ excerpt: stored.excerpt, savedHost, destinationHost }),
	};
}

export function articleLinkedDisplay(stored: {
	url: string;
	destinationUrl: ArticleDestinationUrl;
	title: string;
	siteName: string;
}): { title: string; siteName: SiteLabel } {
	const { title, siteName } = articleDisplayMetadata({ ...stored, excerpt: "" });
	return { title, siteName };
}

export function hostStubMetadata(destinationUrl: ArticleDestinationUrl): {
	title: string;
	siteName: SiteLabel;
	excerpt: string;
} {
	const host = new URL(destinationUrl).hostname;
	return { title: host, siteName: SiteLabelSchema.parse(host), excerpt: "" };
}
