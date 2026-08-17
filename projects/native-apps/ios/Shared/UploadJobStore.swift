import Foundation

struct UploadJobStore {
	private let directory: URL

	init(containerURL: URL) {
		directory = containerURL.appendingPathComponent("Library/Application Support/upload-queue", isDirectory: true)
	}

	static func inSharedContainer(appGroupId: String) -> UploadJobStore? {
		FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId).map(UploadJobStore.init(containerURL:))
	}

	func bytesURL(for job: UploadJob) -> URL {
		directory.appendingPathComponent("\(job.id).multipart")
	}

	func admit(_ job: UploadJob) async throws {
		try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
		for superseded in decodedRecords() where superseded.url == job.url {
			remove(superseded)
		}
		try write(job)
	}

	func stageReady(_ job: UploadJob, form: MultipartForm) async throws -> UploadJob {
		try form.write(to: bytesURL(for: job))
		let ready = job.staged(contentType: form.contentType)
		try write(ready)
		return ready
	}

	func update(_ job: UploadJob) throws {
		try write(job)
	}

	func loadAll(now: Date) -> [UploadJob] {
		decodedRecords()
			.filter { $0.isDue(now: now) }
			.sorted { $0.createdAt < $1.createdAt }
	}

	func remove(_ job: UploadJob) {
		try? FileManager.default.removeItem(at: recordURL(for: job))
		try? FileManager.default.removeItem(at: bytesURL(for: job))
	}

	func removeOrphanedBytes() {
		let recorded = Set(files(withExtension: "json").map { $0.deletingPathExtension().lastPathComponent })
		for body in files(withExtension: "multipart")
		where !recorded.contains(body.deletingPathExtension().lastPathComponent) {
			try? FileManager.default.removeItem(at: body)
		}
	}

	func purgeAll() {
		try? FileManager.default.removeItem(at: directory)
	}

	private func recordURL(for job: UploadJob) -> URL {
		directory.appendingPathComponent("\(job.id).json")
	}

	private func write(_ job: UploadJob) throws {
		try JSONEncoder().encode(job).write(to: recordURL(for: job), options: .atomic)
	}

	private func decodedRecords() -> [UploadJob] {
		let decoder = JSONDecoder()
		return files(withExtension: "json").compactMap { record in
			guard let data = try? Data(contentsOf: record) else { return nil }
			return try? decoder.decode(UploadJob.self, from: data)
		}
	}

	private func files(withExtension pathExtension: String) -> [URL] {
		let entries = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
		return entries.filter { $0.pathExtension == pathExtension }
	}
}
