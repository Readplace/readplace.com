import type { InboxAddress, InboxAddressEntry, ParsedEmail } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";
import { findGoogleForwardingConfirmationUrl } from "./google-confirmation-link";

export interface InterceptionRecipient {
	recipientAddress: InboxAddress;
	resolved: InboxAddressEntry | undefined;
	userId: UserId;
}

export type InterceptGmailConfirmation = (input: {
	email: ParsedEmail;
	resolvedRecipients: readonly InterceptionRecipient[];
}) => Promise<boolean>;

export function initInterceptGmailConfirmation(deps: {
	publishConfirmGmailForwarding: (detail: {
		userId: UserId;
		forwardingAddress: InboxAddress;
		verifyUrl: string;
	}) => Promise<void>;
	logger: HutchLogger;
}): InterceptGmailConfirmation {
	const { publishConfirmGmailForwarding, logger } = deps;

	return async ({ email, resolvedRecipients }) => {
		const verifyUrl = findGoogleForwardingConfirmationUrl(email);
		if (verifyUrl === undefined) return false;
		if (resolvedRecipients.length !== 1) {
			logger.warn("[intercept-gmail-confirmation] co-addressed confirmation left to normal flow", {
				recipientCount: resolvedRecipients.length,
			});
			return false;
		}
		const { recipientAddress, resolved } = resolvedRecipients[0];
		if (
			resolved === undefined ||
			resolved.disabledAt !== undefined ||
			resolved.purpose !== "gmail-forwarding"
		) {
			logger.warn(
				"[intercept-gmail-confirmation] confirmation not addressed to a live gateway address",
				{ recipientAddress },
			);
			return false;
		}
		await publishConfirmGmailForwarding({
			userId: resolved.userId,
			forwardingAddress: recipientAddress,
			verifyUrl,
		});
		logger.info("[intercept-gmail-confirmation] confirmation dispatched", { recipientAddress });
		return true;
	};
}
