interface UserAgentParts {
	appVersion: string;
	chromeVersion: string;
}

/**
 * Internet Reader's own user agent for live browsing in the embedded webview.
 * It keeps a Chrome token so origins serve standard desktop markup, but
 * identifies the product as InternetReader. Reader-mode extraction does not use
 * this — it fetches under Readplace's crawl personas, which exist to get past
 * Cloudflare/Fastly edge sniffers.
 */
export function internetReaderUserAgent(parts: UserAgentParts): string {
	return [
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
		"AppleWebKit/537.36 (KHTML, like Gecko)",
		`InternetReader/${parts.appVersion}`,
		`Chrome/${parts.chromeVersion} Safari/537.36`,
	].join(" ");
}
