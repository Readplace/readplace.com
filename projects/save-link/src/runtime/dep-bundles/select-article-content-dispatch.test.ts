import assert from "node:assert/strict";
import type { SendMessageCommand, SendMessageCommandInput } from "@aws-sdk/client-sqs";
import { SaveAttemptIdSchema } from "@packages/domain/article";
import { articleMessageGroupId } from "./generate-summary-dispatch";
import { initSelectArticleContentDispatch, selectionDeduplicationId } from "./select-article-content-dispatch";

const QUEUE_URL = "https://sqs.ap-southeast-2.amazonaws.com/123456789012/select-article-content-q.fifo";

function capturingDispatch() {
	const sent: SendMessageCommandInput[] = [];
	const send = async (command: SendMessageCommand) => {
		sent.push(command.input);
		return {};
	};
	const dispatch = initSelectArticleContentDispatch({ sqsClient: { send }, selectArticleContentQueueUrl: QUEUE_URL });
	return { dispatch, sentInputs: () => sent };
}

describe("initSelectArticleContentDispatch", () => {
	it("groups every source kind for normalised-equivalent URLs into one article group", async () => {
		const { dispatch, sentInputs } = capturingDispatch();

		await dispatch({ sourceKind: "reselect-after-removal", workId: "work-1", detail: { url: "https://example.com/post?utm_source=newsletter" } });
		await dispatch({ sourceKind: "recrawl-content-extracted", workId: "work-2", detail: { url: "http://example.com/post", saveAttemptId: SaveAttemptIdSchema.parse("attempt"), candidates: [] } });

		const [first, second] = sentInputs();
		assert.equal(first.QueueUrl, QUEUE_URL);
		assert.equal(first.MessageGroupId, articleMessageGroupId({ url: "http://example.com/post" }));
		assert.equal(second.MessageGroupId, first.MessageGroupId);
		assert.equal(first.DelaySeconds, undefined);
	});

	it("derives the deduplication ID from the source kind and work ID, so distinct ingress work with identical bodies stays deliverable", async () => {
		const { dispatch, sentInputs } = capturingDispatch();
		const detail = { url: "https://example.com/post" };

		await dispatch({ sourceKind: "reselect-after-removal", workId: "work-1", detail });
		await dispatch({ sourceKind: "reselect-after-removal", workId: "work-1", detail });
		await dispatch({ sourceKind: "reselect-after-removal", workId: "work-2", detail });

		const [first, again, other] = sentInputs();
		assert.equal(first.MessageDeduplicationId, selectionDeduplicationId({ sourceKind: "reselect-after-removal", workId: "work-1" }));
		assert.match(first.MessageDeduplicationId, /^[0-9a-f]{64}$/);
		assert.equal(again.MessageDeduplicationId, first.MessageDeduplicationId);
		assert.notEqual(other.MessageDeduplicationId, first.MessageDeduplicationId);
	});

	it("gives the same work ID under a different source kind a different deduplication ID", () => {
		assert.notEqual(
			selectionDeduplicationId({ sourceKind: "tier-content-extracted", workId: "work-1" }),
			selectionDeduplicationId({ sourceKind: "refresh-content-extracted", workId: "work-1" }),
		);
	});
});
