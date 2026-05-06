export interface EmailMessage {
	from: string;
	to: string;
	bcc?: string;
	replyTo?: string;
	subject: string;
	html: string;
	text?: string;
}

export type SendEmail = (message: EmailMessage) => Promise<void>;
