type SignaturePart = { offset: number; bytes: Buffer };

type ImageFormat = {
	contentType: string;
	extensions: readonly string[];
	signatures: readonly (readonly SignaturePart[])[];
};

function asciiAt(params: { offset: number; text: string }): SignaturePart {
	return { offset: params.offset, bytes: Buffer.from(params.text, "ascii") };
}

export const IMAGE_FORMATS: readonly ImageFormat[] = [
	{
		contentType: "image/jpeg",
		extensions: [".jpg", ".jpeg"],
		signatures: [[{ offset: 0, bytes: Buffer.from([0xff, 0xd8, 0xff]) }]],
	},
	{
		contentType: "image/png",
		extensions: [".png"],
		signatures: [[{ offset: 0, bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) }]],
	},
	{
		contentType: "image/gif",
		extensions: [".gif"],
		signatures: [[asciiAt({ offset: 0, text: "GIF87a" })], [asciiAt({ offset: 0, text: "GIF89a" })]],
	},
	{
		contentType: "image/webp",
		extensions: [".webp"],
		signatures: [[asciiAt({ offset: 0, text: "RIFF" }), asciiAt({ offset: 8, text: "WEBP" })]],
	},
	{
		contentType: "image/avif",
		extensions: [".avif"],
		signatures: [[asciiAt({ offset: 4, text: "ftypavif" })], [asciiAt({ offset: 4, text: "ftypavis" })]],
	},
	{ contentType: "image/svg+xml", extensions: [".svg"], signatures: [] },
];

function matchesAt(params: { bytes: Buffer; part: SignaturePart }): boolean {
	const { bytes, part } = params;
	return bytes.subarray(part.offset, part.offset + part.bytes.length).equals(part.bytes);
}

export function sniffImageContentType(bytes: Buffer): string | undefined {
	const format = IMAGE_FORMATS.find((candidate) =>
		candidate.signatures.some((signature) => signature.every((part) => matchesAt({ bytes, part }))),
	);
	if (format === undefined) return undefined;
	return format.contentType;
}
