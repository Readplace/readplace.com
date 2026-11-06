import type { MediaKindManifest, MediaKindName } from "@packages/media-contracts";
import { uploadDescriptionsOf, uploadHeadingOf } from "./upload-copy";

export interface UploadStartViewModel {
	readonly heading: string;
	readonly descriptions: readonly string[];
	readonly viewer: "guest" | "member";
	readonly showsGuestNotice: boolean;
	readonly startPath: string;
	readonly refusalMessage?: string;
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

export function acceptAttributeOf(kinds: readonly MediaKindManifest[]): string {
	return kinds.flatMap((kind) => Object.values(kind.accepts).flat()).join(",");
}
