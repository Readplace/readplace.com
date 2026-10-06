import sanitizeHtml from "sanitize-html";
import type { Minutes } from "../article/article.types";
import { calculateReadTime } from "../article/estimated-read-time";

const UNTITLED_EMAIL_ISSUE = "(no subject)";

const EXCERPT_MAX_LENGTH = 240;

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

function excerptOf(text: string): string {
	if (text.length <= EXCERPT_MAX_LENGTH) return text;
	const head = text.slice(0, EXCERPT_MAX_LENGTH + 1);
	const lastSpace = head.lastIndexOf(" ");
	return `${head.slice(0, lastSpace > 0 ? lastSpace : EXCERPT_MAX_LENGTH)}…`;
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
		excerpt: excerptOf(text),
		wordCount,
		estimatedReadTime: calculateReadTime(wordCount),
	};
}
