use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;

struct SidecarState {
  child: Mutex<Option<Child>>,
}

struct UpdateStateStore(Mutex<serde_json::Value>);

const RELEASE_PAGE: &str = "https://github.com/Personed/Praxis/releases/latest";

fn emit_update_state(app: &tauri::AppHandle, state: serde_json::Value) {
  use tauri::Emitter;
  if let Some(store) = app.try_state::<UpdateStateStore>() {
    *store.0.lock().unwrap() = state.clone();
  }
  let _ = app.emit("update:state-event", state);
}

#[tauri::command]
fn modus_update_get_state(state: tauri::State<'_, UpdateStateStore>) -> serde_json::Value {
  state.0.lock().unwrap().clone()
}

#[tauri::command]
async fn modus_update_check(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
  emit_update_state(&app, serde_json::json!({ "status": "checking" }));
  let state = match app.updater() {
    Ok(updater) => match updater.check().await {
      Ok(Some(update)) => {
        let dismissed = app
          .try_state::<UpdateStateStore>()
          .and_then(|s| s.0.lock().unwrap().get("dismissed").cloned())
          .and_then(|v| v.as_str().map(str::to_owned));
        if dismissed.as_deref() == Some(update.version.as_str()) {
          serde_json::json!({ "status": "idle" })
        } else {
          serde_json::json!({
            "status": "available",
            "version": update.version,
            "action": "install",
          })
        }
      },
      Ok(None) => serde_json::json!({ "status": "idle" }),
      Err(e) => serde_json::json!({
        "status": "failed",
        "version": "",
        "retryable": true,
        "action": "install",
        "error": e.to_string(),
      }),
    },
    Err(e) => serde_json::json!({
      "status": "failed",
      "version": "",
      "retryable": false,
      "action": "download-page",
      "error": e.to_string(),
    }),
  };
  emit_update_state(&app, state.clone());
  Ok(state)
}

#[tauri::command]
async fn modus_update_install(app: tauri::AppHandle) -> Result<(), String> {
  let updater = app.updater().map_err(|e| e.to_string())?;
  let update = updater
    .check()
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "no update available".to_string())?;
  let version = update.version.clone();
  let app2 = app.clone();
  update
    .download_and_install(
      move |chunk, total| {
        let percent = total
          .filter(|t| *t > 0)
          .map(|t| (chunk as f64 / t as f64) * 100.0)
          .unwrap_or(0.0);
        emit_update_state(
          &app2,
          serde_json::json!({ "status": "downloading", "version": version, "percent": percent }),
        );
      },
      {
        let app3 = app.clone();
        let version = update.version.clone();
        move || {
          emit_update_state(
            &app3,
            serde_json::json!({ "status": "ready", "version": version }),
          );
        }
      },
    )
    .await
    .map_err(|e| {
      emit_update_state(
        &app,
        serde_json::json!({
          "status": "failed", "version": update.version,
          "retryable": true, "action": "install", "error": e.to_string(),
        }),
      );
      e.to_string()
    })?;
  Ok(())
}

#[tauri::command]
fn modus_update_dismiss(app: tauri::AppHandle) {
  if let Some(store) = app.try_state::<UpdateStateStore>() {
    let mut state = store.0.lock().unwrap();
    let version = state.get("version").cloned();
    if let Some(v) = version {
      state.as_object_mut().unwrap().insert("dismissed".into(), v);
    }
    *state = serde_json::json!({ "status": "idle", "dismissed": state.get("dismissed").cloned().unwrap_or(serde_json::Value::Null) });
  }
}

#[tauri::command]
fn modus_update_restart(app: tauri::AppHandle) {
  app.restart();
}

#[tauri::command]
fn modus_update_open_release() {
  let opener = if cfg!(target_os = "macos") {
    "open"
  } else if cfg!(target_os = "windows") {
    "explorer"
  } else {
    "xdg-open"
  };
  let _ = Command::new(opener).arg(RELEASE_PAGE).spawn();
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

/// Packaged layout staged by scripts/stage-bundle-bin.mjs: <resources>/bin holds
/// node + the Rust service binaries, <resources>/sidecar/index.js and
/// <resources>/renderer/ the app files. Returns None in dev.
fn resource_root(app: &tauri::App) -> Option<std::path::PathBuf> {
  use tauri::Manager;
  app.path()
    .resource_dir()
    .ok()
    .filter(|dir| dir.join("sidecar").join("index.js").exists())
}

/// Spawn `node out/sidecar/index.js` and read the `MODUS_RPC_READY <port>` line.
fn spawn_sidecar(app: &tauri::App) -> Result<(Child, u16, String), Box<dyn std::error::Error>> {
  let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
  // src-tauri -> desktop -> apps -> repo root (for service binary lookups like pty-host).
  let repo_root = manifest.join("../../..").canonicalize()?;
  let token = random_token();

  let mut command = if let Some(res) = resource_root(app) {
    let node = res.join("bin").join(if cfg!(windows) { "node.exe" } else { "node" });
    let mut cmd = Command::new(node);
    cmd.arg(res.join("sidecar").join("index.js"))
      .current_dir(&res)
      .env("MODUS_RESOURCES_PATH", &res);
    cmd
  } else {
    let sidecar = manifest.join("../out/sidecar/index.js").canonicalize()?;
    let mut cmd = Command::new("node");
    cmd.arg(&sidecar).current_dir(&repo_root);
    cmd
  };

  let mut child = command
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
fn serve_frontend(app: &tauri::App) -> Result<u16, Box<dyn std::error::Error>> {
  let dist = match resource_root(app) {
    Some(res) => res.join("renderer"),
    None => std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
      .join("../out/renderer-web")
      .canonicalize()?,
  };
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
      app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
      app.handle().plugin(tauri_plugin_process::init())?;
      app.manage(UpdateStateStore(Mutex::new(serde_json::json!({ "status": "idle" }))));

      let (child, port, token) = spawn_sidecar(app)
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
      let frontend_port = serve_frontend(app)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
      let webview_url = tauri::WebviewUrl::External(
        format!("http://127.0.0.1:{}/", frontend_port).parse().unwrap(),
      );
      let window = tauri::WebviewWindowBuilder::new(app, "main", webview_url)
        .title("Modus")
        .inner_size(1440.0, 900.0)
        .resizable(true)
        .initialization_script(&init_script)
        .build()?;
      // Standard OS menu (App/Edit/View/Window/Help) — OS-localized predefined
      // items, restores the accelerators the Electron Menu provided.
      let menu = tauri::menu::Menu::default(&app.handle())?;
      window.set_menu(menu)?;
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      modus_update_get_state,
      modus_update_check,
      modus_update_install,
      modus_update_dismiss,
      modus_update_restart,
      modus_update_open_release,
    ])
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
