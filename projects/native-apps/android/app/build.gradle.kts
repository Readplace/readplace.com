plugins {
	alias(libs.plugins.android.application)
	alias(libs.plugins.kotlin.compose)
	alias(libs.plugins.kotlin.serialization)
	jacoco
}

android {
	namespace = "com.readplace.android"
	compileSdk = 36

	defaultConfig {
		applicationId = "com.readplace.android"
		minSdk = 29
		targetSdk = 36
		versionCode = 1
		versionName = "1.0.0"
	}

	/**
	 * The environment is a build-time constant, exactly like the iOS app's
	 * `#if STAGING`: there is no runtime server field to mis-set, and the staging
	 * build replaces the production one on a device because both carry the same
	 * applicationId. A flavor rather than a build type because the environment is
	 * orthogonal to debug/release, and because it gives `testStagingDebugUnitTest`
	 * a real staging BuildConfig to pin.
	 */
	flavorDimensions += "server"
	productFlavors {
		create("production") {
			dimension = "server"
			buildConfigField("String", "SERVER_BASE_URL", "\"https://readplace.com\"")
			buildConfigField("String", "SERVER_ENVIRONMENT", "\"production\"")
		}
		create("staging") {
			dimension = "server"
			buildConfigField(
				"String",
				"SERVER_BASE_URL",
				"\"https://hkncrxpii6.execute-api.ap-southeast-2.amazonaws.com\"",
			)
			buildConfigField("String", "SERVER_ENVIRONMENT", "\"staging\"")
		}
		// A hutch dev server on the Mac, reached through `adb reverse tcp:3000 tcp:3000`
		// so the device's localhost IS the Mac's. Cleartext is opened for localhost only,
		// in this flavor's own manifest overlay, so production and staging stay strict.
		create("local") {
			dimension = "server"
			buildConfigField("String", "SERVER_BASE_URL", "\"http://localhost:3000\"")
			buildConfigField("String", "SERVER_ENVIRONMENT", "\"local\"")
		}
	}

	buildFeatures {
		compose = true
		buildConfig = true
	}

	compileOptions {
		sourceCompatibility = JavaVersion.VERSION_17
		targetCompatibility = JavaVersion.VERSION_17
	}

	testOptions {
		unitTests {
			isIncludeAndroidResources = true
		}
	}

}

dependencies {
	implementation(libs.compose.ui)
	implementation(libs.compose.foundation)
	implementation(libs.compose.material3)
	implementation(libs.androidx.activity.compose)
	implementation(libs.androidx.lifecycle.runtime.compose)
	implementation(libs.androidx.browser)
	implementation(libs.coil.compose)
	implementation(libs.coil.network.okhttp)
	implementation(libs.kotlinx.coroutines.android)
	implementation(libs.kotlinx.serialization.json)
	implementation(libs.okhttp)
	implementation(libs.media3.exoplayer)
	implementation(libs.media3.ui)

	testImplementation(libs.junit)
	testImplementation(libs.robolectric)
	testImplementation(libs.okhttp.mockwebserver)
	testImplementation(libs.kotlinx.coroutines.test)
}

/**
 * XML report only: `scripts/check-coverage.py` reads it, and the HTML report costs
 * build time nothing reads. Wired to the production debug variant so the ratchet
 * measures the shipping configuration, mirroring the iOS gate.
 */
tasks.register<JacocoReport>("jacocoTestReport") {
	dependsOn("testProductionDebugUnitTest")
	reports {
		xml.required.set(true)
		html.required.set(false)
	}
	sourceDirectories.setFrom(files("src/main/kotlin"))
	classDirectories.setFrom(
		fileTree(layout.buildDirectory) {
			include("intermediates/built_in_kotlinc/productionDebug/**/classes/**")
			// Compose emits synthetic lambda classes whose lines belong to the layout
			// file that declared them, and BuildConfig/R are generated — neither is a
			// decision anything can test, and counting them would ratchet a layout
			// file's floor onto a logic file's report.
			exclude("**/BuildConfig.*", "**/R.class", "**/R$*.class")
		},
	)
	executionData.setFrom(
		fileTree(layout.buildDirectory) { include("jacoco/testProductionDebugUnitTest.exec") },
	)
}
