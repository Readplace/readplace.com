export interface DemoVideo {
	sources: { src: string; type: string }[];
	poster: string;
	width: number;
	height: number;
}

export function buildDemoVideo(
	asset: { h264: string; poster: string; width: number; height: number },
	staticBaseUrl: string,
): DemoVideo {
	return {
		sources: [{ src: `${staticBaseUrl}${asset.h264}`, type: "video/mp4" }],
		poster: `${staticBaseUrl}${asset.poster}`,
		width: asset.width,
		height: asset.height,
	};
}
