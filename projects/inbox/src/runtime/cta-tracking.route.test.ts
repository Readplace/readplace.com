import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { describeUntrackedCtas, findUntrackedCtas } from "@packages/web-test-harness";
import { loginAgent, useTestServer } from "./test-app";

const useApp = useTestServer();

const MEMBER_PATHS = ["/inbox", "/inbox/addresses"];

describe("every same-origin CTA carries its own utm_source", () => {
	it("holds across the inbox surfaces", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const untracked: string[] = [];
		for (const path of MEMBER_PATHS) {
			const response = await agent.get(path);
			const found = findUntrackedCtas(response.text, { skipSelectors: [] });
			for (const line of describeUntrackedCtas(found)) untracked.push(`${path}  ${line}`);
		}

		expect(untracked).toEqual([]);
	});
});
