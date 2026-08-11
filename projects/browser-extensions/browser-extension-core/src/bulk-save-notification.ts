import type { GuardedResult } from "./auth/auth.types";
import { summarizeBulkSave } from "./popup/save-all-tabs";
import type { BulkSaveResult } from "./reading-list/reading-list.types";

export const BULK_SAVE_FAILED_TITLE = "Couldn't save tabs";
export const BULK_SAVE_FAILED_MESSAGE = "Something went wrong. Please try again.";

export function bulkSaveNotification(params: {
	outcome: GuardedResult<BulkSaveResult>;
	tabCount: number;
	saveableCount: number;
}): { title: string; message: string } {
	if (!params.outcome.ok) {
		if (params.outcome.reason === "not-logged-in") {
			return {
				title: "Not signed in",
				message: "Sign in to Readplace to save your tabs.",
			};
		}
		return { title: BULK_SAVE_FAILED_TITLE, message: BULK_SAVE_FAILED_MESSAGE };
	}
	const { title, summary, tooBig } = summarizeBulkSave({
		result: params.outcome.value,
		tabCount: params.tabCount,
		saveableCount: params.saveableCount,
	});
	const lines = [summary];
	if (tooBig !== null) lines.push(tooBig);
	if (params.outcome.value.unauthorized) lines.push("Sign in to Readplace to save the rest.");
	return { title, message: lines.join("\n") };
}
