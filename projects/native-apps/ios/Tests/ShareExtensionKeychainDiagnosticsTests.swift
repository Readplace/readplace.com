import Security
import XCTest
@testable import Readplace

/// Guards the share extension's diagnosability contract for the
/// "Open Readplace and sign in first." bug.
///
/// The bug: on a real device the extension's shared-Keychain read returns nil
/// even though the app wrote the tokens and reads them fine (the signing chain is
/// healthy — both App Store profiles carry `group.com.readplace`). The extension
/// is a separate, memory-starved process, so `SecItemCopyMatching` there can fail
/// with e.g. `errSecMissingEntitlement` (-34018). Previously
/// `KeychainTokenStorage.value(for:)` collapsed EVERY such status into nil,
/// indistinguishable from "no tokens", and `SaveSharedPage.run` rendered that nil
/// as `.notLoggedIn` — telling a signed-in user to sign in again.
///
/// This test cannot reproduce the on-device Keychain failure itself: XCTest runs
/// in the app process and the Simulator ignores access groups, so a shared-item
/// read never fails here (`KeychainTokenStorageTests` pass for exactly that reason
/// while being blind to this class of bug). What it pins is the contract that
/// makes the failure diagnosable: a store that FAILS to read must surface as
/// `.storageUnavailable(status)`, never as `.notLoggedIn`. Re-introducing the
/// old collapse (mapping a read failure back to a signed-out state) faults this.
@MainActor
final class ShareExtensionKeychainDiagnosticsTests: XCTestCase {
	nonisolated override func setUp() {
		super.setUp()
		StubURLProtocol.reset()
	}

	func testKeychainReadFailureIsSurfacedNotReportedAsSignedOut() async {
		// The user IS signed in — the app wrote and reads these tokens — but the
		// extension's Keychain read fails with a hard status.
		let store = TokenStore(storage: FailingTokenStorage(
			failing: Set(TokenKey.allCases),
			status: errSecMissingEntitlement
		))
		let saver = SaveSharedPage(
			store: store,
			api: ReadplaceAPI(
				baseURL: AppConfig.serverBaseURL,
				store: store,
				sessionConfiguration: TestSupport.stubbedConfiguration()
			),
			captor: FakeHTMLCaptor(page: CapturedPage(rawHtml: "<html></html>", title: "x", mediaType: nil)),
			jobs: UploadJobStore(containerURL: TestSupport.temporaryContainer())
		)

		let outcome = await saver.run(
			url: URL(string: "https://example.com/post")!,
			fallbackTitle: nil,
			sharedPdf: nil
		)

		XCTAssertNotEqual(
			outcome, .notLoggedIn,
			"a Keychain that fails to READ must not be reported to a signed-in user as 'not signed in'"
		)
		XCTAssertEqual(
			outcome, .storageUnavailable(errSecMissingEntitlement),
			"the OSStatus must be surfaced so the failure is diagnosable, not masked as a logout"
		)
		XCTAssertTrue(
			StubURLProtocol.records.isEmpty,
			"an unreadable store must short-circuit before any network call"
		)
	}
}
