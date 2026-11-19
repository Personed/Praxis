use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::Manager;

struct SidecarState {
  child: Mutex<Option<Child>>,
}

fn random_token() -> String {
  // 24 random bytes as hex without extra deps: hash several entropy sources.
  use std::collections::hash_map::DefaultHasher;
  use std::hash::{Hash, Hasher};
  let mut out = String::new();
  for i in 0..6 {
    let mut h = DefaultHasher::new();
    std::process::id().hash(&mut h);
    std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .unwrap_or_default()
      .hash(&mut h);
    (i as u64).hash(&mut h);
    std::thread::current().id().hash(&mut h);
    out.push_str(&format!("{:016x}", h.finish()));
  }
  out.truncate(48);
  out
}

/// Spawn `node out/sidecar/index.js` and read the `MODUS_RPC_READY <port>` line.
fn spawn_sidecar() -> Result<(Child, u16, String), Box<dyn std::error::Error>> {
  let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
  // src-tauri -> desktop -> apps -> repo root (for service binary lookups like pty-host).
  let repo_root = manifest.join("../../..").canonicalize()?;
  let sidecar = manifest.join("../out/sidecar/index.js").canonicalize()?;
  let token = random_token();

  let mut child = Command::new("node")
    .arg(&sidecar)
    .current_dir(&repo_root)
    .env("MODUS_RPC_TOKEN", &token)
    .env("MODUS_RPC_PORT", "0")
    .stdout(Stdio::piped())
    .stderr(Stdio::inherit())
    .spawn()?;

  let mut port = 0u16;
  if let Some(stdout) = child.stdout.take() {
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    loop {
      line.clear();
      if reader.read_line(&mut line)? == 0 {
        break;
      }
      print!("[sidecar] {}", line);
      if let Some(rest) = line.trim().strip_prefix("MODUS_RPC_READY ") {
        port = rest.trim().parse().unwrap_or(0);
        break;
      }
      if std::time::Instant::now() > deadline {
        break;
      }
    }
    // Keep draining sidecar logs in the background.
    std::thread::spawn(move || {
      let mut l = String::new();
      while reader.read_line(&mut l).map(|n| n > 0).unwrap_or(false) {
        print!("[sidecar] {}", l);
        l.clear();
      }
    });
  }
  if port == 0 {
    return Err("sidecar did not report an RPC port".into());
  }
  Ok((child, port, token))
}

/// Serve the renderer over real HTTP on 127.0.0.1 — the opaque `tauri://`
/// scheme breaks WebSocket and localStorage in WebKitGTK.
fn serve_frontend() -> Result<u16, Box<dyn std::error::Error>> {
  let dist = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
    .join("../out/renderer-web")
    .canonicalize()?;
  let server = tiny_http::Server::http("127.0.0.1:0")
    .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
  let port = server
    .server_addr()
    .to_ip()
    .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::Other, "no listen addr"))?
    .port();

  std::thread::spawn(move || {
    for request in server.incoming_requests() {
      let root = dist.clone();
      std::thread::spawn(move || {
        let url = request.url().split('?').next().unwrap_or("/").to_string();
        let rel = if url == "/" { "/index.html".to_string() } else { url };
        // Prevent path traversal.
        let rel = rel.trim_start_matches('/');
        if rel.contains("..") {
          let _ = request.respond(
            tiny_http::Response::from_string("forbidden").with_status_code(403),
          );
          return;
        }
        let path = root.join(rel);
        // SPA fallback for clean paths without an extension.
        let path = if path.exists() { path } else { root.join("index.html") };
        let mime = match path.extension().and_then(|e| e.to_str()) {
          Some("html") => "text/html; charset=utf-8",
          Some("js") | Some("mjs") => "text/javascript; charset=utf-8",
          Some("css") => "text/css; charset=utf-8",
          Some("svg") => "image/svg+xml",
          Some("png") => "image/png",
          Some("jpg") | Some("jpeg") => "image/jpeg",
          Some("webp") => "image/webp",
          Some("ico") => "image/x-icon",
          Some("woff") => "font/woff",
          Some("woff2") => "font/woff2",
          Some("json") => "application/json",
          Some("wasm") => "application/wasm",
          Some("ttf") => "font/ttf",
          Some("otf") => "font/otf",
          Some("map") => "application/json",
          _ => "application/octet-stream",
        };
        match std::fs::File::open(&path) {
          Ok(file) => {
            let response = tiny_http::Response::from_file(file)
              .with_header(tiny_http::Header::from_bytes("Content-Type", mime).unwrap());
            let _ = request.respond(response);
          }
          Err(_) => {
            let _ = request.respond(
              tiny_http::Response::from_string("not found").with_status_code(404),
            );
          }
        }
      });
    }
  });
  Ok(port)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .runtime(tauri_runtime_wry::Wry::default())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let (child, port, token) = spawn_sidecar()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
      app.manage(SidecarState {
        child: Mutex::new(Some(child)),
      });

      // Inject the sidecar connection + environment before any page script runs.
      let init_script = format!(
        "window.__MODUS_RPC__={{port:{},token:{}}};window.__MODUS_ENV__={{platform:{},systemVersion:{},argv:[]}};",
        port,
        serde_json::to_string(&token).unwrap_or_else(|_| "\"\"".into()),
        serde_json::to_string(std::env::consts::OS).unwrap_or_else(|_| "\"linux\"".into()),
        serde_json::to_string("").unwrap_or_else(|_| "\"\"".into()),
      );
      let frontend_port = serve_frontend()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
      let webview_url = tauri::WebviewUrl::External(
        format!("http://127.0.0.1:{}/", frontend_port).parse().unwrap(),
      );
      tauri::WebviewWindowBuilder::new(app, "main", webview_url)
        .title("Modus")
        .inner_size(1440.0, 900.0)
        .resizable(true)
        .initialization_script(&init_script)
        .build()?;
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app_handle, event| {
      if matches!(event, tauri::RunEvent::Exit) {
        if let Some(state) = app_handle.try_state::<SidecarState>() {
          if let Some(mut child) = state.child.lock().unwrap().take() {
            let _ = child.kill();
          }
        }
      }
    });
}
