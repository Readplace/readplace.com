import Foundation

enum OfflineCopy {
	static func isShowable(dateHeader: String?, now: Date) -> Bool {
		guard let dateHeader, let dated = httpDate.date(from: dateHeader) else { return false }
		return now.timeIntervalSince(dated) <= maximumAge
	}

	private static let maximumAge: TimeInterval = 30 * 24 * 60 * 60

	private static let httpDate: DateFormatter = {
		let formatter = DateFormatter()
		formatter.locale = Locale(identifier: "en_US_POSIX")
		formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
		return formatter
	}()
}
