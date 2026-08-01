import Foundation

enum ReaderMessageRoute: Equatable {
	case startCapture
	case markRead
	case ignore

	static func route(
		message name: String,
		body: Any,
		captureInFlight: Bool,
		alreadyMarkedRead: Bool
	) -> ReaderMessageRoute {
		if ReaderBridge.isCaptureBlocked(message: name, body: body) {
			return captureInFlight ? .ignore : .startCapture
		}
		if ReaderBridge.isMarkedRead(message: name, body: body), !alreadyMarkedRead {
			return .markRead
		}
		return .ignore
	}
}
