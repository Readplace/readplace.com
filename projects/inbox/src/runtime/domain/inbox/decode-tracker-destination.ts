import { parseHttpUrl } from "@packages/domain/inbox";

const PLAIN_URL = /^https?:\/\//i;
const BASE64_TOKEN = /^[A-Za-z0-9_\-+/=]{12,}$/;
const EMBEDDED_URL = /https?(?::|%3A)(?:\/\/|%2F%2F)[^\s"'<>\\]+/i;

function percentDecode(value: string): string | undefined {
	try {
		return decodeURIComponent(value);
	} catch {
		return undefined;
	}
}

function rawCandidates(url: URL): string[] {
	const segments = url.pathname.split("/");
	const queryValues = url.search
		.slice(1)
		.split("&")
		.map((pair) => pair.slice(pair.indexOf("=") + 1));
	return [...segments, ...queryValues];
}

function plainDestination(candidate: string): string | undefined {
	const decoded = percentDecode(candidate);
	return decoded !== undefined && PLAIN_URL.test(decoded) ? decoded : undefined;
}

function base64Destinations(candidate: string): string[] {
	return [candidate, ...candidate.split(".")]
		.filter((part) => BASE64_TOKEN.test(part))
		.flatMap((part) => {
			const match = Buffer.from(part, "base64").toString("utf8").match(EMBEDDED_URL);
			const decoded = match === null ? undefined : percentDecode(match[0]);
			return decoded === undefined ? [] : [decoded];
		});
}

export function decodeTrackerDestination(url: string): string | undefined {
	const tracker = parseHttpUrl(url);
	if (tracker === undefined) return undefined;
	for (const candidate of rawCandidates(tracker)) {
		const plain = plainDestination(candidate);
		for (const destination of plain === undefined ? base64Destinations(candidate) : [plain]) {
			const parsed = parseHttpUrl(destination);
			if (parsed !== undefined && parsed.hostname !== tracker.hostname) return parsed.href;
		}
	}
	return undefined;
}
