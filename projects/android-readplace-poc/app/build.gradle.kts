plugins {
	id("com.android.application")
	id("org.jetbrains.kotlin.android")
	id("org.jetbrains.kotlin.plugin.compose")
}

android {
	namespace = "com.readplace.poc"
	compileSdk = 35

	defaultConfig {
		applicationId = "com.readplace.poc"
		// API 26 lets the shared core use java.time, java.util.Base64, and adaptive icons without desugaring.
		minSdk = 26
		targetSdk = 35
		versionCode = 1
		versionName = "0.1.0"
	}

	buildTypes {
		release {
			isMinifyEnabled = false
			proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
		}
	}

	compileOptions {
		sourceCompatibility = JavaVersion.VERSION_17
		targetCompatibility = JavaVersion.VERSION_17
	}

	kotlinOptions {
		jvmTarget = "17"
	}

	buildFeatures {
		compose = true
	}
}

dependencies {
	// The shared, platform-free logic. `includeBuild("core")` substitutes these
	// coordinates with the local build; the version matches core's for clarity.
	implementation("com.readplace.poc:readplace-core:0.1.0")

	implementation("androidx.core:core-ktx:1.13.1")
	implementation("androidx.activity:activity-compose:1.9.3")
	// Custom Tabs: the analogue of the iOS POC's in-app SafariView for opening articles.
	implementation("androidx.browser:browser:1.8.0")
	implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
	implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
	implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
	implementation("com.google.android.material:material:1.12.0")
	implementation("io.coil-kt:coil-compose:2.7.0")

	val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
	implementation(composeBom)
	implementation("androidx.compose.ui:ui")
	implementation("androidx.compose.ui:ui-graphics")
	implementation("androidx.compose.ui:ui-tooling-preview")
	implementation("androidx.compose.material3:material3")
	implementation("androidx.compose.material:material-icons-extended")
	debugImplementation("androidx.compose.ui:ui-tooling")
}
