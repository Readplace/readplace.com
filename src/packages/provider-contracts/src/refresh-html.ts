export type PutRefreshHtml = (params: {
	url: string;
	html: string;
}) => Promise<void>;

export type ReadRefreshHtml = (url: string) => Promise<string>;
