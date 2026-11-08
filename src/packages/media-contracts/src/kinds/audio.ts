import { defineMediaKind } from "../media-kind";
import { isPlayableAudio } from "../playable-audio";

const ID3_TAG = Buffer.from("ID3", "ascii");
const FTYP_BOX = Buffer.from("ftyp", "ascii");
const FTYP_OFFSET = 4;
const AUDIO_ONLY_BRANDS: readonly string[] = ["M4A ", "M4B "];
const M4A_BRANDS: readonly string[] = [...AUDIO_ONLY_BRANDS, "mp42", "isom"];
const SECONDS_PER_MINUTE = 60;

function listenMinutes(seconds: number): number {
	return Math.ceil(seconds / SECONDS_PER_MINUTE);
}

function startsWithId3(bytes: Buffer): boolean {
	return bytes.subarray(0, ID3_TAG.length).equals(ID3_TAG);
}

function startsWithMpegFrameSync(bytes: Buffer): boolean {
	return (
		bytes.length >= 2 &&
		bytes.readUInt8(0) === 0xff &&
		(bytes.readUInt8(1) & 0xe0) === 0xe0
	);
}

function startsWithFtypBoxOf(bytes: Buffer, brands: readonly string[]): boolean {
	const brandStart = FTYP_OFFSET + FTYP_BOX.length;
	return (
		bytes.subarray(FTYP_OFFSET, brandStart).equals(FTYP_BOX) &&
		brands.includes(bytes.subarray(brandStart, brandStart + 4).toString("latin1"))
	);
}

function sniffAudioOf(brands: readonly string[]): (firstBytes: Uint8Array) => boolean {
	return (firstBytes) => {
		const bytes = Buffer.from(firstBytes);
		return startsWithId3(bytes) || startsWithMpegFrameSync(bytes) || startsWithFtypBoxOf(bytes, brands);
	};
}

export const AUDIO = defineMediaKind({
	name: "audio",
	label: "Audio",
	accepts: { "audio/mpeg": [".mp3"], "audio/mp4": [".m4a"] },
	uploadCeilingBytes: 256 * 1024 * 1024,
	ceilingLabel: "256 MB",
	meter: "transcript-seconds",
	listenTime: listenMinutes,
	refuseTimedFacts: (facts) => (isPlayableAudio(facts) ? undefined : "unreadable-audio"),
	sniff: sniffAudioOf(M4A_BRANDS),
	sniffWithoutExtension: sniffAudioOf(AUDIO_ONLY_BRANDS),
});
