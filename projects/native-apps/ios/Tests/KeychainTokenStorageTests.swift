import Security
import XCTest
@testable import Readplace

/// Exercises the real Keychain-backed storage against the simulator keychain. The
/// test host app carries the `group.com.readplace` app-group entitlement (which
/// doubles as the keychain access group), so generic-password items in that group
/// round-trip here — the path production uses, not the `UserDefaults` test double.
final class KeychainTokenStorageTests: XCTestCase {
	private let keychain = KeychainTokenStorage(accessGroup: AppConfig.appGroupId)

	override func setUp() {
		super.setUp()
		for key in TokenKey.allCases { keychain.removeValue(for: key) }
	}

	override func tearDown() {
		for key in TokenKey.allCases { keychain.removeValue(for: key) }
		super.tearDown()
	}

	func testAddsReadsUpdatesAndRemovesAToken() {
		XCTAssertNil(keychain.value(for: .accessToken), "starts empty")

		keychain.setValue("first", for: .accessToken) // insert path (SecItemAdd)
		XCTAssertEqual(keychain.value(for: .accessToken), "first")

		keychain.setValue("second", for: .accessToken) // update path (SecItemUpdate)
		XCTAssertEqual(keychain.value(for: .accessToken), "second")

		keychain.removeValue(for: .accessToken)
		XCTAssertNil(keychain.value(for: .accessToken))
	}

	func testKeysAreStoredIndependently() {
		keychain.setValue("acc", for: .accessToken)
		keychain.setValue("ref", for: .refreshToken)

		XCTAssertEqual(keychain.value(for: .accessToken), "acc")
		XCTAssertEqual(keychain.value(for: .refreshToken), "ref")

		keychain.removeValue(for: .accessToken)
		XCTAssertNil(keychain.value(for: .accessToken))
		XCTAssertEqual(keychain.value(for: .refreshToken), "ref", "removing one key leaves the other")
	}

	// MARK: - readResult (the Simulator can't produce a failing OSStatus, so the
	// status→value mapping is unit-tested directly)

	func testReadResultDecodesAStoredValue() {
		XCTAssertEqual(
			KeychainTokenStorage.readResult(status: errSecSuccess, data: Data("tok".utf8)),
			.success("tok")
		)
	}

	func testReadResultTreatsAMissingItemAsSignedOut() {
		XCTAssertEqual(KeychainTokenStorage.readResult(status: errSecItemNotFound, data: nil), .success(nil))
	}

	func testReadResultTreatsSuccessWithoutDataAsSignedOut() {
		XCTAssertEqual(KeychainTokenStorage.readResult(status: errSecSuccess, data: nil), .success(nil))
	}

	func testReadResultSurfacesAHardFailureStatus() {
		XCTAssertEqual(
			KeychainTokenStorage.readResult(status: errSecMissingEntitlement, data: nil),
			.failure(.read(status: errSecMissingEntitlement))
		)
	}
}
