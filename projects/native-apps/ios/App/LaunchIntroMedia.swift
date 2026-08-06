import AVFoundation
import SwiftUI
import UIKit

struct IntroMusic {
	let start: () -> Void
	let stop: () -> Void
	let restart: () -> Void
	let seek: (TimeInterval) -> Void
	let setMuted: (Bool) -> Void

	static let system: IntroMusic = {
		let player = makeLoopingPlayer()
		func activate() {
			try? AVAudioSession.sharedInstance().setCategory(.playback, options: [.mixWithOthers])
			try? AVAudioSession.sharedInstance().setActive(true)
		}
		return IntroMusic(
			start: {
				guard !player.isPlaying else { return }
				activate()
				player.play()
			},
			stop: {
				guard player.isPlaying else { return }
				player.stop()
				try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
			},
			restart: {
				activate()
				player.currentTime = 0
				player.play()
			},
			seek: { time in
				activate()
				player.currentTime = time
				player.play()
			},
			setMuted: { muted in
				player.volume = muted ? 0 : 1
			}
		)
	}()
}

private func makeLoopingPlayer() -> AVAudioPlayer {
	guard
		let url = Bundle.main.url(forResource: "LaunchIntroTheme", withExtension: "caf"),
		let player = try? AVAudioPlayer(contentsOf: url)
	else { preconditionFailure("LaunchIntroTheme.caf must ship in the app bundle") }
	player.numberOfLoops = -1
	player.prepareToPlay()
	return player
}

final class LaunchIntroVideoContainerView: UIView {
	override class var layerClass: AnyClass { AVPlayerLayer.self }

	var playerLayer: AVPlayerLayer {
		guard let playerLayer = layer as? AVPlayerLayer else {
			preconditionFailure("layerClass is AVPlayerLayer")
		}
		return playerLayer
	}
}

struct LaunchIntroVideoView: UIViewRepresentable {
	let player: AVPlayer
	let backdrop: UIColor

	func makeUIView(context: Context) -> LaunchIntroVideoContainerView {
		let view = LaunchIntroVideoContainerView()
		view.backgroundColor = backdrop
		view.playerLayer.player = player
		view.playerLayer.videoGravity = .resizeAspectFill
		return view
	}

	func updateUIView(_ uiView: LaunchIntroVideoContainerView, context: Context) {
		uiView.backgroundColor = backdrop
	}
}

extension LaunchIntroOverlay {
	var backdropColor: UIColor {
		usesDarkBackdrop ? BrandColor.splashBackground : .white
	}
}

struct LaunchIntroOverlayView: View {
	@ObservedObject var model: LaunchIntroModel
	private let player: AVPlayer

	init(model: LaunchIntroModel) {
		self.model = model
		self.player = LaunchIntroOverlayView.makePlayer()
	}

	var body: some View {
		Group {
			if model.overlay.showsVideo {
				LaunchIntroVideoView(player: player, backdrop: model.overlay.backdropColor)
					.ignoresSafeArea()
					.background(
						Color(uiColor: model.overlay.backdropColor)
							.ignoresSafeArea()
							.transaction { $0.animation = nil }
					)
					.opacity(model.overlay.opacity)
					.animation(.easeOut(duration: LaunchIntro.fadeDuration), value: model.overlay.opacity)
					.contentShape(Rectangle())
					.onTapGesture { model.end(.skipped) }
					.onAppear {
						player.seek(to: .zero)
						player.play()
					}
					.onReceive(NotificationCenter.default.publisher(for: .AVPlayerItemDidPlayToEndTime)) { _ in
						model.end(.playedToEnd)
					}
					.onReceive(NotificationCenter.default.publisher(for: .AVPlayerItemFailedToPlayToEndTime)) { _ in
						model.end(.assetFailed)
					}
					.onChange(of: model.phase) { phase in
						guard phase == .fading else { return }
						Task { @MainActor in
							try? await Task.sleep(nanoseconds: UInt64(LaunchIntro.fadeDuration * 1_000_000_000))
							model.fadeCompleted()
						}
					}
					.task { await runWatchdog() }
			}
		}
	}

	private func runWatchdog() async {
		let assetSeconds = (try? await player.currentItem?.asset.load(.duration))?.seconds
		let timeout = (assetSeconds.map { $0.isFinite ? $0 : 0 } ?? 0) + LaunchIntro.watchdogSlack
		do {
			try await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
		} catch {
			return
		}
		model.end(.timedOut)
	}

	private static func makePlayer() -> AVPlayer {
		guard let url = Bundle.main.url(forResource: "LaunchIntro", withExtension: "mp4") else {
			preconditionFailure("LaunchIntro.mp4 must ship in the app bundle")
		}
		return AVPlayer(url: url)
	}
}

@MainActor
func makeLaunchIntroModel(reduceMotion: Bool) -> LaunchIntroModel {
	let group = TokenStore.resolvedAppGroupId
	guard let defaults = UserDefaults(suiteName: group) else {
		preconditionFailure("App Group \(group) is required for the launch intro")
	}
	return LaunchIntroModel(
		seen: LaunchIntroSeen(defaults: defaults),
		music: .system,
		mutePreference: IntroMutePreference(defaults: defaults),
		reduceMotion: reduceMotion,
		isLoggedIn: TokenStore().isLoggedIn
	)
}
