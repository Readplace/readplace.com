export type ContentBodyBuilder = (input: Record<string, string>) => { blob: Blob; filename: string };

function assert(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
	const binaryString = atob(base64);
	const bytes = new Uint8Array(binaryString.length);
	for (let i = 0; i < binaryString.length; i += 1) {
		bytes[i] = binaryString.charCodeAt(i);
	}
	return bytes;
}

export const pdfContentBody: ContentBodyBuilder = (input) => {
	assert(input.contentBase64, "PDF content body requires contentBase64");
	const bytes = base64ToBytes(input.contentBase64);
	return { blob: new Blob([bytes], { type: input.mediaType }), filename: "content" };
};

export const htmlContentBody: ContentBodyBuilder = (input) => {
	assert(input.contentBase64, "HTML content body requires contentBase64");
	const bytes = base64ToBytes(input.contentBase64);
	return { blob: new Blob([bytes], { type: "text/html" }), filename: "content.html" };
};
