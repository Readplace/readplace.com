import type { SirenEntity } from "./siren";

export function toUploadSlotEntity(params: {
	uploadUrl: string;
	expiresAt: Date;
	url: string;
	mediaType: string;
	title?: string;
	completionHref: string;
}): SirenEntity {
	const fields: { name: string; type: string; value: string }[] = [
		{ name: "url", type: "url", value: params.url },
		{ name: "mediaType", type: "text", value: params.mediaType },
	];
	if (params.title !== undefined) fields.push({ name: "title", type: "text", value: params.title });
	fields.push({ name: "uploaded", type: "hidden", value: "true" });

	return {
		class: ["upload-slot"],
		properties: { expiresAt: params.expiresAt.toISOString() },
		actions: [
			{ name: "upload-content", href: params.uploadUrl, method: "PUT", type: params.mediaType },
			{
				name: "save-uploaded-content",
				href: params.completionHref,
				method: "POST",
				type: "multipart/form-data",
				fields,
			},
		],
	};
}
