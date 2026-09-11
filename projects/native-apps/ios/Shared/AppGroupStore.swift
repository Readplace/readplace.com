import Foundation

protocol AppGroupValue: Codable {
	static var fileName: String { get }
	static var unwritten: Self { get }
}

struct AppGroupContainer {
	let url: URL

	static func entitled(appGroupId: String) -> AppGroupContainer? {
		FileManager.default
			.containerURL(forSecurityApplicationGroupIdentifier: appGroupId)
			.map(AppGroupContainer.init(url:))
	}
}

struct AppGroupStore<Value: AppGroupValue> {
	private let url: URL

	init(container: AppGroupContainer) {
		url = container.url
			.appendingPathComponent("Library/Application Support", isDirectory: true)
			.appendingPathComponent(Value.fileName, isDirectory: false)
	}

	var stored: Value { read() ?? .unwritten }

	func update(_ transform: (Value) -> Value) {
		let next = transform(stored)
		try? FileManager.default.createDirectory(
			at: url.deletingLastPathComponent(), withIntermediateDirectories: true
		)
		try? JSONEncoder().encode(next).write(to: url, options: .atomic)
	}

	func adoptingLegacy(_ legacy: () -> Value?) -> Self {
		guard read() == nil, let adopted = legacy() else { return self }
		update { _ in adopted }
		return self
	}

	private func read() -> Value? {
		guard let data = try? Data(contentsOf: url) else { return nil }
		return try? JSONDecoder().decode(Value.self, from: data)
	}
}
