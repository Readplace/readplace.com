import { isSupportedImageContentType } from "./image-detect";
import { isPDF } from "./pdf-detect";

/**
 * The signals available once the body is materialised: the raw `Content-Type`
 * header (may be empty) and the response bytes (for magic-byte sniffing).
 */
interface MediaTypeSignal {
	contentType: string;
	buffer: Buffer;
}

interface MediaTypeMatcher {
	readonly kind: string;
	readonly matches: (signal: MediaTypeSignal) => boolean;
}

/**
 * The closed set of media types the crawler can turn into article HTML.
 *
 * THIS ARRAY IS THE SINGLE SOURCE OF TRUTH. {@link SupportedMediaType} is
 * derived from it, so adding an entry here is the only edit needed to introduce
 * a media type — and it is impossible to add one without also supplying a
 * detector. The new member then propagates into the type, breaking every
 * exhaustive `switch (mediaType)` that selects a parser until that switch
 * handles it. There is no string
 * fall-through: recognition lives only here.
 *
 * Order is significance order — the PDF magic-byte sniff runs first so a PDF
 * mislabelled `application/octet-stream` wins over the Content-Type checks.
 */
const MEDIA_TYPE_MATCHERS = [
	{ kind: "pdf", matches: ({ contentType, buffer }) => isPDF({ contentType, bodyBytes: buffer }) },
	{
		kind: "html",
		matches: ({ contentType }) =>
			contentType.includes("text/html") || contentType.includes("application/xhtml+xml"),
	},
	{ kind: "plain-text", matches: ({ contentType }) => contentType.includes("text/plain") },
	{ kind: "image", matches: ({ contentType }) => isSupportedImageContentType(contentType) },
] as const satisfies readonly MediaTypeMatcher[];

type SupportedMediaType = (typeof MEDIA_TYPE_MATCHERS)[number]["kind"];

/**
 * Classify a fetched body as the media type the crawler will parse it as, or
 * `undefined` when no supported type matches (the caller flips the row to
 * `unsupported`).
 */
export function classifyMediaType(signal: MediaTypeSignal): SupportedMediaType | undefined {
	for (const matcher of MEDIA_TYPE_MATCHERS) {
		if (matcher.matches(signal)) return matcher.kind;
	}
	return undefined;
}
