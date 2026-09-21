import {
	type ArticleDestinationUrl,
	type SiteLabel,
	articleDestinationUrl,
	articleDisplayMetadata,
} from "@packages/domain/article";

const FIXTURE_URL = "https://fixture.test/article";
const FIXTURE_DESTINATION = articleDestinationUrl({ url: FIXTURE_URL, displayUrl: undefined });

export function siteLabel(name: string): SiteLabel {
	return articleDisplayMetadata({
		url: FIXTURE_URL,
		destinationUrl: FIXTURE_DESTINATION,
		title: "",
		siteName: name,
		excerpt: "",
	}).siteName;
}

export function destinationUrl(url: string): ArticleDestinationUrl {
	return articleDestinationUrl({ url, displayUrl: undefined });
}
