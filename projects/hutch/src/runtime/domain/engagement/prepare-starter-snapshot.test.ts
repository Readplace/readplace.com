import { initPrepareStarterSnapshot } from "./prepare-starter-snapshot";

const NOW = new Date("2026-10-10T12:00:00.000Z");

describe("starter snapshot preparation", () => {
	it("records the rollout with the deployment's configuration before every snapshot", async () => {
		const calls: unknown[] = [];
		const prepare = initPrepareStarterSnapshot({
			startObservation: async (input) => {
				calls.push(input);
			},
			prepareSnapshot: async () => {
				calls.push("prepare");
			},
			deploymentSha: "deployment",
			excludedUserIds: ["internal"],
			now: () => NOW,
		});

		await prepare();
		await prepare();

		const observation = { now: NOW, deploymentSha: "deployment", excludedUserIds: ["internal"] };
		expect(calls).toEqual([observation, "prepare", observation, "prepare"]);
	});

	it("prepares no snapshot when the rollout cannot be recorded", async () => {
		const error = new Error("rollout record unavailable");
		const prepared: string[] = [];
		const prepare = initPrepareStarterSnapshot({
			startObservation: async () => {
				throw error;
			},
			prepareSnapshot: async () => {
				prepared.push("prepare");
			},
			deploymentSha: "deployment",
			excludedUserIds: [],
			now: () => NOW,
		});

		await expect(prepare()).rejects.toBe(error);
		expect(prepared).toEqual([]);
	});
});
