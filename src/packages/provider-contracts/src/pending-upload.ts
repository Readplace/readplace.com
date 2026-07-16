export type CreateUploadSlot = (params: {
	url: string;
	mediaType: string;
	byteLength: number;
}) => Promise<{ uploadUrl: string; expiresAt: Date }>;

export type StatPendingUpload = (params: {
	url: string;
	mediaType: string;
}) => Promise<{ byteLength: number; lastModified: Date } | undefined>;

export type ReadPendingUploadPrefix = (params: {
	url: string;
	mediaType: string;
	bytes: number;
}) => Promise<Buffer>;
