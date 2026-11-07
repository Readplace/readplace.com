import type { UserDataExportSkipReason } from "@packages/infra-components";
import type { ExportRecipient } from "@packages/provider-contracts/auth";

export type ExportDelivery =
	| { outcome: "refused"; reason: UserDataExportSkipReason }
	| { outcome: "deliver"; email: string };

export function decideExportDelivery(input: {
	recipient: ExportRecipient | null;
	requestedAt: string;
}): ExportDelivery {
	const { recipient, requestedAt } = input;
	if (recipient === null) return { outcome: "refused", reason: "account-gone" };
	if (recipient.deletedAt !== undefined) return { outcome: "refused", reason: "account-deleting" };
	if (recipient.exportDeliveredRequestedAt !== undefined && recipient.exportDeliveredRequestedAt >= requestedAt) {
		return { outcome: "refused", reason: "already-delivered" };
	}
	return { outcome: "deliver", email: recipient.email };
}
