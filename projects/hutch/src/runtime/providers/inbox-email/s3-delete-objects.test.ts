import type { S3Client } from "@aws-sdk/client-s3";
import { initS3DeleteObjects } from "./s3-delete-objects";

type SendFn = S3Client["send"];

interface CapturedCommand {
	input: { Bucket?: string; Delete?: { Objects?: { Key?: string }[] } };
}

function recordingClient(): {
	client: Pick<S3Client, "send">;
	commands: CapturedCommand[];
} {
	const commands: CapturedCommand[] = [];
	return {
		client: {
			send: (async (cmd: unknown) => {
				commands.push(cmd as CapturedCommand);
				return {};
			}) as unknown as SendFn,
		},
		commands,
	};
}

describe("initS3DeleteObjects", () => {
	it("issues no request when there are no keys", async () => {
		const { client, commands } = recordingClient();
		const del = initS3DeleteObjects({ client, bucketName: "raw-bucket" });

		await del([]);

		expect(commands).toHaveLength(0);
	});

	it("deletes a batch of keys in one request against the target bucket", async () => {
		const { client, commands } = recordingClient();
		const del = initS3DeleteObjects({ client, bucketName: "raw-bucket" });

		await del(["inbound/a", "inbound/b"]);

		expect(commands).toHaveLength(1);
		expect(commands[0].input.Bucket).toBe("raw-bucket");
		expect(commands[0].input.Delete?.Objects).toEqual([
			{ Key: "inbound/a" },
			{ Key: "inbound/b" },
		]);
	});

	it("splits into requests of at most 1000 keys", async () => {
		const { client, commands } = recordingClient();
		const del = initS3DeleteObjects({ client, bucketName: "content-bucket" });
		const keys = Array.from({ length: 1001 }, (_, i) => `content/${i}`);

		await del(keys);

		expect(commands).toHaveLength(2);
		expect(commands[0].input.Delete?.Objects).toHaveLength(1000);
		expect(commands[1].input.Delete?.Objects).toEqual([{ Key: "content/1000" }]);
	});
});
