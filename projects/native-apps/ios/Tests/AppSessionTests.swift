import XCTest
@testable import Readplace

final class AppSessionTests: XCTestCase {
	private let osVersion = OperatingSystemVersion(majorVersion: 26, minorVersion: 5, patchVersion: 0)

	func testProcessNativeUserAgentNamesTheRunningBinaryAndTheBuildItWasCutFrom() throws {
		let info = try XCTUnwrap(Bundle.main.infoDictionary)
		let product = try XCTUnwrap(info["CFBundleName"] as? String)
		let build = try XCTUnwrap(info["CFBundleVersion"] as? String)

		let userAgent = AppSession.processNativeUserAgent(bundle: .main, osVersion: osVersion)

		XCTAssertEqual(userAgent, "\(product)/build-\(build) iOS/26.5")
	}

	func testProcessNativeUserAgentCarriesTheBuildNumberRatherThanTheMarketingVersion() throws {
		let info = try XCTUnwrap(Bundle.main.infoDictionary)
		let build = try XCTUnwrap(info["CFBundleVersion"] as? String)
		let marketingVersion = try XCTUnwrap(info["CFBundleShortVersionString"] as? String)
		XCTAssertNotEqual(
			build, marketingVersion,
			"the two version keys must differ for this test to be able to tell them apart"
		)

		let userAgent = AppSession.processNativeUserAgent(bundle: .main, osVersion: osVersion)

		XCTAssertTrue(
			userAgent.contains("/build-\(build) "),
			"the access log's whole point is naming the build, which only CFBundleVersion counts"
		)
		XCTAssertFalse(
			userAgent.contains(marketingVersion),
			"CFBundleShortVersionString is the same across every build of a release, so it cannot tell a shipped build from a local one"
		)
	}
}
