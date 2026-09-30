import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, withInternalTracking } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";

import {
	QUEUE_DIGEST_EMAIL_SUBJECT,
	QUEUE_DIGEST_UNSUBSCRIBE_PATH,
	UNSUBSCRIBE_LABEL,
} from "../../queue-digest-email";
import { QUEUE_DIGEST_UNSUBSCRIBE_STYLES } from "./queue-digest-unsubscribe.styles";

const QUEUE_DIGEST_UNSUBSCRIBE_TEMPLATE = readFileSync(
	join(__dirname, "queue-digest-unsubscribe.template.html"),
	"utf-8",
);

export type QueueDigestUnsubscribeState =
	| { kind: "confirm"; token: string }
	| { kind: "done" }
	| { kind: "invalid" };

type QueueDigestUnsubscribeKind = QueueDigestUnsubscribeState["kind"];

const OTHER_EMAILS_CONTINUE = "Emails about your account and billing still arrive.";

const QUEUE_DIGEST_UNSUBSCRIBE_CONTENT: Record<
	QueueDigestUnsubscribeKind,
	{ title: string; body: string; statusCode: number }
> = {
	confirm: {
		title: `${UNSUBSCRIBE_LABEL}?`,
		body: `You'll stop getting "${QUEUE_DIGEST_EMAIL_SUBJECT}". ${OTHER_EMAILS_CONTINUE}`,
		statusCode: 200,
	},
	done: {
		title: "You've stopped these emails",
		body: `Readplace won't send you "${QUEUE_DIGEST_EMAIL_SUBJECT}" again. ${OTHER_EMAILS_CONTINUE}`,
		statusCode: 200,
	},
	invalid: {
		title: "Couldn't read this unsubscribe link",
		body: `The link is incomplete or has been changed. Use the "${UNSUBSCRIBE_LABEL}" link at the bottom of your latest "${QUEUE_DIGEST_EMAIL_SUBJECT}" email.`,
		statusCode: 400,
	},
};

interface ConfirmForm {
	action: string;
	label: string;
}

function confirmFormsFor(state: QueueDigestUnsubscribeState): ConfirmForm[] {
	if (state.kind !== "confirm") return [];
	return [
		{
			action: withInternalTracking(
				`${QUEUE_DIGEST_UNSUBSCRIBE_PATH}?${new URLSearchParams({ t: state.token }).toString()}`,
				{ source: "queue-digest-unsubscribe", content: "confirm" },
			),
			label: UNSUBSCRIBE_LABEL,
		},
	];
}

export function QueueDigestUnsubscribePage(state: QueueDigestUnsubscribeState): PageBody {
	const content = QUEUE_DIGEST_UNSUBSCRIBE_CONTENT[state.kind];
	return {
		seo: {
			title: `${content.title} — Readplace`,
			description: content.body,
			canonicalUrl: QUEUE_DIGEST_UNSUBSCRIBE_PATH,
			robots: "noindex, nofollow",
		},
		styles: QUEUE_DIGEST_UNSUBSCRIBE_STYLES,
		bodyClass: "page-queue-digest-unsubscribe",
		statusCode: content.statusCode,
		content: {
			html: render(QUEUE_DIGEST_UNSUBSCRIBE_TEMPLATE, {
				state: state.kind,
				title: content.title,
				body: content.body,
				forms: confirmFormsFor(state),
			}),
		},
	};
}
