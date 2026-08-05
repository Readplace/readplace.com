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

/** The provider answered and refused the message, so it was definitively not
 * delivered and a retry cannot duplicate it. A transport failure — where the
 * provider may or may not have accepted the message — must stay an ordinary
 * `Error`, because the caller treats these two cases opposite ways. */
export class EmailRejectedError extends Error {
	readonly statusCode: number;

	constructor(params: { statusCode: number; message: string }) {
		super(params.message);
		this.statusCode = params.statusCode;
		this.name = "EmailRejectedError";
	}
}
