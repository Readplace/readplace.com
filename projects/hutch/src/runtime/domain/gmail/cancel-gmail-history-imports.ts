import type {
	ForwardableSender,
	GmailHistoryImportCancelReason,
	GmailHistoryImportJob,
	GmailHistoryImportStore,
} from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";

export type CancelGmailHistoryImports = (input: {
	userId: UserId;
	senderEmail: ForwardableSender | undefined;
	reason: GmailHistoryImportCancelReason;
}) => Promise<GmailHistoryImportJob[]>;

export function initCancelGmailHistoryImports(deps: {
	imports: GmailHistoryImportStore;
	now: () => Date;
}): CancelGmailHistoryImports {
	return (input) => deps.imports.cancelJobs({ ...input, now: deps.now() });
}
