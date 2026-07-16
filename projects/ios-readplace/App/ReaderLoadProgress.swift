import Foundation

/// The reader page's load lifecycle, derived from the WKWebView's navigation
/// callbacks and its `estimatedProgress`. The sheet drives its loading overlay
/// from this value rather than the web view directly, so the show/hide and
/// progress decisions stay pure and unit-tested while the KVO/delegate glue that
/// produces them is the untested OS boundary — the same split as `ReaderNavigation`.
enum ReaderLoadPhase: Equatable {
	/// A provisional load is in flight and nothing has painted, so the skeleton
	/// covers the page and no bar shows. The provisional `estimatedProgress` is
	/// deliberately not carried here: it spikes to 1.0 and drops back as the reader
	/// URL redirects, so binding a bar to it would flash the bar full then back.
	case loading
	/// The main frame committed and is painting, so the bar tracks the now-monotonic
	/// `estimatedProgress` while the skeleton lifts.
	case rendering(progress: Double)
	case finished
	case failed
}

/// What the sheet renders for a given load phase: whether the skeleton still
/// covers the page, whether the top progress bar shows, and how full it is.
struct ReaderLoadOverlay: Equatable {
	let showsSkeleton: Bool
	let showsProgressBar: Bool
	let progress: Double
}

enum ReaderLoad {
	/// The rendering phase for a post-commit `estimatedProgress`, clamped to [0, 1]
	/// (KVO can report slightly out of range).
	static func rendering(estimatedProgress: Double) -> ReaderLoadPhase {
		.rendering(progress: min(max(estimatedProgress, 0), 1))
	}

	static func overlay(for phase: ReaderLoadPhase) -> ReaderLoadOverlay {
		switch phase {
		case .loading:
			// A fixed head start, not the live provisional `estimatedProgress` (which
			// spikes to 1.0 and drops back): the bar shows work is underway from the
			// first frame without ever flashing full.
			return ReaderLoadOverlay(showsSkeleton: true, showsProgressBar: true, progress: headStart)
		case let .rendering(progress):
			// Floored at the head start so the bar never moves backwards when the
			// first committed progress report is below it.
			return ReaderLoadOverlay(showsSkeleton: false, showsProgressBar: true, progress: max(headStart, progress))
		case .finished, .failed:
			return ReaderLoadOverlay(showsSkeleton: false, showsProgressBar: false, progress: 1)
		}
	}

	private static let headStart = 0.1

	/// Whether a navigation error is a page the user failed to open, versus a
	/// cancellation the reader provokes itself. A first provisional navigation
	/// superseded by a redirect reports `NSURLErrorCancelled`; cancelling at the
	/// response phase reports WebKit's policy-change interruption (102, in the
	/// private `WebKitErrorDomain` — no public Swift constant). Neither means the
	/// article couldn't load, so both keep the loader waiting for the real result.
	static func isRealFailure(error: Error) -> Bool {
		let error = error as NSError
		if error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled {
			return false
		}
		if error.domain == webKitErrorDomain && error.code == frameLoadInterruptedByPolicyChange {
			return false
		}
		return true
	}

	private static let webKitErrorDomain = "WebKitErrorDomain"
	private static let frameLoadInterruptedByPolicyChange = 102
}
