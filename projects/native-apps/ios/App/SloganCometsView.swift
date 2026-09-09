import SwiftUI

enum LoginLandmark: Hashable {
	case sky
	case subtitle
}

struct LoginLandmarksKey: PreferenceKey {
	static let defaultValue: [LoginLandmark: CGRect] = [:]

	static func reduce(value: inout [LoginLandmark: CGRect], nextValue: () -> [LoginLandmark: CGRect]) {
		for (landmark, frame) in nextValue() {
			value[landmark] = frame
		}
	}
}

extension View {
	func loginLandmark(_ landmark: LoginLandmark) -> some View {
		background(
			GeometryReader { geometry in
				Color.clear.preference(key: LoginLandmarksKey.self, value: [landmark: geometry.frame(in: .global)])
			}
		)
	}
}

func skyVisits(handoff: SloganHandoff?, landmarks: [LoginLandmark: CGRect]) -> [StarVisit] {
	guard let handoff, let sky = landmarks[.sky] else { return [] }
	return [handoff.visit(sky: sky)]
}

func loginComet(
	handoff: SloganHandoff?,
	landmarks: [LoginLandmark: CGRect],
	seed: UInt64,
	screenSize: CGSize,
	elapsed: TimeInterval
) -> SloganComet {
	guard let handoff, let sky = landmarks[.sky], let subtitle = landmarks[.subtitle] else { return .idle }
	let field = CosmicWaveField(seed: seed, zone: .aboveBrand)
	return handoff.comet(
		at: elapsed,
		subtitleCenter: CGPoint(x: subtitle.midX, y: subtitle.midY),
		sky: sky,
		launch: field.visitHead(handoff.visit(sky: sky), zoneFrame: sky, screenSize: screenSize)
	)
}

struct SloganCometsView: View {
	let handoff: SloganHandoff?
	let clock: WaveClock
	let seed: UInt64
	let landmarks: [LoginLandmark: CGRect]
	let screenSize: CGSize
	let paused: Bool
	let reduceMotion: Bool

	var body: some View {
		GeometryReader { geometry in
			let origin = geometry.frame(in: .global).origin
			if reduceMotion {
				Color.clear
			} else {
				TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: paused)) { timeline in
					Canvas { context, _ in
						let comet = loginComet(
							handoff: handoff,
							landmarks: landmarks,
							seed: seed,
							screenSize: screenSize,
							elapsed: clock.elapsed(at: timeline.date)
						)
						context.translateBy(x: -origin.x, y: -origin.y)
						drawFilaments(comet.strokes, in: &context)
						if let head = comet.head {
							drawStarHead(head, in: &context)
						}
					}
				}
			}
		}
		.allowsHitTesting(false)
		.accessibilityHidden(true)
	}
}

func drawStarHead(_ head: StarHead, in context: inout GraphicsContext) {
	let color = head.hue.starColor
	context.fill(
		Path(ellipseIn: square(around: head.center, radius: head.glowRadius)),
		with: .radialGradient(
			Gradient(colors: [color.opacity(head.opacity * 0.7), color.opacity(0)]),
			center: head.center,
			startRadius: 0,
			endRadius: head.glowRadius
		)
	)
	context.fill(
		Path(ellipseIn: square(around: head.center, radius: head.coreRadius)),
		with: .color(color.opacity(head.opacity))
	)
}

private func square(around center: CGPoint, radius: Double) -> CGRect {
	CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)
}
