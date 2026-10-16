import CryptoKit
import Darwin
import Foundation

struct NativeRefreshOperation: Codable, Equatable {
	let id: String
	let generation: Int
	let parent: OAuthTokens
	let diagnosticIdentity: String
	let diagnosticsPermit: String?
}

struct NativeAuthRecord: Codable {
	var generation = 0
	var accountEpoch = ""
	var installationId = UUID().uuidString.lowercased()
	var tokens: OAuthTokens?
	var pending: NativeRefreshOperation?
	var signingKey: String?
	var bound = false
	var diagnosticsPermit: String?
	var diagnosticIdentity = UUID().uuidString.lowercased()
	var diagnostics: [NativeAuthJournalEntry] = []
}

final class NativeAuthRecords {
	private static let processLock = NSRecursiveLock()
	private let storage: TokenStorage
	private let lockURL: () throws -> URL?

	init(storage: TokenStorage, lockURL: @escaping () throws -> URL?) {
		self.storage = storage
		self.lockURL = lockURL
	}

	func read() throws -> NativeAuthRecord { try locked { try load() } }

	func update<T>(_ work: (inout NativeAuthRecord) throws -> T) throws -> T {
		try locked {
			var record = try load()
			let value = try work(&record)
			let encoded = try JSONEncoder().encode(record).base64EncodedString()
			try storage.writeChecked(encoded, for: .authRecord)
			storage.removeValue(for: .accessToken)
			storage.removeValue(for: .refreshToken)
			return value
		}
	}

	func replace(_ tokens: OAuthTokens?) throws {
		try update { record in
			record.generation += 1
			record.tokens = tokens
			record.pending = nil
			record.bound = false
		}
	}

	func prepare(after tokens: OAuthTokens) throws -> NativeRefreshOperation {
		try update { record in
			guard record.tokens == tokens else { throw OAuthError.sessionChanged }
			if let pending = record.pending { return pending }
			if record.signingKey == nil {
				record.signingKey = P256.Signing.PrivateKey().rawRepresentation.base64EncodedString()
			}
			let operation = NativeRefreshOperation(id: UUID().uuidString.lowercased(), generation: record.generation, parent: tokens,
				diagnosticIdentity: record.diagnosticIdentity, diagnosticsPermit: record.diagnosticsPermit)
			record.pending = operation
			return operation
		}
	}

	func commit(_ tokens: OAuthTokens, operation: NativeRefreshOperation, permit: String?) throws {
		try update { record in
			guard record.generation == operation.generation, record.pending == operation else { throw OAuthError.sessionChanged }
			record.tokens = tokens
			record.pending = nil
			record.bound = true
			record.generation += 1
			if let permit {
				record.diagnosticsPermit = permit
				for index in record.diagnostics.indices where record.diagnostics[index].identity == record.diagnosticIdentity && record.diagnostics[index].permit == nil {
					record.diagnostics[index].permit = permit
				}
			}
		}
	}

	private func load() throws -> NativeAuthRecord {
		if let value = try storage.readValue(for: .authRecord).get() {
			guard let data = Data(base64Encoded: value) else { throw KeychainError.read(status: errSecDecode) }
			return try JSONDecoder().decode(NativeAuthRecord.self, from: data)
		}
		let access = try storage.readValue(for: .accessToken).get()
		let refresh = try storage.readValue(for: .refreshToken).get()
		var record = NativeAuthRecord()
		if let access, let refresh { record.tokens = OAuthTokens(accessToken: access, refreshToken: refresh) }
		return record
	}

	private func locked<T>(_ work: () throws -> T) throws -> T {
		Self.processLock.lock()
		defer { Self.processLock.unlock() }
		guard let url = try lockURL() else { return try work() }
		let descriptor = open(url.path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
		guard descriptor >= 0 else { throw KeychainError.write(status: errSecIO) }
		defer { close(descriptor) }
		guard flock(descriptor, LOCK_EX) == 0 else { throw KeychainError.write(status: errSecIO) }
		defer { flock(descriptor, LOCK_UN) }
		return try work()
	}
}
