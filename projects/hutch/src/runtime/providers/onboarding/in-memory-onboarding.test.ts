import { UserIdSchema } from "../../domain/user/user.schema";
import { initInMemoryOnboarding } from "./in-memory-onboarding";

const owner = UserIdSchema.parse("00000000000000000000000000000001");
const otherUser = UserIdSchema.parse("00000000000000000000000000000002");

describe("initInMemoryOnboarding", () => {
	it("returns an empty set for a user with no completions", async () => {
		const store = initInMemoryOnboarding();
		const completed = await store.findCompletedOnboardingSteps({ userId: owner });
		expect(completed.size).toBe(0);
	});

	it("returns a marked step on subsequent reads", async () => {
		const store = initInMemoryOnboarding();
		await store.markOnboardingStepCompleted({
			userId: owner,
			stepId: "save-via-extension",
			completedAt: new Date("2026-05-01T00:00:00Z"),
		});

		const completed = await store.findCompletedOnboardingSteps({ userId: owner });
		expect(completed.has("save-via-extension")).toBe(true);
		expect(completed.has("install-extension")).toBe(false);
	});

	it("preserves the original timestamp when the same step is marked again", async () => {
		const store = initInMemoryOnboarding();
		const first = new Date("2026-05-01T00:00:00Z");
		const later = new Date("2026-05-02T00:00:00Z");
		await store.markOnboardingStepCompleted({
			userId: owner,
			stepId: "install-extension",
			completedAt: first,
		});
		await store.markOnboardingStepCompleted({
			userId: owner,
			stepId: "install-extension",
			completedAt: later,
		});

		expect(store.debugStateFor(owner).get("install-extension")).toEqual(first);
	});

	it("isolates completions across users", async () => {
		const store = initInMemoryOnboarding();
		await store.markOnboardingStepCompleted({
			userId: owner,
			stepId: "save-via-extension",
			completedAt: new Date("2026-05-01T00:00:00Z"),
		});

		const otherCompleted = await store.findCompletedOnboardingSteps({ userId: otherUser });
		expect(otherCompleted.size).toBe(0);
	});
});
