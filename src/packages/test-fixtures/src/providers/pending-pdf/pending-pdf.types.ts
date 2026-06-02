export type PutPendingPdf = (params: {
	url: string;
	bytes: Buffer;
}) => Promise<void>;

export type ReadPendingPdf = (url: string) => Promise<Buffer>;
