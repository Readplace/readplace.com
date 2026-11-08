import { type GetObjectCommand, type S3Client, S3ServiceException } from "@aws-sdk/client-s3";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { SaveAttemptIdSchema } from "@packages/domain/article";
import { initReadRefreshHtml } from "./read-refresh-html";

const URL = "https://example.com/post";
const saveAttemptId = SaveAttemptIdSchema.parse("attempt");
const id = ArticleResourceUniqueId.parse(URL);

function setup() {
	const objects: Record<string, string> = {
		[id.toS3RefreshHtmlKey(saveAttemptId)]: "<p>Article</p>",
		[id.toS3RefreshEvaluationHtmlKey(saveAttemptId)]: "<html>Raw response</html>",
	};
	const client = { send: async (command: GetObjectCommand) => {
		expect(command.input.Bucket).toBe("pending");
		return { Body: { transformToString: async () => objects[String(command.input.Key)] } };
	} } as unknown as Pick<S3Client, "send">;
	return initReadRefreshHtml({ client, bucketName: "pending" });
}

describe("readRefreshHtml", () => {
	it("reads the staged article body for the save attempt", async () => {
		expect(await setup().readRefreshHtml(URL, { saveAttemptId })).toBe("<p>Article</p>");
	});

	it("reads the raw response staged for evaluation", async () => {
		expect(await setup().readRefreshHtml(URL, { saveAttemptId, representation: "evaluation" })).toBe("<html>Raw response</html>");
	});

	it("answers undefined once the staged object has expired", async () => {
		const client = { send: async () => {
			throw new S3ServiceException({ name: "NoSuchKey", $fault: "client", $metadata: {}, message: "The specified key does not exist." });
		} } as unknown as Pick<S3Client, "send">;

		expect(await initReadRefreshHtml({ client, bucketName: "pending" }).readRefreshHtml(URL, { saveAttemptId })).toBeUndefined();
	});

	it.each([
		["an S3 throttle", new S3ServiceException({ name: "SlowDown", $fault: "server", $metadata: {}, message: "Please reduce your request rate." })],
		["a generic error", new Error("socket hang up")],
	])("rethrows %s", async (_label, error) => {
		const client = { send: async () => {
			throw error;
		} } as unknown as Pick<S3Client, "send">;

		await expect(initReadRefreshHtml({ client, bucketName: "pending" }).readRefreshHtml(URL, { saveAttemptId })).rejects.toBe(error);
	});
});
