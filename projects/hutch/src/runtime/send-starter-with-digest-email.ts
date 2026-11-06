import { initSendStarter } from "./domain/engagement/send-starter";
import { buildDigestPreview } from "./web/digest-preview";
import { QueueDigestEmail } from "./web/queue-digest-email";

export function initSendStarterWithDigestEmail(
	deps: Omit<Parameters<typeof initSendStarter>[0], "renderStarterEmail" | "previewSummary">,
) {
	return initSendStarter({
		...deps,
		renderStarterEmail: (input) => QueueDigestEmail({ kind: "starter", ...input }),
		previewSummary: buildDigestPreview,
	});
}
