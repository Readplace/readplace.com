import Foundation

struct SloganLine: Equatable {
	let text: String
	let pose: TextPose
}

struct SubtitleFrame: Equatable {
	let outgoing: SloganLine
	let incoming: SloganLine
}

func sloganAsReview(_ slogan: String) -> String {
	"\u{201C}\(slogan)\u{201D}"
}

@MainActor
final class SloganRotation: ObservableObject {
	@Published var clock: WaveClock
	@Published private(set) var slogans: [String]
	@Published private(set) var index = 0
	@Published private(set) var handoff: SloganHandoff?
	let seed: UInt64
	private let intervalNanoseconds: UInt64
	private var handoffCount = 0

	init(fallback: String, seed: UInt64, intervalNanoseconds: UInt64, startedAt: Date) {
		slogans = [fallback]
		clock = WaveClock(accumulated: 0, resumedAt: startedAt)
		self.seed = seed
		self.intervalNanoseconds = intervalNanoseconds
	}

	var current: String { slogans[index] }

	func publish(_ published: [String]) {
		guard !published.isEmpty else { return }
		slogans = published
		index = 0
		handoff = nil
	}

	func advance(at now: Date) {
		let next = (index + 1) % slogans.count
		handoff = SloganHandoff(
			outgoing: slogans[index],
			incoming: slogans[next],
			startedAt: clock.elapsed(at: now),
			ordinal: handoffCount,
			seed: seed
		)
		handoffCount += 1
		index = next
	}

	/// Loads the published slogans, then cycles them for as long as the caller's
	/// task lives — the sign-in screen's `.task` cancels the sleep on disappear,
	/// and a signed-in user never sees the screen again.
	///
	/// A reader who asked for reduced motion gets the first slogan and no cycling:
	/// text swapping under them is exactly the motion that setting turns off.
	func run(reduceMotion: Bool, load: () async -> [String]) async {
		publish(await load())
		guard !reduceMotion, slogans.count > 1 else { return }
		while !Task.isCancelled {
			guard (try? await Task.sleep(nanoseconds: intervalNanoseconds)) != nil else { return }
			advance(at: Date())
		}
	}

	var settledSubtitle: SubtitleFrame {
		SubtitleFrame(
			outgoing: SloganLine(text: "", pose: .hidden),
			incoming: SloganLine(text: sloganAsReview(current), pose: .shown)
		)
	}

	func subtitle(at date: Date) -> SubtitleFrame {
		guard let handoff else { return settledSubtitle }
		let poses = handoff.poses(at: clock.elapsed(at: date))
		return SubtitleFrame(
			outgoing: SloganLine(text: sloganAsReview(handoff.outgoing), pose: poses.outgoing),
			incoming: SloganLine(text: sloganAsReview(handoff.incoming), pose: poses.incoming)
		)
	}
}
