export type PutPendingHtml = (params: {
	url: string;
	html: string;
}) => Promise<void>;
