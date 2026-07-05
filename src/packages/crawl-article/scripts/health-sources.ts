/**
 * Labelled source list exercised by the tier-1-plus pipeline-health canary.
 *
 * Keep the list diverse — one entry per edge-sniffing vendor we care about.
 * Failures surface the `label` in the GitHub Actions UI, not a URL.
 *
 * A canary failure is a real failure: the crawler must handle TLS-fingerprint
 * blocks (e.g. Stack Overflow via Cloudflare) so production traffic still
 * reaches the origin. Fix the crawler before touching this list.
 *
 * `expectsThumbnail` asserts the thumbnail download path: `true` means the
 * source has an og:image/twitter:image that must fetch successfully under
 * the same H2-fallback path as the article HTML, `false` means the source
 * legitimately has no thumbnail (e.g. X/Twitter via oembed returns synthetic
 * HTML with no meta tags).
 */
export interface HealthSource {
	label: string;
	url: string;
	expectedContent: string;
	/** Substrings that MUST NOT appear in the parsed HTML — surfaces parser regressions where site chrome leaks into the article body (e.g. Medium byline, read-time, publish-date, "Press enter…" tooltip). */
	forbiddenContent?: readonly string[];
	expectsThumbnail: boolean;
}

export const HEALTH_SOURCES: readonly HealthSource[] = [
	{
		// Medium publications (e.g. itnext.io) serve an incomplete TLS chain —
		// leaf cert without the Sectigo intermediate. Node's fetch fails with
		// UNABLE_TO_VERIFY_LEAF_SIGNATURE. AIA chasing recovers
		// by fetching the intermediate from the leaf cert's AIA URL.
		label: "Medium (itnext publication)",
		url: "https://fagnerbrack.com/youre-not-praised-for-the-bugs-you-didn-t-create-ef3df6894d5c",
		expectedContent: "developers were creating more and more bugs, only to fix them and get the prize",
		expectsThumbnail: true,
	},
	{
		label: "Wikipedia (baseline)",
		url: "https://en.wikipedia.org/wiki/Reading",
		expectedContent: "children and adults read because it is enjoyable",
		expectsThumbnail: true,
	},
	{
		label: "Substack",
		url: "https://newsletter.pragmaticengineer.com/p/wrapped-the-pragmatic-engineer-in",
		expectedContent: "Some fundamentals will not change",
		expectsThumbnail: true,
	},
	{
		// expectedContent is picked from Readability's parsed output (not the
		// raw HTML) so the tier-1+ canary's substring check survives the parser.
		// The "funnel / twisting gorge" passage exists in the raw HTML but does
		// not land in what Readability extracts for this interactive page.
		label: "NYTimes",
		url: "https://www.nytimes.com/projects/2012/snow-fall/index.html",
		expectedContent: "When you’re up on top of a peak like that",
		expectsThumbnail: true,
	},
	{
		label: "GitHub",
		url: "https://github.com/js-cookie/js-cookie",
		expectedContent: "All special characters that are not allowed in the cookie-name or cookie-value",
		expectsThumbnail: true,
	},
	{
		label: "arXiv",
		url: "https://arxiv.org/abs/1706.03762",
		expectedContent: "Experiments on two machine translation tasks show these models",
		expectsThumbnail: true,
	},
	{
		// The Ars Technica "linux features" URL is an index of multiple short
		// articles. Readability deterministically extracts one of them
		// ("Monitoring network traffic with Ruby and Pcap"); expectedContent
		// targets a distinctive substring inside that extraction.
		label: "Ars Technica",
		url: "https://arstechnica.com/features/2005/10/linux/",
		expectedContent: "take a gander at The GIMP’s procedure database",
		expectsThumbnail: true,
	},
	{
		label: "Stack Overflow",
		url: "https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster-than-processing-an-unsorted-array",
		expectedContent: "You are a blind operator of a junction and you hear a train coming",
		expectsThumbnail: true,
	},
	{
		label: "The New Yorker",
		url: "https://www.newyorker.com/magazine/1946/08/31/hiroshima",
		expectedContent: "Mr. Matsuo dashed up the front steps into the house and dived among the bedrolls and buried himself there",
		expectsThumbnail: true,
	},
	{
		// LinkedIn's logged-out post page renders the whole body inside one
		// `white-space: pre-wrap` element with `\n\n` paragraph breaks (no
		// `<br>`, no block markup). `linkedinSiteRules` rebuilds those into
		// <p> blocks before Readability; without it the post collapses into a
		// single run-on paragraph. forbiddenContent is the cross-paragraph
		// `\n\n` run-on — present only when that paragraph split has regressed,
		// so it asserts the structure was rebuilt, not just that the text exists.
		label: "LinkedIn",
		url: "https://www.linkedin.com/posts/fagnerbrack_ai-webdev-softwareengineering-activity-7429345910167453696-2MJD?utm_source=share&utm_medium=member_desktop&rcm=ACoAAA5sDgUBEQM_1ZyxJFG0-Bvfm4gOYd-wqo4",
		expectedContent: "The issue now is that people realised coding was never the bottleneck",
		forbiddenContent: ["dev positions:\n\n1."],
		expectsThumbnail: true,
	},
	{
		label: "X (Twitter)",
		url: "https://x.com/elonmusk/status/1519480761749016577",
		expectedContent: "buying Coca-Cola to put the cocaine back in",
		expectsThumbnail: false,
	},
	{
		// Tweet URLs with a `/video/<n>` or `/photo/<n>` sub-path 404 against
		// Twitter's oembed endpoint. The crawler canonicalises to the bare
		// `<handle>/status/<id>` form so this longhand URL still resolves.
		label: "X (Twitter — /video/<n> longhand)",
		url: "https://x.com/AnatoliKopadze/status/2057105488165163198/video/1?s=46",
		expectedContent: "Stanford lecture",
		expectsThumbnail: false,
	},
	{
		label: "Static HTML (hex.ooo)",
		url: "https://hex.ooo/library/last_question.html",
		expectedContent: "he had had to carry the ice and glassware",
		expectsThumbnail: false,
	},
	// PDF sources run last and are ordered cheapest-first: each one fans out
	// per-page OCR (rasterisation + DeepInfra vision) and burns real tokens, so
	// the tier-1-plus canary's fail-fast gate skips every remaining PDF once any
	// earlier source has failed. Keeping the slowest PDFs (CIA, Adobe) at the
	// very end means a quick-link regression never pays for the most expensive
	// OCR runs. Reorder within this block by observed duration, not vendor.
	{
		// Akamai BotManager blocks standard curl's TLS fingerprint with HTTP/2
		// RST_STREAM (exit 92). curl-impersonate's Chrome ClientHello bypasses
		// this without a proxy — the discriminator is the TLS handshake, not the
		// source IP.
		//
		// PDFs do not expose og:image/twitter:image metadata, so the thumbnail
		// path is intentionally skipped — same precedent as the X/Twitter
		// oembed entry above. A single-page dummy PDF, so it is the cheapest OCR
		// run and leads the block.
		label: "PDF (USDA sample)",
		url: "https://www.rd.usda.gov/sites/default/files/pdf-sample_0.pdf",
		expectedContent: "Dummy PDF file",
		expectsThumbnail: false,
	},
	{
		// Second PDF entry — a technical paper with equations, multi-column
		// layout, tables, and figure captions. Exercises the vision model's
		// structural inference on dense academic typography (Attention Is All
		// You Need by Vaswani et al., 2017). Catches regressions where the
		// vision pipeline degrades on structured content.
		label: "PDF (arXiv Transformer paper)",
		url: "https://arxiv.org/pdf/1706.03762v7",
		expectedContent: "Attention Is All You Need",
		expectsThumbnail: false,
	},
	{
		// Exercises the PDF path end-to-end: detection + per-page OCR Lambda
		// fan-out (rasterisation + DeepInfra vision) + sanitizer + Readability
		// over the synthetic HTML. fai.org serves the file with Content-Type
		// `application/pdf`.
		label: "PDF (FAI airmanship)",
		url: "https://www.fai.org/sites/default/files/documents/airmanship_good.pdf",
		expectedContent: "considerable confusion as to what airmanship actually comprises",
		expectsThumbnail: false,
	},
	{
		// Adobe-class fingerprint-strict origin. Sent today's partial Chrome
		// headers and Adobe's edge RSTs the h2 stream (curl exit 92,
		// INTERNAL_ERROR). Either a coherent full-Chrome persona or the
		// `honest-bot` persona pass. If this entry fails, the persona-fallback
		// chain has lost both — investigate the chain before touching this URL.
		//
		// expectedContent anchors on page-1 prose ("four distinct fields")
		// rather than the bullet-point text ("bookmarks in a PDF file") that
		// the HTML-conversion LLM can restructure non-deterministically.
		label: "PDF (Adobe sample)",
		url: "https://www.adobe.com/support/products/enterprise/knowledgecenter/media/c4611_sample_explain.pdf",
		expectedContent: "simple form containing four distinct fields",
		expectsThumbnail: false,
	},
	{
		// CIA reading-room 302-loops AWS IPs to /readingroom when the TLS
		// fingerprint looks non-browser (curl exit 47). curl-impersonate with
		// Chrome fingerprint returns 200 directly. Exercises --globoff +
		// WHATWG URL re-encoding via the bracketed path segment `[16505689]`.
		// Pages 22–25 of this 31-page scan are image-heavy and individually
		// defeat DeepInfra's 360s SDK budget; the OCR pipeline's partial-
		// success threshold accepts the remaining 27/31
		// pages (0.871) and renders placeholders for the rest.
		// `expectedContent` appears on pages 1, 2, 3, 5, 6, 18, 21, 28, 30,
		// 31, all outside the known-flaky range — confirmed via
		// `pdftotext -f N -l N` against the staged source PDF.
		//
		// The slowest and most token-hungry entry (31 scanned pages), so it
		// sits last: nothing more expensive runs after it.
		label: "PDF (CIA reading room)",
		url: "https://www.cia.gov/readingroom/docs/COMPUTERS%20AND%20AUTOMATION%20[16505689].pdf",
		expectedContent: "Warren Commission",
		expectsThumbnail: false,
	},
];
