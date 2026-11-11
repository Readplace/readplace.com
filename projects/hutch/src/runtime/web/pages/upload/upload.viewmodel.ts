import { extname } from "node:path";
import { type MediaKindManifest, type MediaKindName, displayMinutes } from "@packages/media-contracts";
import { transcriptAllowanceCopyOf, uploadDescriptionsOf, uploadHeadingOf } from "./upload-copy";

export interface UploadStartViewModel {
	readonly heading: string;
	readonly descriptions: readonly string[];
	readonly viewer: "guest" | "member";
	readonly showsGuestNotice: boolean;
	readonly startPath: string;
	readonly refusalMessage?: string;
	readonly transcriptAllowance?: string;
}

export function kindsForViewer(input: {
	kinds: ReadonlyMap<MediaKindName, MediaKindManifest>;
	guestKinds: readonly MediaKindName[];
	isSignedIn: boolean;
}): MediaKindManifest[] {
	return [...input.kinds.values()].filter(
		(kind) => input.isSignedIn || input.guestKinds.includes(kind.name),
	);
}

export function detectUploadKind(input: {
	kinds: ReadonlyMap<MediaKindName, MediaKindManifest>;
	offered: readonly MediaKindManifest[];
	fileName: string | undefined;
	prefix: Uint8Array;
}): MediaKindManifest | undefined {
	const extension = extname(input.fileName ?? "").toLowerCase();
	const claimsExtension = (kind: MediaKindManifest) =>
		Object.values(kind.accepts).some((extensions) => extensions.includes(extension));
	const declared = [...input.kinds.values()].some(claimsExtension);
	if (declared) return input.offered.find((kind) => claimsExtension(kind) && kind.sniff(input.prefix));
	return input.offered.find((kind) => (kind.sniffWithoutExtension ?? kind.sniff)(input.prefix));
}

export function toUploadStartViewModel(
	kinds: readonly MediaKindManifest[],
	isSignedIn: boolean,
	startPath: string,
): UploadStartViewModel {
	return {
		startPath,
		heading: uploadHeadingOf(kinds),
		descriptions: uploadDescriptionsOf(kinds),
		viewer: isSignedIn ? "member" : "guest",
		showsGuestNotice: !isSignedIn,
	};
}

export function transcriptAllowanceOf(input: {
	kinds: readonly MediaKindManifest[];
	allowanceSeconds: number;
}): string | undefined {
	const metered = input.kinds.filter((kind) => kind.meter !== undefined);
	if (metered.length === 0) return undefined;
	return transcriptAllowanceCopyOf({
		withVideo: metered.some((kind) => kind.name === "video"),
		minutes: displayMinutes(input.allowanceSeconds),
	});
}

export function acceptAttributeOf(kinds: readonly MediaKindManifest[]): string {
	return kinds.flatMap((kind) => Object.values(kind.accepts).flat()).join(",");
}
