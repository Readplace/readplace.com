export type PutImageObject = (params: {
	key: string;
	body: Buffer;
	contentType: string;
}) => Promise<void>;
