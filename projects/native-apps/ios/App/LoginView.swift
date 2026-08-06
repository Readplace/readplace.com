import SwiftUI
import UIKit

struct LoginView: View {
	let session: AppSession
	/// Owned by `RootView`, the app's auth-state root, so a failed Login or Sign up
	/// message outlives any remount of this screen.
	@Binding var authErrorText: String?
	/// Injected so the composition point wires the live auth-session flow and tests
	/// capture the started request; there is deliberately no internal default.
	let makeFlow: @MainActor (AppSession) -> WebAuthFlow
	@ObservedObject var intro: LaunchIntroModel
	@State private var cosmicSeed = UInt64.random(in: .min ... .max)
	/// Disables both buttons while an auth sheet is up, so a second tap can't
	/// start a competing session (whose `start()` would be refused and surface a
	/// spurious error under the live sheet).
	@State private var isAuthenticating = false

	var body: some View {
		NavigationStack {
			GeometryReader { geo in
				ZStack {
					Color.clear
						.contentShape(Rectangle())
						.onTapGesture { toggleMute() }

					VStack(spacing: 28) {
						CosmicWavesView(zone: .aboveBrand, seed: cosmicSeed)
							.frame(height: topGap(geo))

						VStack(spacing: 10) {
							brandMark
							(Text("Read") + Text("place").foregroundColor(.brandHighlight))
								.font(.largeTitle.bold())
								.allowsHitTesting(false)
							Text("The #1 Web Reader")
								.font(.subheadline)
								.foregroundStyle(.secondary)
								.allowsHitTesting(false)
						}

						VStack(spacing: 14) {
							Button {
								Task { await startLogin() }
							} label: {
								Label("Login", systemImage: "rectangle.portrait.and.arrow.right")
									.font(.headline)
									.frame(maxWidth: .infinity)
									.padding(.vertical, 14)
							}
							.buttonStyle(.borderedProminent)

							Button {
								Task { await startSignup() }
							} label: {
								Label("Sign up", systemImage: "person.badge.plus")
									.font(.headline)
									.frame(maxWidth: .infinity)
									.padding(.vertical, 14)
							}
							.buttonStyle(.bordered)
						}
						.disabled(isAuthenticating)

						if let authErrorText {
							Text(authErrorText)
								.font(.footnote)
								.foregroundStyle(Color.brandError)
								.multilineTextAlignment(.center)
								.allowsHitTesting(false)
						}

						CosmicWavesView(zone: .belowActions, seed: cosmicSeed)

						footer
					}
					.padding(24)
				}
				.overlay(alignment: .bottomTrailing) {
					muteButton.padding(20)
				}
				.background(Color.white.ignoresSafeArea())
			}
			.preferredColorScheme(.light)
		}
	}

	private func topGap(_ geo: GeometryProxy) -> CGFloat {
		let markCenter = LaunchIntro.logoScreenFraction * UIScreen.main.bounds.height
		let markTop = markCenter - BrandMarkGeometry.side / 2
		return max(0, markTop - geo.frame(in: .global).minY - contentPadding - stackSpacing)
	}

	private let contentPadding: CGFloat = 24
	private let stackSpacing: CGFloat = 28

	private var brandMark: some View {
		Image("BrandMark")
			.resizable()
			.scaledToFit()
			.frame(width: BrandMarkGeometry.side, height: BrandMarkGeometry.side)
			.accessibilityHidden(true)
			.allowsHitTesting(false)
			.overlay(alignment: .topLeading) {
				Circle()
					.fill(Color.clear)
					.contentShape(Circle())
					.frame(width: BrandMarkGeometry.tapDiameter, height: BrandMarkGeometry.tapDiameter)
					.offset(
						x: BrandMarkGeometry.dot.x - BrandMarkGeometry.tapDiameter / 2,
						y: BrandMarkGeometry.dot.y - BrandMarkGeometry.tapDiameter / 2
					)
					.onTapGesture { replayIntro() }
					.accessibilityLabel("Replay intro")
					.accessibilityAddTraits(.isButton)
			}
	}

	private var footer: some View {
		HStack(spacing: 8) {
			Link("Privacy Policy", destination: AppConfig.privacyPolicyURL)
			Text("·").allowsHitTesting(false)
			Button("Replay intro") { replayIntro() }
				.buttonStyle(.plain)
		}
		.font(.footnote)
		.foregroundStyle(.secondary)
	}

	private var muteButton: some View {
		Button {
			toggleMute()
		} label: {
			Image(systemName: intro.isMuted ? "speaker.slash.fill" : "speaker.wave.2.fill")
				.font(.system(size: 18, weight: .semibold))
				.foregroundStyle(.white)
				.frame(width: 44, height: 44)
				.background(Circle().fill(Color.gray.opacity(0.55)))
		}
		.buttonStyle(.plain)
		.accessibilityLabel(intro.isMuted ? "Unmute music" : "Mute music")
	}

	@MainActor
	func startLogin() async {
		await authenticate(with: session.makeOAuth().makeNativeLoginAuthorizationRequest())
	}

	@MainActor
	func startSignup() async {
		await authenticate(with: session.makeOAuth().makeSignupAuthorizationRequest())
	}

	/// Clears the previous attempt's message, runs the attempt, and reports only a
	/// genuine failure — the flow answers `nil` when the user dismissed the sheet.
	@MainActor
	private func authenticate(with request: AuthorizationRequest) async {
		authErrorText = nil
		isAuthenticating = true
		let outcome = await makeFlow(session).start(request)
		isAuthenticating = false
		guard case .failure(let error)? = outcome else { return }
		authErrorText = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
	}

	@MainActor
	func replayIntro() {
		intro.replay()
	}

	@MainActor
	func toggleMute() {
		intro.toggleMute()
	}
}

enum BrandMarkGeometry {
	static let side: CGFloat = 72
	static let tapDiameter: CGFloat = 26

	private static let viewBox: CGFloat = 512
	private static let dotCenter = CGPoint(x: 353, y: 182)

	static let dot = CGPoint(
		x: dotCenter.x / viewBox * side,
		y: dotCenter.y / viewBox * side
	)
}
