fn main() -> Result<(), Box<dyn std::error::Error>> {
    let files = [
        "../browser-worker/protocol/worker.proto",
        "../user-browser/protocol/user_browser.proto",
    ];
    tonic_prost_build::configure()
        .build_server(true)
        .server_mod_attribute(".", "#[cfg(test)]")
        .compile_protos(&files, &[".."])?;
    for file in files {
        println!("cargo:rerun-if-changed={file}");
    }
    Ok(())
}
