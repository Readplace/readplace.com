import CryptoKit
import Foundation

struct NativeAuthEvent: Codable {
	let event_id: String
	let event: String
	let occurred_at: String
	let client = "ios"
	let surface: String
	let context_id: String
	let client_version: String
	var operation_id: String?
	var attempt_id: String?
	var generation: Int?
	var http_status: Int?
	var outcome: String?
	var reason: String?
	var storage_status: Int32?
	var dropped_events: Int?
}

struct NativeAuthJournalEntry: Codable {
	let event: NativeAuthEvent
	let identity: String
	var permit: String?
}

final class NativeAuthTransportDelegate: NSObject, URLSessionTaskDelegate {
	func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
		newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
		completionHandler(nil)
	}
}

actor NativeRefreshRecovery {
	private let baseURL: String
	private let records: NativeAuthRecords
	private let session: URLSession
	private let surface: String
	private let version: String
	private let context = UUID().uuidString.lowercased()
	private var supported: Bool?
	private var uploading = false

	init(baseURL: String, records: NativeAuthRecords, configuration: URLSessionConfiguration,
		surface: String, version: String) {
		self.baseURL = baseURL
		self.records = records
		self.session = URLSession(configuration: configuration, delegate: NativeAuthTransportDelegate(), delegateQueue: nil)
		self.surface = surface
		self.version = version
	}

	func requestHeaders() throws -> [String: String] {
		["X-Readplace-Auth-Attempt-Id": UUID().uuidString.lowercased(),
			"X-Readplace-Auth-Context-Id": context, "X-Readplace-Client-Version": version,
			"X-Readplace-Installation-Id": try records.read().installationId]
	}

	func record(_ event: String, outcome: String? = nil, reason: String? = nil,
		operation: String? = nil, attempt: String? = nil, status: Int? = nil, owner: NativeRefreshOperation? = nil,
		storageStatus: Int32? = nil) {
		let entry = NativeAuthEvent(event_id: UUID().uuidString.lowercased(), event: event,
			occurred_at: ISO8601DateFormatter().string(from: Date()), surface: surface,
			context_id: context, client_version: version, operation_id: operation,
			attempt_id: attempt, http_status: status, outcome: outcome, reason: reason, storage_status: storageStatus)
		try? records.update { record in
			let earliest = ISO8601DateFormatter().string(from: Date().addingTimeInterval(-7 * 86400))
			let identity = owner?.diagnosticIdentity ?? record.diagnosticIdentity
			let permit = identity == record.diagnosticIdentity ? record.diagnosticsPermit : owner?.diagnosticsPermit
			var dropped = record.diagnostics.last { $0.identity == identity && $0.event.event == "journal_health" }?.event.dropped_events ?? 0
			record.diagnostics.removeAll { $0.identity == identity && $0.event.event == "journal_health" }
			let previousCount = record.diagnostics.count
			record.diagnostics.removeAll { $0.event.occurred_at < earliest }
			dropped += previousCount - record.diagnostics.count
			record.diagnostics.append(NativeAuthJournalEntry(event: entry, identity: identity, permit: permit))
			let healthId = UUID().uuidString.lowercased()
			func checkpoint() -> [NativeAuthJournalEntry] {
				guard dropped > 0 else { return [] }
				let health = NativeAuthEvent(event_id: healthId, event: "journal_health", occurred_at: entry.occurred_at,
					surface: surface, context_id: context, client_version: version, outcome: "success", reason: "journal_overflow", dropped_events: dropped)
				return [NativeAuthJournalEntry(event: health, identity: identity, permit: permit)]
			}
			while try record.diagnostics.count + checkpoint().count > 512 || JSONEncoder().encode(record.diagnostics + checkpoint()).count > 256 * 1024 {
				record.diagnostics.removeFirst()
				dropped += 1
			}
			record.diagnostics += checkpoint()
		}
	}

	func refresh(after failed: OAuthTokens) async throws -> OAuthTokens? {
		let before = try records.read()
		guard before.tokens == failed else {
			guard let current = before.tokens else { throw OAuthError.noRefreshToken }
			return current
		}
		if !before.bound && before.pending == nil {
			if !(try await isSupported()) { return nil }
		}
		let operation = try records.prepare(after: failed)
		record("refresh_prepared", operation: operation.id, owner: operation)
		let result = try await exchange(operation)
		if result.expiry <= Date() {
			let next = try records.prepare(after: result.tokens)
			return try await exchange(next).tokens
		}
		return result.tokens
	}

	private func isSupported() async throws -> Bool {
		if let supported { return supported }
		let url = URL(string: "\(baseURL)/.well-known/oauth-authorization-server")!
		let (data, response) = try await session.data(from: url)
		guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw OAuthError.refreshFailed }
		struct Metadata: Decodable {
			let readplace_refresh_protocols_supported: [Int]?
			let readplace_refresh_enrollment_enabled: Bool?
		}
		let metadata = try JSONDecoder().decode(Metadata.self, from: data)
		let enabled = metadata.readplace_refresh_protocols_supported?.contains(1) == true && metadata.readplace_refresh_enrollment_enabled == true
		supported = enabled
		return enabled
	}

	private struct Answer: Decodable {
		let access_token: String
		let refresh_token: String
		let readplace: Receipt
		struct Receipt: Decodable {
			let `protocol`: Int
			let operation_id: String
			let access_expires_at: String
			let recovered: Bool
			let diagnostics_permit: String?
		}
	}

	private func exchange(_ operation: NativeRefreshOperation) async throws -> (tokens: OAuthTokens, expiry: Date) {
		let body = form([
			"grant_type": "refresh_token", "refresh_token": operation.parent.refreshToken,
			"client_id": AppConfig.clientId, "readplace_refresh_protocol": "1",
			"readplace_refresh_operation_id": operation.id,
		])
		let (data, response) = try await send(body: body, path: "/oauth/token", contentType: "application/x-www-form-urlencoded", operation: operation.id, owner: operation)
		if response.statusCode != 200 {
			struct Refusal: Decodable { let error: String; let readplace_reason: String? }
			let error = try? JSONDecoder().decode(Refusal.self, from: data)
			if error?.error == "invalid_grant", let reason = error?.readplace_reason, ["expired", "revoked", "superseded"].contains(reason) {
				let current = try records.read()
				if current.tokens != operation.parent, let tokens = current.tokens { return (tokens, .distantFuture) }
				try records.update { record in
					guard record.generation == operation.generation, record.pending == operation else { throw OAuthError.sessionChanged }
					record.generation += 1; record.tokens = nil; record.pending = nil
				}
				record("credentials_cleared", outcome: "failure", reason: error?.readplace_reason, operation: operation.id, owner: operation)
				Task { await self.flush() }
				throw OAuthError.noRefreshToken
			}
			record("refresh_failed", outcome: "preserved", reason: "http_error", operation: operation.id, owner: operation)
			throw OAuthError.refreshFailed
		}
		guard let answer = try? JSONDecoder().decode(Answer.self, from: data), answer.readplace.protocol == 1,
			answer.readplace.operation_id == operation.id, !answer.access_token.isEmpty, !answer.refresh_token.isEmpty,
			let expiry = Self.date(answer.readplace.access_expires_at) else {
				record("refresh_failed", outcome: "preserved", reason: "malformed_response", operation: operation.id, owner: operation)
				throw OAuthError.malformedResponse
			}
		record("refresh_parsed", outcome: "success", operation: operation.id, owner: operation)
		let tokens = OAuthTokens(accessToken: answer.access_token, refreshToken: answer.refresh_token)
		record("storage_started", operation: operation.id, owner: operation)
		do { try records.commit(tokens, operation: operation, permit: answer.readplace.diagnostics_permit) }
		catch OAuthError.sessionChanged {
			if let current = try records.read().tokens { return (current, .distantFuture) }
			throw OAuthError.sessionChanged
		}
		catch {
			record("storage_failed", outcome: "preserved", reason: "storage_write_failed", operation: operation.id,
				owner: operation, storageStatus: (error as? KeychainError)?.status)
			throw error
		}
		record("storage_completed", outcome: "success", operation: operation.id, owner: operation)
		record(answer.readplace.recovered ? "refresh_recovered" : "refresh_completed", outcome: "success", operation: operation.id, owner: operation)
		Task { await self.flush() }
		return (tokens, expiry)
	}

	func revoke(_ previous: NativeAuthRecord) async throws {
		guard let tokens = previous.tokens, previous.bound || previous.pending != nil else { return }
		let operation = UUID().uuidString.lowercased()
		let body = try JSONSerialization.data(withJSONObject: ["token": tokens.refreshToken, "client_id": AppConfig.clientId,
			"readplace_refresh_protocol": 1, "readplace_refresh_operation_id": operation], options: [.sortedKeys])
		let owner = NativeRefreshOperation(id: operation, generation: previous.generation, parent: tokens,
			diagnosticIdentity: previous.diagnosticIdentity, diagnosticsPermit: previous.diagnosticsPermit)
		_ = try await send(body: body, path: "/oauth/revoke", contentType: "application/json", operation: operation, owner: owner)
	}

	private func send(body: Data, path: String, contentType: String, operation: String,
		owner: NativeRefreshOperation, nonce: String? = nil, challenge: Int = 0) async throws -> (Data, HTTPURLResponse) {
			let state = try records.read()
			if path == "/oauth/token", state.pending?.id != operation { throw OAuthError.sessionChanged }
			let attempt = UUID().uuidString.lowercased()
			let url = URL(string: "\(baseURL)\(path)")!
			var request = URLRequest(url: url)
			request.httpMethod = "POST"; request.httpBody = body; request.timeoutInterval = 10
			request.setValue(contentType, forHTTPHeaderField: "Content-Type")
			request.setValue(try proof(record: state, body: body, url: url, operation: operation, nonce: nonce), forHTTPHeaderField: "DPoP")
			request.setValue(attempt, forHTTPHeaderField: "X-Readplace-Auth-Attempt-Id")
			request.setValue(context, forHTTPHeaderField: "X-Readplace-Auth-Context-Id")
			request.setValue(version, forHTTPHeaderField: "X-Readplace-Client-Version")
			request.setValue(state.installationId, forHTTPHeaderField: "X-Readplace-Installation-Id")
			record("refresh_request_started", operation: operation, attempt: attempt, owner: owner)
			let data: Data; let raw: URLResponse
			do { (data, raw) = try await session.data(for: request) }
			catch { record("refresh_failed", outcome: "preserved", reason: "network_error", operation: operation, attempt: attempt, owner: owner); throw OAuthError.refreshUnreachable(error) }
			guard let response = raw as? HTTPURLResponse else { throw OAuthError.malformedResponse }
			record("refresh_response_received", operation: operation, attempt: attempt, status: response.statusCode, owner: owner)
			let error = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
			if challenge < 2, let next = response.value(forHTTPHeaderField: "DPoP-Nonce"),
				error?["error"] as? String == "use_dpop_nonce" || error?["readplace_reason"] as? String == "proof_replayed" {
				return try await send(body: body, path: path, contentType: contentType, operation: operation, owner: owner, nonce: next, challenge: challenge + 1)
			}
			return (data, response)
	}

	private func proof(record: NativeAuthRecord, body: Data, url: URL, operation: String, nonce: String?) throws -> String {
		guard let encoded = record.signingKey, let data = Data(base64Encoded: encoded) else { throw OAuthError.sessionChanged }
		let key = try P256.Signing.PrivateKey(rawRepresentation: data)
		let point = key.publicKey.x963Representation
		let header: [String: Any] = ["typ": "dpop+jwt", "alg": "ES256", "jwk": ["kty": "EC", "crv": "P-256",
			"x": Self.base64(Data(point[1..<33])), "y": Self.base64(Data(point[33..<65]))]]
		var claims: [String: Any] = ["htu": url.absoluteString, "htm": "POST", "iat": Int(Date().timeIntervalSince1970),
			"jti": UUID().uuidString.lowercased(), "readplace_operation_id": operation,
			"readplace_body_sha256": Self.base64(Data(SHA256.hash(data: body)))]
		if let nonce { claims["nonce"] = nonce }
		let unsigned = try Self.base64(JSONSerialization.data(withJSONObject: header, options: [.sortedKeys])) + "." + Self.base64(JSONSerialization.data(withJSONObject: claims, options: [.sortedKeys]))
		return unsigned + "." + Self.base64(try key.signature(for: Data(unsigned.utf8)).rawRepresentation)
	}

	func flush() async {
		guard !uploading, let state = try? records.read(), let permit = state.diagnostics.compactMap(\.permit).first else { return }
		uploading = true; defer { uploading = false }
		struct Batch: Encodable { let schema_version: Int; let events: [NativeAuthEvent] }
		var events = Array(state.diagnostics.filter { $0.permit == permit }.prefix(64).map(\.event))
		while events.count > 1, let encoded = try? JSONEncoder().encode(Batch(schema_version: 1, events: events)), encoded.count > 32 * 1024 { events.removeLast() }
		guard let body = try? JSONEncoder().encode(Batch(schema_version: 1, events: events)) else { return }
		var request = URLRequest(url: URL(string: "\(baseURL)/diagnostics/auth")!)
		request.httpMethod = "POST"; request.httpBody = body; request.timeoutInterval = 10
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		request.setValue("Bearer \(permit)", forHTTPHeaderField: "Authorization")
		guard let (data, response) = try? await session.data(for: request), (response as? HTTPURLResponse)?.statusCode == 202 else { return }
		struct Accepted: Decodable { let accepted_event_ids: [String] }
		guard let accepted = try? JSONDecoder().decode(Accepted.self, from: data) else { return }
		let ids = Set(accepted.accepted_event_ids)
		try? records.update { $0.diagnostics.removeAll { ids.contains($0.event.event_id) } }
	}

	private func form(_ values: [String: String]) -> Data {
		var components = URLComponents()
		components.queryItems = values.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
		return Data(components.percentEncodedQuery!.utf8)
	}
	private static func base64(_ data: Data) -> String { data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
	private static func date(_ value: String) -> Date? {
		let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
		return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
	}
}
