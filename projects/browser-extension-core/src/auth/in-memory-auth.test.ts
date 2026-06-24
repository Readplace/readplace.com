import { initInMemoryAuth } from "./in-memory-auth";

describe("initInMemoryAuth", () => {
	describe("login + whenLoggedIn", () => {
		it("should return ok true and execute callback after login", async () => {
			const auth = initInMemoryAuth();
			await auth.login();

			const result = auth.whenLoggedIn(() => "hello");

			expect(result).toEqual({ ok: true, value: "hello" });
		});
	});

	describe("whenLoggedIn without login", () => {
		it("should return not-logged-in and never call the callback", () => {
			const auth = initInMemoryAuth();
			let called = false;

			const result = auth.whenLoggedIn(() => {
				called = true;
				return "value";
			});

			expect(result).toEqual({ ok: false, reason: "not-logged-in" });
			expect(called).toBe(false);
		});
	});

	describe("whenLoggedIn callback throws", () => {
		it("should catch the error and return it", async () => {
			const auth = initInMemoryAuth();
			await auth.login();
			const thrownError = new Error("something broke");

			const result = auth.whenLoggedIn(() => {
				throw thrownError;
			});

			expect(result.ok).toBe(false);
			if (!result.ok && result.reason === "error") {
				expect(result.error).toBe(thrownError);
			}
		});

		it("should wrap non-Error thrown values in an Error", async () => {
			const auth = initInMemoryAuth();
			await auth.login();

			const result = auth.whenLoggedIn(() => {
				throw "string-error";
			});

			expect(result.ok).toBe(false);
			if (!result.ok && result.reason === "error") {
				expect(result.error).toBeInstanceOf(Error);
				expect(result.error.message).toBe("string-error");
			}
		});
	});

	describe("refreshTokens", () => {
		it("should return ok true", async () => {
			const auth = initInMemoryAuth();

			const result = await auth.refreshTokens();

			expect(result).toEqual({ ok: true });
		});
	});

	describe("getAccessToken", () => {
		it("should return null when not logged in", async () => {
			const auth = initInMemoryAuth();

			const token = await auth.getAccessToken();

			expect(token).toBeNull();
		});

		it("should return a token when logged in", async () => {
			const auth = initInMemoryAuth();
			await auth.login();

			const token = await auth.getAccessToken();

			expect(token).toBe("in-memory-token");
		});
	});

	describe("ensureWebSession", () => {
		it("should resolve without error", async () => {
			const auth = initInMemoryAuth();

			await expect(auth.ensureWebSession()).resolves.toBeUndefined();
		});
	});

	describe("logout", () => {
		it("should return not-logged-in after logout", async () => {
			const auth = initInMemoryAuth();
			await auth.login();

			const beforeLogout = auth.whenLoggedIn(() => "still here");
			expect(beforeLogout).toEqual({ ok: true, value: "still here" });

			await auth.logout();

			const afterLogout = auth.whenLoggedIn(() => "gone");
			expect(afterLogout).toEqual({
				ok: false,
				reason: "not-logged-in",
			});
		});
	});
});
