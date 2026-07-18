import Foundation

enum ReaderSessionMint: Equatable {
	case minted([HTTPCookie])
	case failed
	case superseded
}

enum ReaderBootstrap: Equatable {
	case loading
	case ready([HTTPCookie])
	case unavailable

	init(after mint: ReaderSessionMint) {
		switch mint {
		case .minted(let cookies):
			self = .ready(cookies)
		case .failed:
			self = .unavailable
		case .superseded:
			self = .loading
		}
	}
}
