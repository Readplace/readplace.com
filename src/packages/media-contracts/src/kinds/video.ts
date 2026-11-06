import { defineMediaKind, type TimedFactsRefusal } from "../media-kind";
import type { TimedMediaFacts } from "../playable-audio";
import { AUDIO } from "./audio";
import { isIsoBaseMediaFile } from "./iso-base-media-file";

function refuseVideoFacts(facts: TimedMediaFacts): TimedFactsRefusal | undefined {
	if (!facts.hasAudio) return "no-audio-track";
	return facts.durationSeconds >= 1 ? undefined : "unreadable-audio";
}

export const VIDEO = defineMediaKind({
	name: "video",
	label: "Video",
	accepts: { "video/mp4": [".mp4"] },
	uploadCeilingBytes: 2 * 1024 ** 3,
	ceilingLabel: "2 GB",
	sniff: isIsoBaseMediaFile,
	meter: "transcript-seconds",
	listenTime: AUDIO.listenTime,
	refuseTimedFacts: refuseVideoFacts,
});
