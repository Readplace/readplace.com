pluginManagement {
	repositories {
		google {
			content {
				includeGroupByRegex("com\\.android.*")
				includeGroupByRegex("com\\.google.*")
				includeGroupByRegex("androidx.*")
			}
		}
		mavenCentral()
		gradlePluginPortal()
	}
}

dependencyResolutionManagement {
	repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
	repositories {
		google()
		mavenCentral()
	}
}

rootProject.name = "readplace-android-poc"

// The shared logic lives in a standalone Kotlin/JVM build (no Android deps) so it
// builds and tests on a plain JDK. The app consumes it through dependency
// substitution: `implementation("com.readplace.poc:readplace-core")` resolves here.
includeBuild("core")

include(":app")
