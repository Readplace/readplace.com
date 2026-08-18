import request from "supertest";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { useTestServer } from "../../../test-app";
import { SAVE_TIP_ELEMENTS, SAVE_TIP_EVENT_PATH, SAVE_TIP_UTM_SOURCE } from "./save-tip-tracking";

const useApp = useTestServer();

function beacon(element: string): string {
	return `${SAVE_TIP_EVENT_PATH}?utm_source=${SAVE_TIP_UTM_SOURCE}&utm_medium=internal&utm_content=${element}`;
}

describe(`POST ${SAVE_TIP_EVENT_PATH}`, () => {
	it.each(Object.values(SAVE_TIP_ELEMENTS))(
		"answers a %s beacon with an empty 204, so the panel never surfaces an error",
		async (element) => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const response = await request(harness.server).post(beacon(element));

			expect(response.status).toBe(204);
			expect(response.text).toBe("");
		},
	);

	it("takes the beacon from a logged-out visitor, who meets the panel on /import too", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).post(beacon(SAVE_TIP_ELEMENTS.opened));

		expect(response.status).toBe(204);
		expect(response.headers.location).toBeUndefined();
	});
});
