import Foundation

struct UploadJob: Codable, Equatable {
	enum State: Equatable {
		case capturePending(detectedMediaType: String?)
		case ready(contentType: String)
	}

	let id: String
	let url: String
	let title: String?
	var state: State
	var attempts: Int
	var nextAttemptAt: Date
	let createdAt: Date

	static let retryDelays: [TimeInterval] = [60, 300, 900, 3600, 10800, 21600]
	static let maxAttempts = 8

	func isDue(now: Date) -> Bool {
		nextAttemptAt <= now
	}

	func retried(now: Date) -> UploadJob? {
		guard attempts + 1 < Self.maxAttempts else { return nil }
		var next = self
		next.attempts = attempts + 1
		next.nextAttemptAt = now.addingTimeInterval(Self.retryDelays[min(attempts, Self.retryDelays.count - 1)])
		return next
	}

	func staged(contentType: String) -> UploadJob {
		var next = self
		next.state = .ready(contentType: contentType)
		return next
	}

	func detecting(mediaType: String) -> UploadJob {
		var next = self
		next.state = .capturePending(detectedMediaType: mediaType)
		return next
	}
}

extension UploadJob.State: Codable {
	private enum CodingKeys: String, CodingKey {
		case kind, detectedMediaType, contentType
	}

	private enum Kind: String, Codable {
		case capturePending, ready
	}

	init(from decoder: Decoder) throws {
		let container = try decoder.container(keyedBy: CodingKeys.self)
		switch try container.decode(Kind.self, forKey: .kind) {
		case .capturePending:
			self = .capturePending(detectedMediaType: try container.decodeIfPresent(String.self, forKey: .detectedMediaType))
		case .ready:
			self = .ready(contentType: try container.decode(String.self, forKey: .contentType))
		}
	}

	func encode(to encoder: Encoder) throws {
		var container = encoder.container(keyedBy: CodingKeys.self)
		switch self {
		case .capturePending(let detectedMediaType):
			try container.encode(Kind.capturePending, forKey: .kind)
			try container.encodeIfPresent(detectedMediaType, forKey: .detectedMediaType)
		case .ready(let contentType):
			try container.encode(Kind.ready, forKey: .kind)
			try container.encode(contentType, forKey: .contentType)
		}
	}
}
