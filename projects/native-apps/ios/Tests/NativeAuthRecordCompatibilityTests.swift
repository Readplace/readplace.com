import XCTest
@testable import Readplace

final class NativeAuthRecordCompatibilityTests: XCTestCase {
	private static let persistedRecord = #"{"accountEpoch":"epoch-7","bound":true,"diagnosticIdentity":"11111111-1111-4111-8111-111111111111","diagnostics":[{"event":{"attempt_id":"attempt-1","client":"ios","client_version":"117","context_id":"22222222-2222-4222-8222-222222222222","event":"login_started","event_id":"33333333-3333-4333-8333-333333333333","generation":4,"http_status":200,"occurred_at":"2026-10-16T00:00:00Z","operation_id":"operation-1","storage_status":-25300,"surface":"app"},"identity":"identity-1","permit":"permit-1"},{"event":{"client":"ios","client_version":"117","context_id":"22222222-2222-4222-8222-222222222222","dropped_events":3,"event":"journal_health","event_id":"44444444-4444-4444-8444-444444444444","occurred_at":"2026-10-16T00:00:01Z","outcome":"success","reason":"journal_overflow","surface":"share"},"identity":"identity-1"}],"diagnosticsPermit":"permit-1","generation":5,"installationId":"55555555-5555-4555-8555-555555555555","pending":{"diagnosticIdentity":"identity-2","diagnosticsPermit":"permit-2","generation":6,"id":"operation-2","parent":{"accessToken":"pending-access","refreshToken":"pending-refresh"}},"signingKey":"signing-key-bytes","tokens":{"accessToken":"access-token","refreshToken":"refresh-token"}}"#

	private func sortedJSON(_ record: NativeAuthRecord) throws -> String {
		let encoder = JSONEncoder()
		encoder.outputFormatting = .sortedKeys
		return String(decoding: try encoder.encode(record), as: UTF8.self)
	}

	func testPersistedRecordRoundTripsByteForByte() throws {
		let defaults = TestSupport.ephemeralDefaults()
		defaults.set(Data(Self.persistedRecord.utf8).base64EncodedString(), forKey: "oauth.authRecord.v1")
		let store = TokenStore(defaults: defaults)

		XCTAssertEqual(try sortedJSON(store.authRecords.read()), Self.persistedRecord)

		try store.authRecords.update { _ in }

		XCTAssertEqual(try sortedJSON(store.authRecords.read()), Self.persistedRecord)
	}

	func testLegacyTokensMigrateIntoTheRecord() throws {
		let defaults = TestSupport.ephemeralDefaults()
		defaults.set("legacy-access", forKey: "oauth.accessToken")
		defaults.set("legacy-refresh", forKey: "oauth.refreshToken")
		let store = TokenStore(defaults: defaults)

		let encoded = try JSONEncoder().encode(store.authRecords.read())
		let object = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])

		XCTAssertEqual(object["tokens"] as? [String: String], ["accessToken": "legacy-access", "refreshToken": "legacy-refresh"])
	}
}
