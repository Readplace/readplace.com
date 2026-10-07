import assert from "node:assert/strict";
import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { SaveAttemptIdSchema } from "@packages/domain/article";
import { initPutRefreshHtml } from "./put-refresh-html";

type SendFn = S3Client["send"];

describe("initPutRefreshHtml", () => {
	it("stages the reader HTML and the raw evaluation HTML under their own attempt-scoped keys", async () => {
		const puts: PutObjectCommand["input"][] = [];
		const send = async (command: unknown) => {
			assert(command instanceof PutObjectCommand);
			puts.push(command.input);
			return {};
		};
		const { putRefreshHtml } = initPutRefreshHtml({
			client: { send: send as unknown as SendFn },
			bucketName: "refresh-bucket",
		});
		const url = "https://example.com/article";
		const saveAttemptId = SaveAttemptIdSchema.parse("attempt-a");
		const id = ArticleResourceUniqueId.parse(url);

		await putRefreshHtml({
			url,
			saveAttemptId,
			html: "<p>Reader HTML</p>",
			evaluationHtml: "<html><body>Raw response</body></html>",
		});

		expect(puts).toEqual([
			{
				Bucket: "refresh-bucket",
				Key: id.toS3RefreshHtmlKey(saveAttemptId),
				Body: "<p>Reader HTML</p>",
				ContentType: "text/html; charset=utf-8",
			},
			{
				Bucket: "refresh-bucket",
				Key: id.toS3RefreshEvaluationHtmlKey(saveAttemptId),
				Body: "<html><body>Raw response</body></html>",
				ContentType: "text/html; charset=utf-8",
			},
		]);
	});
});
