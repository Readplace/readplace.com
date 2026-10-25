import sanitizeHtml from "sanitize-html";
import type { Minutes } from "../article/article.types";
import { calculateReadTime } from "../article/estimated-read-time";
import { clipMetadataExcerpt } from "../article/metadata-excerpt";

const UNTITLED_EMAIL_ISSUE = "(no subject)";

const BLOCK_TAG =
	/<(\/?)(address|article|aside|blockquote|br|dd|div|dl|dt|figcaption|figure|footer|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|td|th|tr|ul)\b/gi;

const ESCAPED_TEXT: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"' };

interface EmailIssueMetadata {
	title: string;
	siteName: string;
	excerpt: string;
	wordCount: number;
	estimatedReadTime: Minutes;
}

function readableText(html: string): string {
	const text = sanitizeHtml(html.replace(BLOCK_TAG, " <$1$2"), { allowedTags: [], allowedAttributes: {} });
	return text
		.replace(/&(?:amp|lt|gt|quot);/g, (entity) => ESCAPED_TEXT[entity])
		.replace(/\s+/g, " ")
		.trim();
}

export function deriveEmailIssueMetadata(email: {
	subject: string;
	senderEmail: string;
	senderName: string;
	html: string;
}): EmailIssueMetadata {
	const text = readableText(email.html);
	const wordCount = text === "" ? 0 : text.split(" ").length;
	const subject = email.subject.trim();
	const senderName = email.senderName.trim();
	return {
		title: subject === "" ? UNTITLED_EMAIL_ISSUE : subject,
		siteName: senderName === "" ? email.senderEmail : senderName,
		excerpt: clipMetadataExcerpt(text),
		wordCount,
		estimatedReadTime: calculateReadTime(wordCount),
	};
}
