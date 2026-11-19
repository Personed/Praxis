fn main() {
    // ort-sys links the ONNX Runtime C++ objects: pull the C++ runtime on
    // unix (MSVC has no stdc++.lib; its runtime is linked automatically).
    match std::env::var("CARGO_CFG_TARGET_OS").as_deref() {
        Ok("macos") => println!("cargo:rustc-link-lib=dylib=c++"),
        Ok("windows") => {}
        Ok(_) => println!("cargo:rustc-link-lib=dylib=stdc++"),
        Err(_) => {}
    }
}
