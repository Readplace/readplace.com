import assert from "node:assert/strict";
import { ForwardableSenderSchema, GmailAccountEmailSchema, type GmailMessageOrigin, GmailMessageIdSchema } from "@packages/domain/gmail";
import {
	type EmailOutputKey,
	formatEmailLinkOrdinal,
	InboxAddressSchema,
	ISSUE_OUTPUT_KEY,
	linkOutputKey,
	MessageIdSchema,
	NormalizedMessageIdSchema,
} from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { MarkGmailEmailImportedCommand } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { initInMemoryEmailImportCompletion, initInMemoryInboxEmail } from "@packages/test-fixtures/providers/inbox-email";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initEvaluateGmailImportCompletion } from "./evaluate-gmail-import-completion";
import { initGmailImportCompletionHandler } from "./gmail-import-completion-handler";
import { initRecordDuplicateGmailOrigin } from "./record-gmail-origin";

const userId = UserIdSchema.parse("00000000000000000000000000000001");
const receivedAtMessageId = "2026-10-27T00:00:00.000Z#<issue@news.test>";
const LINK = linkOutputKey(formatEmailLinkOrdinal(0));
const OTHER_LINK = linkOutputKey(formatEmailLinkOrdinal(1));
const HISTORY: GmailMessageOrigin = { kind: "history", accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com"), gmailMessageId: GmailMessageIdSchema.parse("m1") };
const FORWARDED: GmailMessageOrigin = {
	kind: "forwarded",
	accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com"),
	rfcMessageId: NormalizedMessageIdSchema.parse("issue@news.test"),
	senderEmail: ForwardableSenderSchema.parse("dan@news.test"),
};

function savedBody(outputKey: EmailOutputKey): string {
	return JSON.stringify({ "detail-type": "EmailOutputSavedToAll", detail: { userId, receivedAtMessageId, outputKey } });
}

function selectedBody(outputCount: number): string {
	return JSON.stringify({ "detail-type": "EmailOutputsSelected", detail: { userId, receivedAtMessageId, outputCount } });
}

async function setup(input: { origins?: GmailMessageOrigin[]; emailExists?: boolean } = {}) {
	const emails = initInMemoryInboxEmail();
	if (input.emailExists !== false) {
		await emails.putEmail({
			userId,
			receivedAtMessageId,
			messageId: MessageIdSchema.parse("<issue@news.test>"),
			recipientAddress: InboxAddressSchema.parse("gmail-abc123@read.place"),
			senderEmail: "dan@news.test",
			subject: "Issue",
			status: "received",
			receivedAt: "2026-10-27T00:00:00.000Z",
			rawEmailS3Key: "raw",
			bodyS3Key: "body",
			linkCounts: undefined,
		});
	}
	const completion = initInMemoryEmailImportCompletion({ getEmail: emails.getEmail });
	if (input.emailExists !== false) await completion.addGmailOrigins({ userId, receivedAtMessageId, origins: input.origins ?? [HISTORY] });
	const marks: unknown[] = [];
	const publishEvent = (async (event, detail) => {
		assert.equal(event, MarkGmailEmailImportedCommand);
		marks.push(detail);
	}) as PublishEvent;
	const evaluate = initEvaluateGmailImportCompletion({ findCompletion: completion.findCompletion, publishEvent });
	const handler = initGmailImportCompletionHandler({ acknowledgeOutput: completion.acknowledgeOutput, evaluate, logger: HutchLogger.from(noopLogger) });
	const run = (bodies: string[]) =>
		handler(buildSqsEvent(bodies.map((body, index) => ({ messageId: `m-${index}`, body }))), buildLambdaContext(), () => {});
	const select = (outputs: EmailOutputKey[], truncated = false) =>
		completion.selectOutputs({ userId, receivedAtMessageId, selection: { outputs, truncated, selectedAt: "2026-10-27T00:00:01.000Z" } });
	const recordDuplicate = initRecordDuplicateGmailOrigin({ addGmailOrigins: completion.addGmailOrigins, evaluate });
	return { run, select, marks, recordDuplicate };
}

describe("gmail import completion", () => {
	it("requests the Gmail update once the issue output is in All", async () => {
		const { run, select, marks } = await setup();
		await select([ISSUE_OUTPUT_KEY]);

		assert.deepEqual(await run([savedBody(ISSUE_OUTPUT_KEY)]), { batchItemFailures: [] });

		assert.deepEqual(marks, [{ userId, receivedAtMessageId, origin: HISTORY }]);
	});

	it("waits for every link and the issue when the mapping saves both", async () => {
		const { run, select, marks } = await setup();
		await select([ISSUE_OUTPUT_KEY, LINK, OTHER_LINK]);

		await run([savedBody(ISSUE_OUTPUT_KEY), savedBody(LINK)]);
		assert.deepEqual(marks, []);

		await run([savedBody(OTHER_LINK)]);
		assert.equal(marks.length, 1);
	});

	it("never updates Gmail while an output is unacknowledged", async () => {
		const { run, select, marks } = await setup();
		await select([LINK, OTHER_LINK]);

		await run([savedBody(LINK), savedBody(LINK), selectedBody(2)]);

		assert.deepEqual(marks, []);
	});

	it("counts a duplicate save of the same output once and still completes", async () => {
		const { run, select, marks } = await setup();
		await select([LINK]);

		await run([savedBody(LINK), savedBody(LINK)]);

		assert.equal(marks.length, 2);
	});

	it("completes a links-only email whose extraction selected nothing", async () => {
		const { run, select, marks } = await setup();
		await select([]);

		await run([selectedBody(0)]);

		assert.equal(marks.length, 1);
	});

	it("does not treat an acknowledgement before the selection as complete", async () => {
		const { run, select, marks } = await setup();

		await run([savedBody(LINK)]);
		assert.deepEqual(marks, []);

		await select([LINK]);
		await run([selectedBody(1)]);
		assert.equal(marks.length, 1);
	});

	it("never completes truncated processing", async () => {
		const { run, select, marks } = await setup();
		await select([LINK], true);

		await run([savedBody(LINK), selectedBody(1)]);

		assert.deepEqual(marks, []);
	});

	it("converges when the last two acknowledgements land concurrently", async () => {
		const { run, select, marks } = await setup();
		await select([LINK, OTHER_LINK]);

		await Promise.all([run([savedBody(LINK)]), run([savedBody(OTHER_LINK)])]);

		assert.ok(marks.length >= 1);
	});

	it("requests an update for each Gmail copy of the email", async () => {
		const { run, select, marks } = await setup({ origins: [HISTORY, FORWARDED] });
		await select([ISSUE_OUTPUT_KEY]);

		await run([savedBody(ISSUE_OUTPUT_KEY)]);

		assert.deepEqual(marks, [
			{ userId, receivedAtMessageId, origin: HISTORY },
			{ userId, receivedAtMessageId, origin: FORWARDED },
		]);
	});

	it("does nothing for an email with no Gmail copy", async () => {
		const { run, select, marks } = await setup({ origins: [] });
		await select([ISSUE_OUTPUT_KEY]);

		await run([savedBody(ISSUE_OUTPUT_KEY)]);

		assert.deepEqual(marks, []);
	});

	it("acknowledges nothing for an email that was deleted", async () => {
		const { run, marks } = await setup({ emailExists: false });

		assert.deepEqual(await run([savedBody(ISSUE_OUTPUT_KEY), selectedBody(1)]), { batchItemFailures: [] });

		assert.deepEqual(marks, []);
	});

	it("fails a record whose detail does not parse", async () => {
		const { run } = await setup();

		const result = await run([JSON.stringify({ "detail-type": "EmailOutputSavedToAll", detail: { userId } })]);

		assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "m-0" }] });
	});

	it("updates a duplicate Gmail copy that arrives after the canonical email is already in All", async () => {
		const { run, select, marks, recordDuplicate } = await setup({ origins: [HISTORY] });
		await select([ISSUE_OUTPUT_KEY]);
		await run([savedBody(ISSUE_OUTPUT_KEY)]);
		marks.length = 0;

		await recordDuplicate({ userId, receivedAtMessageId, origin: FORWARDED });

		assert.deepEqual(marks, [
			{ userId, receivedAtMessageId, origin: HISTORY },
			{ userId, receivedAtMessageId, origin: FORWARDED },
		]);
	});

	it("records nothing for a duplicate with no Gmail identity", async () => {
		const { select, marks, recordDuplicate } = await setup({ origins: [] });
		await select([]);

		await recordDuplicate({ userId, receivedAtMessageId, origin: undefined });

		assert.deepEqual(marks, []);
	});
});
