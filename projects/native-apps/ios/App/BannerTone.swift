import SwiftUI

enum BannerTone: Equatable {
	case offline
	case error
	case warning

	init(errorText: String) {
		self = errorText == OfflineReading.bannerText ? .offline : .error
	}

	var fill: Color {
		switch self {
		case .offline: return .brandSecondary
		case .error: return .brandError
		case .warning: return .brandWarning
		}
	}

	var ink: Color {
		self == .offline ? .brandTextPrimary : .white
	}

	var backdrop: Color {
		self == .offline ? .brandSurface : .clear
	}
}
