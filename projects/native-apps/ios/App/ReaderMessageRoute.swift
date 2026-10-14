import Foundation

enum ReaderMessageRoute: Equatable {
	case startCapture
	case startAutomaticCapture
	case markRead
	case reconcileStatus
	case ignore

	static func route(
		message name: String,
		body: Any,
		captureInFlight: Bool,
		alreadyMarkedRead: Bool
	) -> ReaderMessageRoute {
		if ReaderBridge.isCaptureAvailable(message: name, body: body) {
			return captureInFlight ? .ignore : .startAutomaticCapture
		}
		if ReaderBridge.isCaptureBlocked(message: name, body: body) {
			return captureInFlight ? .ignore : .startCapture
		}
		if ReaderBridge.isMarkedRead(message: name, body: body), !alreadyMarkedRead {
			return .markRead
		}
		if ReaderBridge.isStatusChanged(message: name, body: body) {
			return .reconcileStatus
		}
		return .ignore
	}
}
