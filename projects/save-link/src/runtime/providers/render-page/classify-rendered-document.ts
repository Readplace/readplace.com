import { hasFastlyChallengeMarkers, isAwsWafChallenge, isBlockClassStatus } from "@packages/crawl-article";
import type { RenderOutcome } from "./render-page.types";

export type RenderedDocument = {
	httpStatus: number;
	headers: Readonly<Record<string, string>>;
	html: string;
	finalUrl: string;
};

export type ClassifyRenderedDocument = (document: RenderedDocument) => RenderOutcome;

const TOO_MANY_REQUESTS = 429;

function toFetchHeaders(headers: Readonly<Record<string, string>>): Headers {
	const fetchHeaders = new Headers();
	for (const [name, joinedValues] of Object.entries(headers)) {
		for (const value of joinedValues.split("\n")) fetchHeaders.append(name, value);
	}
	return fetchHeaders;
}

export const classifyRenderedDocument: ClassifyRenderedDocument = ({ httpStatus, headers, html, finalUrl }) => {
	if (
		isBlockClassStatus(httpStatus) ||
		httpStatus === TOO_MANY_REQUESTS ||
		isAwsWafChallenge({ headers: toFetchHeaders(headers) }) ||
		hasFastlyChallengeMarkers(html)
	) {
		return { kind: "blocked", httpStatus };
	}
	if (httpStatus < 200 || httpStatus > 299) {
		return { kind: "failed", detail: `main document answered HTTP ${httpStatus}`, httpStatus };
	}
	return { kind: "rendered", html, finalUrl, httpStatus };
};
