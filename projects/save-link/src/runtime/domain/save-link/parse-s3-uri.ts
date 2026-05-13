export function parseS3Uri(uri: string): { bucket: string; key: string } {
	const withoutProtocol = uri.slice("s3://".length);
	const slashIndex = withoutProtocol.indexOf("/");
	return {
		bucket: withoutProtocol.slice(0, slashIndex),
		key: withoutProtocol.slice(slashIndex + 1),
	};
}
