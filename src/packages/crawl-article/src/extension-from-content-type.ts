import { IMAGE_FORMATS } from "./image-formats";

export function extensionFromContentType(params: { contentType: string; url: string }): string {
	const { contentType, url } = params;
	const mimeBase = contentType.split(";")[0].trim().toLowerCase();
	const formatExtension = IMAGE_FORMATS.find((format) => format.contentType === mimeBase)?.extensions[0];
	if (formatExtension) return formatExtension;
	try {
		const pathname = new URL(url).pathname;
		const match = pathname.match(/\.([a-z0-9]{2,5})$/i);
		if (match) return `.${match[1].toLowerCase()}`;
	} catch {
		// malformed URL
	}
	return ".bin";
}
