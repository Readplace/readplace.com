import Foundation

/// The visual tone of a share-sheet status, mapped to a brand colour at the
/// UIKit boundary. Kept UIKit-free so the outcome→status mapping stays a pure,
/// testable value.
enum ShareStatusTone: Equatable {
	case success
	case warning
	case error
}

/// What the share-sheet shell shows for a save outcome: the message text, an SF
/// Symbol name, and a tone. Lifted out of `ShareViewController` so the whole
/// mapping — including joining a refusal's messages and choosing error vs.
/// warning from their kinds — is a pure value the tests exercise directly; the
/// controller only paints it and maps the tone to a `UIColor`.
struct ShareStatusPresentation: Equatable {
	let message: String
	let subtitle: String?
	let symbol: String
	let tone: ShareStatusTone

	init(outcome: SaveSharedOutcome) {
		switch outcome {
		case .saved(let messages):
			/// The server's confirmation when it sent one, so the sheet's copy can
			/// change without an App Store release; the client's own word otherwise.
			let serverCopy = messages.map(\.plainText).joined(separator: "\n")
			message = serverCopy.isEmpty ? "Saved" : serverCopy
			subtitle = nil
			symbol = "checkmark.circle.fill"
			tone = .success
		case .savedAwaitingUpload(let messages):
			let serverCopy = messages.map(\.plainText).joined(separator: "\n")
			message = serverCopy.isEmpty ? "Saved url" : serverCopy
			subtitle = "Content will be uploaded when you open the Readplace app"
			symbol = "checkmark.circle.fill"
			tone = .success
		case .notLoggedIn:
			message = "Open Readplace and sign in first."
			subtitle = nil
			symbol = "person.crop.circle.badge.exclamationmark"
			tone = .warning
		case .storageUnavailable(let status):
			message = "Couldn't read your saved sign-in (Keychain error \(status)). Reopen Readplace, then try sharing again."
			subtitle = nil
			symbol = "exclamationmark.triangle.fill"
			tone = .error
		case .noLink:
			message = "No link found to save."
			subtitle = nil
			symbol = "link"
			tone = .warning
		case .noSaveAction:
			message = "The server offered no save action."
			subtitle = nil
			symbol = "exclamationmark.triangle.fill"
			tone = .error
		case .refused(let messages):
			message = messages.map(\.plainText).joined(separator: "\n")
			subtitle = nil
			symbol = "lock.fill"
			tone = messages.contains { $0.kind == .error } ? .error : .warning
		case .failed(let failureMessage):
			message = failureMessage
			subtitle = nil
			symbol = "exclamationmark.triangle.fill"
			tone = .error
		}
	}
}
