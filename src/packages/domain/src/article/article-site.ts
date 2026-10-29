import { z } from "zod";
import { isNonArticleHost } from "./non-article-host";

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

const DISCUSSIONS = [
	/^news\.ycombinator\.com\/item\?/,
	/^newsletter\.pragmaticengineer\.com\/p\/[^/?]+\/comments(?:\?|$)/,
];
const UNICODE_CHART = /^unicode\.org\/(?:Public\/[^/]+\/)?charts\/PDF\/(U[\dA-F]+)\.pdf$/;

function shareTitleAsDifferentPages(destinations: { destination: string; otherDestination: string }): boolean {
	const { destination, otherDestination } = destinations;
	if (DISCUSSIONS.some((discussion) => discussion.test(destination) || discussion.test(otherDestination))) return true;
	const chart = UNICODE_CHART.exec(destination);
	const otherChart = UNICODE_CHART.exec(otherDestination);
	return chart !== null && otherChart !== null && chart[1] !== otherChart[1];
}

export function isSameArticle(pair: { article: ComparableArticle; other: ComparableArticle }): boolean {
	const destination = comparableDestination(pair.article);
	const otherDestination = comparableDestination(pair.other);
	if (destination === otherDestination) return true;
	if (shareTitleAsDifferentPages({ destination, otherDestination })) return false;
	const title = comparableTitle(pair.article.title);
	return title !== "" && title === comparableTitle(pair.other.title);
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
	wordCount: number;
	imageUrl: string | undefined;
	publishedOn: string | undefined;
}

interface DisplayMetadata {
	title: string;
	siteName: SiteLabel;
	excerpt: string;
	wordCount: number;
	imageUrl?: string;
	publishedOn?: string;
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

export function articleDisplayMetadata(stored: StoredDisplayMetadata): DisplayMetadata {
	if (isNonArticleHost(stored.url)) {
		return { ...hostStubMetadata(stored.destinationUrl), wordCount: 0 };
	}
	return {
		...displayText(stored),
		wordCount: stored.wordCount,
		...(stored.imageUrl === undefined ? {} : { imageUrl: stored.imageUrl }),
		...(stored.publishedOn === undefined ? {} : { publishedOn: stored.publishedOn }),
	};
}

function displayText(stored: StoredDisplayMetadata): {
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
	const { title, siteName } = articleDisplayMetadata({ ...stored, excerpt: "", wordCount: 0, imageUrl: undefined, publishedOn: undefined });
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
