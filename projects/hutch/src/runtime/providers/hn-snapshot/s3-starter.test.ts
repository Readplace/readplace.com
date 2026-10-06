import { NoSuchKey, type PutObjectCommand } from "@aws-sdk/client-s3";
import { initS3HnSnapshot } from "./s3-hn-snapshot";
import { initS3StarterRollout } from "./s3-starter-rollout";
import type { HnSnapshot } from "../../domain/engagement/hn-snapshot";

const NOW = new Date("2026-10-10T12:00:00.000Z");
const missing = () => new NoSuchKey({ message: "missing", $metadata: {} });
function subject() {
	const objects = new Map<string, string>();
	const writes: PutObjectCommand["input"][] = [];
	const deps: Parameters<typeof initS3HnSnapshot>[0] = {
		bucketName: "content",
		get: async (command) => {
			const value = objects.get(String(command.input.Key));
			if (value === undefined) throw missing();
			return { Body: { transformToString: async () => value } };
		},
		put: async (command) => {
			writes.push(command.input);
			const key = String(command.input.Key);
			if (command.input.IfNoneMatch === "*" && objects.has(key)) {
				throw Object.assign(new Error("exists"), { name: "PreconditionFailed" });
			}
			objects.set(key, String(command.input.Body));
		},
	};
	return {
		deps,
		objects,
		writes,
		snapshots: initS3HnSnapshot(deps),
		rollout: initS3StarterRollout(deps),
	};
}

describe("campaign manifests", () => {
	it("stores the daily snapshot under its dedicated prefix and atomically retains a competing snapshot", async () => {
		const app = subject();
		const day = "2026-10-10";
		const snapshot: HnSnapshot = {
			snapshotAt: NOW.toISOString(),
			items: [{ hnItemId: 1, rank: 1, status: "pending", url: "https://publisher.com/article" }],
		};
		expect(await app.snapshots.find(day)).toBeUndefined();
		expect(await app.snapshots.create({ day, snapshot })).toEqual(snapshot);
		expect(app.writes[0]).toMatchObject({
			Bucket: "content",
			Key: `engagement-starter/hn-snapshots/${day}.json`,
			ContentType: "application/json",
			IfNoneMatch: "*",
		});
		expect(await app.snapshots.create({ day, snapshot: { ...snapshot, items: [] } })).toEqual(
			snapshot,
		);
		const ready: HnSnapshot = {
			...snapshot,
			items: [
				{ hnItemId: 1, rank: 1, status: "ready", canonicalUrl: "https://publisher.com/article" },
			],
		};
		await app.snapshots.update({ day, snapshot: ready });
		expect(await app.snapshots.find(day)).toEqual(ready);
	});
	it("records rollout timing and policy once across deployments", async () => {
		const app = subject();
		expect(await app.rollout.findRollout()).toBeUndefined();
		const rollout = await app.rollout.startObservation({
			now: NOW,
			deploymentSha: "first-sha",
			excludedUserIds: ["internal"],
		});
		expect(rollout).toMatchObject({
			deploymentSha: "first-sha",
			observationStartedAt: NOW.toISOString(),
			enrollmentStartedAt: "2026-10-13T12:00:00.000Z",
			treatmentPercent: 80,
			personalArticleLimit: 5,
			inactivityHours: 72,
			firstReviewDay: 42,
			reviewEnrollmentDays: 28,
		});
		expect(
			await app.rollout.startObservation({
				now: new Date("2027-01-01"),
				deploymentSha: "next-sha",
				excludedUserIds: [],
			}),
		).toEqual(rollout);
		expect(app.writes).toHaveLength(1);
	});
	it("uses the rollout recorded by a concurrent deployment", async () => {
		const app = subject();
		const rollout = await app.rollout.startObservation({
			now: NOW,
			deploymentSha: "winner",
			excludedUserIds: [],
		});
		let reads = 0;
		const racing = initS3StarterRollout({
			...app.deps,
			get: async (command) => {
				if (reads++ === 0) throw missing();
				return app.deps.get(command);
			},
		});
		expect(
			await racing.startObservation({ now: NOW, deploymentSha: "loser", excludedUserIds: [] }),
		).toEqual(rollout);
	});
	it.each([
		new Error("storage unavailable"),
		"unexpected rejection",
	])("propagates read and write failures: %s", async (error) => {
		const read = {
			bucketName: "content",
			get: async () => {
				throw error;
			},
			put: async () => undefined,
		};
		await expect(initS3HnSnapshot(read).find("day")).rejects.toBe(error);
		await expect(initS3StarterRollout(read).findRollout()).rejects.toBe(error);
		const write = {
			...read,
			get: async () => {
				throw missing();
			},
			put: async () => {
				throw error;
			},
		};
		await expect(
			initS3HnSnapshot(write).create({
				day: "day",
				snapshot: { snapshotAt: NOW.toISOString(), items: [] },
			}),
		).rejects.toBe(error);
		await expect(
			initS3StarterRollout(write).startObservation({
				now: NOW,
				deploymentSha: "sha",
				excludedUserIds: [],
			}),
		).rejects.toBe(error);
	});
});
