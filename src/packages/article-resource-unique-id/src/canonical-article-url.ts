import { toAmazonProductUrl } from "./amazon-product-url";
import { equivalentHostUrls, toCanonicalHostUrl } from "./equivalent-hosts";
import { toLinkedInPostUrl } from "./linkedin-email-link";
import { withoutPersonalLinkParams } from "./personal-link-params";
import { toSubstackPostUrl } from "./substack-comment-view";

export function toCanonicalArticleUrl(url: string): string {
	return toSubstackPostUrl(toLinkedInPostUrl(toAmazonProductUrl(withoutPersonalLinkParams(toCanonicalHostUrl(url)))));
}

export function equivalentArticleUrls(url: string): readonly string[] {
	const cleanUrl = toAmazonProductUrl(withoutPersonalLinkParams(url));
	return cleanUrl === url ? equivalentHostUrls(url) : [url, ...equivalentHostUrls(cleanUrl)];
}
