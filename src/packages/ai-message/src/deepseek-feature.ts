export const DEEPSEEK_FEATURES = {
	summary: "summary",
	nextRead: "next_read",
	pastReads: "past_reads",
	readlistPurposeFilter: "readlist_purpose_filter",
	newsletterLinkTriage: "newsletter_link_triage",
	contentSelection: "content_selection",
	pdfExtraction: "pdf_extraction",
} as const;

export type DeepseekFeature = (typeof DEEPSEEK_FEATURES)[keyof typeof DEEPSEEK_FEATURES];
