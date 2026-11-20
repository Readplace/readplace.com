import DeclaredAgeRange
import SwiftUI

extension AgeSignalSource {
	@available(iOS 26.2, *)
	static func system(_ requestAgeRange: DeclaredAgeRangeAction) -> AgeSignalSource {
		AgeSignalSource {
			guard (try? await AgeRangeService.shared.isEligibleForAgeFeatures) == true else { return .notApplicable }
			do {
				switch try await requestAgeRange(ageGates: 13, 16, 18) {
				case .declinedSharing:
					return .declined
				case .sharing(let range):
					return .known(AgeRange(lowerBound: range.lowerBound), .noneReported)
				@unknown default:
					return .notApplicable
				}
			} catch {
				return .notApplicable
			}
		}
	}
}

struct AgeGateReading: ViewModifier {
	let gate: AgeGate

	func body(content: Content) -> some View {
		if #available(iOS 26.2, *) {
			content.modifier(DeclaredAgeRangeReading(gate: gate))
		} else {
			content.task { await gate.settle(reading: .unavailable) }
		}
	}
}

@available(iOS 26.2, *)
private struct DeclaredAgeRangeReading: ViewModifier {
	@Environment(\.requestAgeRange) private var requestAgeRange
	let gate: AgeGate

	func body(content: Content) -> some View {
		content.task { await gate.settle(reading: .system(requestAgeRange)) }
	}
}
