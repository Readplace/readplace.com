export type AudioFailure = "staged-bytes-gone" | "unreadable" | "processing-exhausted";

export const AUDIO_FAILURE_NOTICES: Record<AudioFailure, string> = {
	"staged-bytes-gone": "We couldn't find the file you uploaded. Please upload it again.",
	unreadable: "We couldn't read this audio file. Upload an MP3 or M4A that plays on your device.",
	"processing-exhausted": "We couldn't prepare this audio file. Please upload it again.",
};
