import { EMAIL_CLICK_MEDIUM } from "./events";

export function emailTrackedUrl(input: {
	url: URL | string;
	source: string;
	campaign?: string;
	content: string;
	term?: string;
}): string {
	const tracked = new URL(input.url);
	tracked.searchParams.set("utm_source", input.source);
	tracked.searchParams.set("utm_medium", EMAIL_CLICK_MEDIUM);
	if (input.campaign !== undefined) tracked.searchParams.set("utm_campaign", input.campaign);
	tracked.searchParams.set("utm_content", input.content);
	if (input.term !== undefined) tracked.searchParams.set("utm_term", input.term);
	return tracked.toString();
}
