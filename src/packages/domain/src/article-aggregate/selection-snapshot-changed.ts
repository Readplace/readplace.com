export type SelectionConflict = "selection-changed" | "canonical-content-changed" | "candidate-revoked";

export class SelectionSnapshotChangedError extends Error {
	constructor(readonly conflict: SelectionConflict) {
		super(`the article's content selection changed before this commit landed (${conflict})`);
		this.name = "SelectionSnapshotChangedError";
	}
}
