import assert from "node:assert";
import type { MediaKindName } from "./media-kinds";
import type { TimedMediaFacts } from "./playable-audio";

export type Meter = "transcript-seconds";

export type TimedFactsRefusal = "unreadable-audio" | "no-audio-track";

type Metering =
	| { meter: Meter; refuseTimedFacts: (facts: TimedMediaFacts) => TimedFactsRefusal | undefined }
	| { meter?: undefined; refuseTimedFacts?: undefined };

export type MediaKindManifest = Readonly<
	{
		name: MediaKindName;
		label: string;
		accepts: Readonly<Record<string, readonly string[]>>;
		uploadCeilingBytes: number;
		ceilingLabel: string;
		sniff: (firstBytes: Uint8Array) => boolean;
		sniffWithoutExtension?: (firstBytes: Uint8Array) => boolean;
		listenTime?: (seconds: number) => number;
	} & Metering
>;

export function defineMediaKind<M extends MediaKindManifest>(manifest: M): Readonly<M> {
	assert(Object.keys(manifest.accepts).length > 0, `${manifest.name} accepts no media type`);
	assert(manifest.uploadCeilingBytes > 0, `${manifest.name} needs a positive upload ceiling`);
	return Object.freeze({ ...manifest });
}
