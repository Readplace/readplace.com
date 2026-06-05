// `core` is a self-contained Kotlin/JVM build with no Android dependencies, so it
// compiles and its tests run on a plain JDK — no Android SDK required. The Android
// `app` build consumes it via `includeBuild("core")` (see ../settings.gradle.kts).
rootProject.name = "readplace-core"

dependencyResolutionManagement {
	repositories {
		mavenCentral()
	}
}
