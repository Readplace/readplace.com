export interface HealthSource {
	label: string;
	url: string;
	expectedContent: string;
	forbiddenContent?: readonly string[];
	expectsThumbnail: boolean;
}

export const HEALTH_SOURCES: readonly HealthSource[] = [
	{ // AIA chain — incomplete TLS cert (f9b2f36c)
		label: "Medium (itnext publication)",
		url: "https://itnext.io/youre-not-praised-for-the-bugs-you-didn-t-create-ef3df6894d5c",
		expectedContent: "developers were creating more and more bugs, only to fix them and get the prize",
		expectsThumbnail: true,
	},
	{ // baseline crawl sanity (f9b2f36c)
		label: "Wikipedia (baseline)",
		url: "https://en.wikipedia.org/wiki/Reading",
		expectedContent: "children and adults read because it is enjoyable",
		expectsThumbnail: true,
	},
	{ // newsletter extraction (f9b2f36c)
		label: "Substack",
		url: "https://newsletter.pragmaticengineer.com/p/wrapped-the-pragmatic-engineer-in",
		expectedContent: "Some fundamentals will not change",
		expectsThumbnail: true,
	},
	{ // interactive page Readability (f9b2f36c)
		label: "NYTimes",
		url: "https://www.nytimes.com/projects/2012/snow-fall/index.html",
		expectedContent: "When you’re up on top of a peak like that",
		expectsThumbnail: true,
	},
	{ // repo README extraction (f9b2f36c)
		label: "GitHub",
		url: "https://github.com/js-cookie/js-cookie",
		expectedContent: "All special characters that are not allowed in the cookie-name or cookie-value",
		expectsThumbnail: true,
	},
	{ // abstract page extraction (f9b2f36c)
		label: "arXiv",
		url: "https://arxiv.org/abs/1706.03762",
		expectedContent: "Experiments on two machine translation tasks show these models",
		expectsThumbnail: true,
	},
	{ // multi-article index Readability (f9b2f36c)
		label: "Ars Technica",
		url: "https://arstechnica.com/features/2005/10/linux/",
		expectedContent: "take a gander at The GIMP’s procedure database",
		expectsThumbnail: true,
	},
	{ // Cloudflare TLS fingerprint (f9b2f36c)
		label: "Stack Overflow",
		url: "https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster-than-processing-an-unsorted-array",
		expectedContent: "You are a blind operator of a junction and you hear a train coming",
		expectsThumbnail: true,
	},
	{ // paywall-gated longform (f9b2f36c)
		label: "The New Yorker",
		url: "https://www.newyorker.com/magazine/1946/08/31/hiroshima",
		expectedContent: "Mr. Matsuo dashed up the front steps into the house and dived among the bedrolls and buried himself there",
		expectsThumbnail: true,
	},
	{ // social post extraction (f9b2f36c)
		label: "LinkedIn",
		url: "https://www.linkedin.com/posts/fagnerbrack_ai-webdev-softwareengineering-activity-7429345910167453696-2MJD?utm_source=share&utm_medium=member_desktop&rcm=ACoAAA5sDgUBEQM_1ZyxJFG0-Bvfm4gOYd-wqo4",
		expectedContent: "The issue now is that people realised coding was never the bottleneck",
		expectsThumbnail: true,
	},
	{ // oembed tweet extraction (f9b2f36c)
		label: "X (Twitter)",
		url: "https://x.com/elonmusk/status/1519480761749016577",
		expectedContent: "buying Coca-Cola to put the cocaine back in",
		expectsThumbnail: false,
	},
	{ // /video/<n> URL canonicalisation (c245df93)
		label: "X (Twitter — /video/<n> longhand)",
		url: "https://x.com/AnatoliKopadze/status/2057105488165163198/video/1?s=46",
		expectedContent: "Stanford lecture",
		expectsThumbnail: false,
	},
	{ // plain static HTML baseline (f9b2f36c)
		label: "Static HTML (hex.ooo)",
		url: "https://hex.ooo/library/last_question.html",
		expectedContent: "he had had to carry the ice and glassware",
		expectsThumbnail: false,
	},
	{ // Cloudflare H2 403 fallback (f9b2f36c)
		label: "The Information",
		url: "https://www.theinformation.com/articles/musk-bought-1-4-billion-spacex-shares-helping-boost-control",
		expectedContent: "his stake in SpaceX last year by purchasing $1.4 billion of stock",
		expectsThumbnail: true,
	},
	{ // PDF detection + OCR pipeline (b06f2ff1)
		label: "PDF (FAI airmanship)",
		url: "https://www.fai.org/sites/default/files/documents/airmanship_good.pdf",
		expectedContent: "considerable confusion as to what airmanship actually comprises",
		expectsThumbnail: false,
	},
	{ // dense academic PDF with equations/tables (b415c004)
		label: "PDF (arXiv Transformer paper)",
		url: "https://arxiv.org/pdf/1706.03762v7",
		expectedContent: "Attention Is All You Need",
		expectsThumbnail: false,
	},
	{ // Akamai BotManager TLS fingerprint (aa3f96d7)
		label: "PDF (USDA sample)",
		url: "https://www.rd.usda.gov/sites/default/files/pdf-sample_0.pdf",
		expectedContent: "Dummy PDF file",
		expectsThumbnail: false,
	},
	{ // CIA 302-loop TLS + partial OCR threshold (aa3f96d7)
		label: "PDF (CIA reading room)",
		url: "https://www.cia.gov/readingroom/docs/COMPUTERS%20AND%20AUTOMATION%20[16505689].pdf",
		expectedContent: "Warren Commission",
		expectsThumbnail: false,
	},
	{ // Adobe edge RST_STREAM persona-fallback (3501fb72)
		label: "PDF (Adobe sample)",
		url: "https://www.adobe.com/support/products/enterprise/knowledgecenter/media/c4611_sample_explain.pdf",
		expectedContent: "simple form containing four distinct fields",
		expectsThumbnail: false,
	},
];
