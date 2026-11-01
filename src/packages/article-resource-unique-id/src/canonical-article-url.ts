import { toAmazonProductUrl } from "./amazon-product-url";
import { equivalentHostUrls, toCanonicalHostUrl } from "./equivalent-hosts";
import { toLinkedInPostUrl } from "./linkedin-email-link";
import { toSubstackPostUrl } from "./substack-comment-view";

export function toCanonicalArticleUrl(url: string): string {
	return toSubstackPostUrl(toLinkedInPostUrl(toAmazonProductUrl(toCanonicalHostUrl(url))));
}

export function equivalentArticleUrls(url: string): readonly string[] {
	const productUrl = toAmazonProductUrl(url);
	return productUrl === url ? equivalentHostUrls(url) : [url, productUrl];
}
