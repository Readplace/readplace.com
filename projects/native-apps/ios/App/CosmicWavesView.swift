import SwiftUI
import UIKit

struct CosmicWavesView: View {
	let zone: CosmicZone
	let seed: UInt64
	@Environment(\.accessibilityReduceMotion) private var reduceMotion
	@Environment(\.scenePhase) private var scenePhase

	var body: some View {
		GeometryReader { geometry in
			CosmicWavesLayer(
				zone: zone,
				seed: seed,
				zoneFrame: geometry.frame(in: .global),
				screenSize: UIScreen.main.bounds.size,
				reduceMotion: reduceMotion,
				paused: scenePhase != .active
			)
		}
	}
}

struct CosmicWavesLayer: View {
	let zone: CosmicZone
	let seed: UInt64
	let zoneFrame: CGRect
	let screenSize: CGSize
	let reduceMotion: Bool
	let paused: Bool
	@State private var clock: WaveClock

	init(
		zone: CosmicZone,
		seed: UInt64,
		zoneFrame: CGRect,
		screenSize: CGSize,
		reduceMotion: Bool,
		paused: Bool
	) {
		self.zone = zone
		self.seed = seed
		self.zoneFrame = zoneFrame
		self.screenSize = screenSize
		self.reduceMotion = reduceMotion
		self.paused = paused
		_clock = State(initialValue: WaveClock(accumulated: 0, resumedAt: paused ? nil : Date()))
	}

	var body: some View {
		filamentCanvas
			.mask(fadeGradient(fade: zone.horizontalFade, startPoint: .leading, endPoint: .trailing))
			.mask(fadeGradient(fade: zone.verticalFade, startPoint: .top, endPoint: .bottom))
			.clipped()
			.frame(maxWidth: .infinity, maxHeight: .infinity)
			.allowsHitTesting(false)
			.accessibilityHidden(true)
			.onChange(of: paused) { isPaused in
				clock = isPaused ? clock.pausing(at: Date()) : clock.resuming(at: Date())
			}
	}

	@ViewBuilder private var filamentCanvas: some View {
		let field = CosmicWaveField(seed: seed, zone: zone)
		if reduceMotion {
			Canvas { context, _ in
				draw(
					strokes: field.staticStrokes(zoneFrame: zoneFrame, screenSize: screenSize),
					in: &context
				)
			}
		} else {
			TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: paused)) { timeline in
				Canvas { context, _ in
					let elapsed = clock.elapsed(at: timeline.date)
					draw(
						strokes: field.strokes(zoneFrame: zoneFrame, screenSize: screenSize, elapsed: elapsed),
						in: &context
					)
				}
			}
		}
	}

	private func draw(strokes: [FilamentStroke], in context: inout GraphicsContext) {
		for stroke in strokes {
			var path = Path()
			path.addLines(stroke.points)
			let shading = GraphicsContext.Shading.color(stroke.hue.color.opacity(stroke.opacity))
			let style = StrokeStyle(lineWidth: stroke.lineWidth, lineCap: .butt, lineJoin: .round)
			if stroke.blurRadius > 0 {
				context.drawLayer { layer in
					layer.addFilter(.blur(radius: stroke.blurRadius))
					layer.stroke(path, with: shading, style: style)
				}
			} else {
				context.stroke(path, with: shading, style: style)
			}
		}
	}

	private func fadeGradient(fade: EdgeFade, startPoint: UnitPoint, endPoint: UnitPoint) -> LinearGradient {
		LinearGradient(
			stops: [
				Gradient.Stop(color: .clear, location: 0),
				Gradient.Stop(color: .black, location: fade.leadIn),
				Gradient.Stop(color: .black, location: 1 - fade.leadOut),
				Gradient.Stop(color: .clear, location: 1),
			],
			startPoint: startPoint,
			endPoint: endPoint
		)
	}
}
