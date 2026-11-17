const NEXTDOOR_HOST = "nextdoor.co.uk";
const POST_PATH = /^\/p\/([^/]+)\/?$/;

export function toNextdoorPostUrl(url: string): string {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return url;
	}
	if (parsed.protocol !== "https:" || parsed.hostname !== NEXTDOOR_HOST || parsed.search === "") return url;
	const match = POST_PATH.exec(parsed.pathname);
	if (match === null) return url;
	const [, id] = match;
	return `https://${NEXTDOOR_HOST}/p/${id}`;
}
