export type PublishSaveLinkRawPdfCommand = (params: {
	url: string;
	userId: string;
}) => Promise<void>;
