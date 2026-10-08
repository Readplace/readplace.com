export const COMPARISON_COMPLETED = "[ArchiveSaveAttempt] comparison completed";

const OWN_CAPTURE_FAILED_TERMS = [COMPARISON_COMPLETED, '"ownCaptureFailed":true'];

export const OWN_CAPTURE_FAILED_METRIC = {
	namespace: "Readplace/SaveLink",
	name: "SelectContentOwnCaptureFailed",
	terms: OWN_CAPTURE_FAILED_TERMS,
	filterPattern: OWN_CAPTURE_FAILED_TERMS.map((term) => JSON.stringify(term)).join(" "),
};
