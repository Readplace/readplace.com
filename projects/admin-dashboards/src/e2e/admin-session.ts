import assert from "node:assert/strict";
import type { Page } from "@playwright/test";

export async function signInAsAdmin(page: Page, baseUrl: string): Promise<void> {
	const signedIn = await page.request.post(`${baseUrl}/e2e/admin-session`);
	assert.equal(signedIn.status(), 204, "the e2e server must mint an admin session with its second-factor mark");
}
