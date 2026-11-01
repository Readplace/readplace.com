const LINKEDIN_HOST = "www.linkedin.com";
const EMAIL_POST_PATH = /^\/comm\/feed\/update\/(?:urn:li:)?(activity|share|ugcPost):(\d+)\/?$/;

export function toLinkedInPostUrl(url: string): string {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return url;
	}
	if (parsed.protocol !== "https:" || parsed.hostname !== LINKEDIN_HOST) return url;
	const match = EMAIL_POST_PATH.exec(parsed.pathname);
	if (match === null) return url;
	const [, type, id] = match;
	return `https://${LINKEDIN_HOST}/feed/update/urn:li:${type}:${id}/`;
}
