// Each value is the line's permanent id on the cost chart: changing one starts a new line; the label a line shows is set where the chart is built.
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
