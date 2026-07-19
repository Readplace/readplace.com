export type SavePhase = "capturing" | "uploading";

export type SaveProgress = {
	widthFor: (phase: SavePhase) => string;
	labelFor: (phase: SavePhase) => string;
};

export function initSaveProgress(): SaveProgress {
	const widths: Record<SavePhase, string> = {
		capturing: "40%",
		uploading: "75%",
	};
	const labels: Record<SavePhase, string> = {
		capturing: "Reading page…",
		uploading: "Saving…",
	};
	return {
		widthFor: (phase) => widths[phase],
		labelFor: (phase) => labels[phase],
	};
}
