fn main() {
    println!("cargo:rerun-if-env-changed=AI_VIDEO_RELEASE_API_BASE_URL");
    if std::env::var("PROFILE").as_deref() == Ok("release") {
        let configured = std::env::var("AI_VIDEO_RELEASE_API_BASE_URL").unwrap_or_default();
        assert!(
            configured.starts_with("https://") && !configured.trim().is_empty(),
            "Release DMG requires AI_VIDEO_RELEASE_API_BASE_URL with a public HTTPS API base"
        );
    }
    tauri_build::build()
}
