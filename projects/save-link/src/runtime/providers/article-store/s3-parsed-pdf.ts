import { GetObjectCommand, PutObjectCommand, S3ServiceException, type S3Client } from "@aws-sdk/client-s3";
import type { UserId } from "@packages/article-state-types";
import { z } from "zod";
import type { FindParsedPdf, KeepParsedPdf } from "../../domain/article-parser/parsed-pdf.types";

const StoredParsedPdfSchema = z.object({ html: z.string(), title: z.string() });

const StoredBodySchema = z.string().transform((text, context) => {
	try {
		return JSON.parse(text);
	} catch {
		context.addIssue({ code: "custom", message: "stored parse is not JSON" });
		return z.NEVER;
	}
}).pipe(StoredParsedPdfSchema);

function parsedPdfKey(key: { userId: UserId; fileHash: string }): string {
	return `pdf-extract/account/${key.userId}/${key.fileHash}.json`;
}

export function initS3ParsedPdf(deps: {
	client: Pick<S3Client, "send">;
	bucketName: string;
}): { findParsedPdf: FindParsedPdf; keepParsedPdf: KeepParsedPdf } {
	const { client, bucketName } = deps;

	const findParsedPdf: FindParsedPdf = async (key) => {
		let body: string;
		try {
			const response = await client.send(new GetObjectCommand({ Bucket: bucketName, Key: parsedPdfKey(key) }));
			if (!response.Body) return undefined;
			body = await response.Body.transformToString("utf-8");
		} catch (error) {
			if (error instanceof S3ServiceException && error.name === "NoSuchKey") return undefined;
			throw error;
		}
		const parsed = StoredBodySchema.safeParse(body);
		if (!parsed.success) return undefined;
		return parsed.data;
	};

	const keepParsedPdf: KeepParsedPdf = async (parse) => {
		await client.send(new PutObjectCommand({
			Bucket: bucketName,
			Key: parsedPdfKey(parse),
			Body: JSON.stringify({ html: parse.html, title: parse.title }),
			ContentType: "application/json; charset=utf-8",
		}));
	};

	return { findParsedPdf, keepParsedPdf };
}
