import type { NativeClientPlatform } from "../onboarding/native-client";

interface ShareDemoAsset {
	h264: string;
	poster: string;
	width: number;
	height: number;
}

const DEMO_ASSETS = {
	ios: {
		h264: "/videos/ios-share-demo-h264.mp4",
		poster: "/videos/ios-share-demo-poster.webp",
		width: 540,
		height: 1174,
	},
	android: {
		h264: "/videos/android-share-demo-h264.mp4",
		poster: "/videos/android-share-demo-poster.webp",
		width: 540,
		height: 1212,
	},
} as const satisfies Record<NativeClientPlatform, ShareDemoAsset>;

export interface ShareDemoSource {
	src: string;
	type: string;
}

export interface ShareDemoVideo {
	sources: ShareDemoSource[];
	poster: string;
	width: number;
	height: number;
}

export function buildShareDemoVideo(
	platform: NativeClientPlatform,
	staticBaseUrl: string,
): ShareDemoVideo {
	const asset = DEMO_ASSETS[platform];
	return {
		sources: [{ src: `${staticBaseUrl}${asset.h264}`, type: "video/mp4" }],
		poster: `${staticBaseUrl}${asset.poster}`,
		width: asset.width,
		height: asset.height,
	};
}
