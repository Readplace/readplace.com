import XCTest
@testable import Readplace

@MainActor
final class BrowserHandoffURLTests: XCTestCase {
	private func returnPath(of handoff: URL?) throws -> String? {
		let components = try XCTUnwrap(URLComponents(url: try XCTUnwrap(handoff), resolvingAgainstBaseURL: false))
		return components.queryItems?.first { $0.name == "return" }?.value
	}

	private func recordingBrowser(chromeOpens: Bool) -> (ExternalBrowser, () -> [URL]) {
		var opened: [URL] = []
		let browser = ExternalBrowser(open: { url, completion in
			opened.append(url)
			completion(chromeOpens || !(url.scheme?.hasPrefix("googlechrome") ?? false))
		})
		return (browser, { opened })
	}

	func testBuildsTheHandoffURLCarryingTheCodeAndTheFullReturnPath() throws {
		let target = URL(string: "\(AppConfig.serverBaseURL)/export?from=account#top")!

		let handoff = try XCTUnwrap(browserHandoffURL(for: target, code: "c0de", baseURL: AppConfig.serverBaseURL))

		let components = try XCTUnwrap(URLComponents(url: handoff, resolvingAgainstBaseURL: false))
		XCTAssertEqual(components.host, AppConfig.serverHost)
		XCTAssertEqual(components.path, "/auth/handoff")
		XCTAssertEqual(components.queryItems?.first { $0.name == "code" }?.value, "c0de")
		XCTAssertEqual(try returnPath(of: handoff), "/export?from=account#top")
	}

	func testReturnsToTheRootWhenTheLinkHasNoPath() throws {
		let target = URL(string: AppConfig.serverBaseURL)!

		XCTAssertEqual(try returnPath(of: browserHandoffURL(for: target, code: "c", baseURL: AppConfig.serverBaseURL)), "/")
	}

	func testNeverBuildsAHandoffForAnotherHostOrANonWebScheme() {
		XCTAssertNil(browserHandoffURL(for: URL(string: "https://www.youtube.com/watch?v=abc")!, code: "c", baseURL: AppConfig.serverBaseURL))
		XCTAssertNil(browserHandoffURL(for: URL(string: "mailto:hi@example.com")!, code: "c", baseURL: AppConfig.serverBaseURL))
	}

	func testMintsOnceAndOpensTheHandoffInChrome() async throws {
		let (browser, opened) = recordingBrowser(chromeOpens: true)
		var mints = 0

		await openURLWithHandoff(URL(string: "\(AppConfig.serverBaseURL)/export")!, browser: browser, mint: {
			mints += 1
			return "code-\(mints)"
		})

		XCTAssertEqual(mints, 1)
		XCTAssertEqual(opened().map(\.scheme), ["googlechromes"])
		XCTAssertEqual(opened().first?.path, "/auth/handoff")
		XCTAssertEqual(try returnPath(of: opened().first), "/export")
	}

	func testMintsAFreshCodeForTheDefaultBrowserWhenChromeCannotOpen() async throws {
		let (browser, opened) = recordingBrowser(chromeOpens: false)
		var mints = 0

		await openURLWithHandoff(URL(string: "\(AppConfig.serverBaseURL)/export")!, browser: browser, mint: {
			mints += 1
			return "code-\(mints)"
		})

		XCTAssertEqual(mints, 2)
		XCTAssertEqual(opened().map(\.scheme), ["googlechromes", "https"])
		let fallback = try XCTUnwrap(URLComponents(url: try XCTUnwrap(opened().last), resolvingAgainstBaseURL: false))
		XCTAssertEqual(fallback.path, "/auth/handoff")
		XCTAssertEqual(fallback.queryItems?.first { $0.name == "code" }?.value, "code-2")
	}

	func testOpensTheLinkChromeFirstWithoutAHandoffWhenTheMintFails() async {
		let (browser, opened) = recordingBrowser(chromeOpens: true)

		await openURLWithHandoff(URL(string: "\(AppConfig.serverBaseURL)/export")!, browser: browser, mint: {
			throw APIError.unauthorized
		})

		XCTAssertEqual(opened().map(\.absoluteString), ["googlechromes://\(AppConfig.serverHost)/export"])
	}

	func testOpensTheRawLinkWhenTheSecondMintFails() async {
		let (browser, opened) = recordingBrowser(chromeOpens: false)
		var mints = 0

		await openURLWithHandoff(URL(string: "\(AppConfig.serverBaseURL)/export")!, browser: browser, mint: {
			mints += 1
			if mints > 1 { throw APIError.unauthorized }
			return "code-1"
		})

		XCTAssertEqual(opened().last?.absoluteString, "\(AppConfig.serverBaseURL)/export")
	}

	func testNeverMintsForAThirdPartyOrNonWebLink() async {
		for link in ["https://www.youtube.com/watch?v=abc", "mailto:hi@example.com"] {
			let (browser, opened) = recordingBrowser(chromeOpens: true)
			var mints = 0

			await openURLWithHandoff(URL(string: link)!, browser: browser, mint: {
				mints += 1
				return "code"
			})

			XCTAssertEqual(mints, 0, "\(link) must never carry a sign-in code")
			XCTAssertEqual(opened().map(\.absoluteString), [link])
		}
	}
}
