/**
 * The slogans every human-visible surface rotates through, served at
 * `/slogans` so a client can pick up an edit without shipping a new build.
 *
 * That round trip is the whole reason this list is server-owned: the iOS
 * login screen renders it, and an App Store release takes days, so a slogan
 * baked into the app is a slogan that cannot be changed. The web surfaces
 * read the same list to keep one source of truth rather than a second copy
 * that drifts.
 *
 * The first entry is canonical: it is what server-side rendering, a crawler,
 * and a client whose fetch failed all show, so it must stay the slogan the
 * page's `<title>` and structured data already claim.
 */
export const SLOGANS = [
	"The #1 Personal Reading List.",
	"Paste a link. Read it clean.",
	"A warm, dependable place for your reading list.",
	"Your reading list, without the noise.",
	"Your reading universe. Here.",
	"Read what matters",
] as const satisfies readonly string[];

export const CANONICAL_SLOGAN = SLOGANS[0];

/** Bounds a slogan to what the iOS login screen renders on one line. */
export const MAX_SLOGAN_LENGTH = 48;
