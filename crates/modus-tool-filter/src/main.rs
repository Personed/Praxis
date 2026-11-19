//! Rust port of `src/main/local-models/tool-filter-worker.ts`.
//!
//! Speaks the same protocol as the JS worker, over newline-delimited JSON on
//! stdio: one `MainToWorker` message per stdin line, one `WorkerToMain` reply
//! per stdout line. Owns the ONNX Runtime session + tokenizer + embed cache
//! out of the sidecar process, just like the utilityProcess version.

use base64::Engine;
use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::Tensor;
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const EMBED_CACHE_FILE: &str = "embeddings.json";
const EMBED_CACHE_VERSION: u32 = 2;
const EMBED_CACHE_MAX_ENTRIES: usize = 2_000;
const DEFAULT_QUERY_MAX_LENGTH: usize = 160;
const DEFAULT_DOC_MAX_LENGTH: usize = 192;

#[derive(Deserialize)]
struct WorkerDoc {
    name: String,
    doc: String,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
enum Req {
    #[serde(rename = "probe")]
    Probe { id: i64 },
    #[serde(rename = "load")]
    Load {
        id: i64,
        dir: String,
        #[serde(default)]
        cache_dir: Option<String>,
        #[serde(default)]
        cache_identity: Option<String>,
        #[serde(default)]
        doc_max_length: Option<usize>,
        #[serde(default)]
        query_max_length: Option<usize>,
    },
    #[serde(rename = "warm")]
    Warm { id: i64, docs: Vec<WorkerDoc> },
    #[serde(rename = "select")]
    Select {
        id: i64,
        query: String,
        docs: Vec<WorkerDoc>,
        k: usize,
        budget_ms: f64,
    },
    #[serde(rename = "ping")]
    Ping { id: i64 },
    #[serde(rename = "stats")]
    Stats { id: i64 },
}

struct LocalModelError {
    code: &'static str,
    message: String,
}

impl LocalModelError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }
}

fn rss_bytes() -> u64 {
    #[cfg(unix)]
    unsafe {
        let mut usage: libc::rusage = std::mem::zeroed();
        if libc::getrusage(libc::RUSAGE_SELF, &mut usage) == 0 {
            let kb = usage.ru_maxrss as u64;
            #[cfg(target_os = "macos")]
            return kb; // macOS reports bytes already
            #[cfg(not(target_os = "macos"))]
            return kb * 1024;
        }
    }
    #[cfg(not(unix))]
    return 0;
    #[cfg(unix)]
    0
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn sha256_hex(text: &str) -> String {
    let mut h = Sha256::new();
    h.update(text.as_bytes());
    format!("{:x}", h.finalize())
}

// ---- embed cache (same on-disk format as embed-cache.ts) ----

struct EmbedCache {
    path: PathBuf,
    identity: String,
    dim: usize,
    entries: HashMap<String, (Vec<f32>, u64)>,
    dirty: bool,
}

impl EmbedCache {
    fn load(dir: &Path, identity: &str, dim: usize) -> (Self, usize) {
        let mut cache = Self {
            path: dir.join(EMBED_CACHE_FILE),
            identity: identity.to_string(),
            dim,
            entries: HashMap::new(),
            dirty: false,
        };
        let raw = match fs::read_to_string(&cache.path) {
            Ok(raw) => raw,
            Err(_) => return (cache, 0),
        };
        let parsed: serde_json::Value = match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(_) => {
                let _ = fs::remove_file(&cache.path);
                cache.dirty = true;
                return (cache, 0);
            }
        };
        let discard = parsed["version"].as_u64() != Some(EMBED_CACHE_VERSION as u64)
            || parsed["identity"].as_str() != Some(identity)
            || parsed["dim"].as_u64() != Some(dim as u64);
        if discard {
            let _ = fs::remove_file(&cache.path);
            cache.dirty = true;
            return (cache, 0);
        }
        if let Some(entries) = parsed["entries"].as_array() {
            let prefix = format!("{identity}:");
            for entry in entries {
                let (Some(key), Some(seen), Some(vector)) = (
                    entry["key"].as_str(),
                    entry["seenAt"].as_u64(),
                    entry["vector"].as_str(),
                ) else {
                    cache.dirty = true;
                    continue;
                };
                if !key.starts_with(&prefix) {
                    cache.dirty = true;
                    continue;
                }
                let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(vector) else {
                    cache.dirty = true;
                    continue;
                };
                if bytes.len() != dim * 4 || bytes.len() % 4 != 0 {
                    cache.dirty = true;
                    continue;
                }
                let mut vec = Vec::with_capacity(dim);
                for chunk in bytes.chunks_exact(4) {
                    vec.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
                }
                if vec.iter().any(|v| !v.is_finite()) {
                    cache.dirty = true;
                    continue;
                }
                cache.entries.insert(key.to_string(), (vec, seen));
            }
        }
        let count = cache.entries.len();
        (cache, count)
    }

    fn get(&mut self, text: &str) -> Option<Vec<f32>> {
        let key = format!("{}:{}", self.identity, sha256_hex(text));
        let entry = self.entries.get_mut(&key)?;
        let seen = now_ms();
        if seen - entry.1 > 3_600_000 {
            self.dirty = true;
        }
        entry.1 = seen;
        Some(entry.0.clone())
    }

    fn set(&mut self, text: &str, vector: &[f32]) {
        if vector.len() != self.dim {
            return;
        }
        let key = format!("{}:{}", self.identity, sha256_hex(text));
        self.entries.insert(key, (vector.to_vec(), now_ms()));
        self.dirty = true;
    }

    fn flush(&mut self) {
        if !self.dirty {
            return;
        }
        if self.entries.len() > EMBED_CACHE_MAX_ENTRIES {
            let mut keys: Vec<(String, u64)> =
                self.entries.iter().map(|(k, (_, s))| (k.clone(), *s)).collect();
            keys.sort_by_key(|(_, s)| *s);
            for (key, _) in keys.into_iter().take(self.entries.len() - EMBED_CACHE_MAX_ENTRIES) {
                self.entries.remove(&key);
            }
        }
        let b64 = base64::engine::general_purpose::STANDARD;
        let entries: Vec<serde_json::Value> = self
            .entries
            .iter()
            .map(|(key, (vec, seen))| {
                let mut bytes = Vec::with_capacity(vec.len() * 4);
                for v in vec {
                    bytes.extend_from_slice(&v.to_le_bytes());
                }
                json!({ "key": key, "seenAt": seen, "vector": b64.encode(&bytes) })
            })
            .collect();
        let body = json!({
            "version": EMBED_CACHE_VERSION,
            "identity": self.identity,
            "dim": self.dim,
            "entries": entries,
        });
        let tmp = self.path.with_extension(format!("{}.tmp", std::process::id()));
        if let Some(parent) = self.path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if fs::write(&tmp, body.to_string()).is_ok() && fs::rename(&tmp, &self.path).is_ok() {
            self.dirty = false;
        } else {
            let _ = fs::remove_file(&tmp);
        }
    }
}

// ---- model ----

struct Embedder {
    session: Session,
    tokenizer: tokenizers::Tokenizer,
}

impl Embedder {
    fn load(env: &ort::environment::Environment, dir: &Path) -> Result<Self, LocalModelError> {
        let tokenizer = tokenizers::Tokenizer::from_file(dir.join("tokenizer.json"))
            .map_err(|e| LocalModelError::new("load-failed", format!("tokenizer.json: {e}")))?;
        let threads = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4)
            .saturating_sub(1)
            .clamp(1, 4);
        let mut builder = Session::builder(env)
            .map_err(|e| LocalModelError::new("load-failed", format!("session: {e}")))?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .and_then(|b| b.with_intra_threads(threads))
            .and_then(|b| b.with_inter_threads(1))
            .map_err(|e| LocalModelError::new("load-failed", format!("session options: {e}")))?;
        let session = builder
            .commit_from_file(dir.join("model.onnx"))
            .map_err(|e| LocalModelError::new("load-failed", format!("model.onnx: {e}")))?;
        Ok(Self { session, tokenizer })
    }

    /// CLS pooling of last_hidden_state + L2 normalisation (mirrors embedder.ts).
    fn embed(&mut self, text: &str, max_length: usize) -> Result<Vec<f32>, LocalModelError> {
        let encoding = self
            .tokenizer
            .encode(text, true)
            .map_err(|e| LocalModelError::new("inference-failed", format!("tokenize: {e}")))?;
        let mut ids: Vec<i64> = encoding.get_ids().iter().map(|&i| i as i64).collect();
        ids.truncate(max_length);
        let len = ids.len();
        let mask = vec![1i64; len];
        let outputs = self
            .session
            .run(ort::inputs! {
                "input_ids" => Tensor::from_array(([1usize, len], ids))
                    .map_err(|e| LocalModelError::new("inference-failed", format!("input_ids: {e}")))?,
                "attention_mask" => Tensor::from_array(([1usize, len], mask))
                    .map_err(|e| LocalModelError::new("inference-failed", format!("mask: {e}")))?,
            })
            .map_err(|e| LocalModelError::new("inference-failed", format!("run: {e}")))?;
        let (shape, data) = outputs["last_hidden_state"]
            .try_extract_tensor::<f32>()
            .map_err(|e| LocalModelError::new("inference-failed", format!("output: {e}")))?;
        let width = *shape.get(2).ok_or_else(|| {
            LocalModelError::new("inference-failed", "last_hidden_state has no width dim")
        })? as usize;
        let mut vector: Vec<f32> = data.iter().take(width).copied().collect();
        let norm = vector.iter().map(|v| v * v).sum::<f32>().sqrt().max(f32::MIN_POSITIVE);
        for v in vector.iter_mut() {
            *v /= norm;
        }
        Ok(vector)
    }
}

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

// ---- probe model (port of tinyAddModel in worker-protocol.ts) ----

fn tiny_add_model() -> Vec<u8> {
    fn varint(mut v: u64, out: &mut Vec<u8>) {
        while v > 127 {
            out.push((v & 127) as u8 | 128);
            v >>= 7;
        }
        out.push(v as u8);
    }
    fn bytes(field: u64, data: &[u8], out: &mut Vec<u8>) {
        out.push(((field << 3) | 2) as u8);
        varint(data.len() as u64, out);
        out.extend_from_slice(data);
    }
    fn strf(field: u64, text: &str, out: &mut Vec<u8>) {
        bytes(field, text.as_bytes(), out);
    }
    fn intf(field: u64, value: u64, out: &mut Vec<u8>) {
        out.push((field << 3) as u8);
        varint(value, out);
    }
    fn dim(value: u64) -> Vec<u8> {
        let mut i = Vec::new();
        intf(1, value, &mut i);
        let mut out = Vec::new();
        bytes(1, &i, &mut out);
        out
    }
    fn value_info(name: &str) -> Vec<u8> {
        let mut shape_inner = Vec::new();
        intf(1, 1, &mut shape_inner); // elem_type float
        let mut dims = Vec::new();
        dims.extend_from_slice(&dim(1));
        dims.extend_from_slice(&dim(2));
        bytes(2, &dims, &mut shape_inner);
        let mut tensor = Vec::new();
        bytes(1, &shape_inner, &mut tensor);
        let mut out = Vec::new();
        strf(1, name, &mut out);
        bytes(2, &tensor, &mut out);
        out
    }
    let mut node = Vec::new();
    strf(1, "x", &mut node);
    strf(1, "x", &mut node);
    strf(2, "y", &mut node);
    strf(4, "Add", &mut node);
    let mut graph = Vec::new();
    bytes(1, &node, &mut graph);
    strf(2, "g", &mut graph);
    bytes(11, &value_info("x"), &mut graph);
    bytes(12, &value_info("y"), &mut graph);
    let mut opset = Vec::new();
    strf(1, "", &mut opset);
    intf(2, 13, &mut opset);
    let mut model = Vec::new();
    intf(1, 7, &mut model);
    strf(2, "modus-probe", &mut model);
    bytes(7, &graph, &mut model);
    bytes(8, &opset, &mut model);
    model
}

fn probe(env: &ort::environment::Environment) -> Result<(), LocalModelError> {
    let mut builder = Session::builder(env)
        .map_err(|e| LocalModelError::new("load-failed", format!("probe session: {e}")))?;
    let mut session = builder
        .commit_from_memory(&tiny_add_model())
        .map_err(|e| LocalModelError::new("load-failed", format!("probe session: {e}")))?;
    let outputs = session
        .run(ort::inputs! {
            "x" => Tensor::from_array(([1usize, 2], vec![1.5f32, -2.0]))
                .map_err(|e| LocalModelError::new("load-failed", format!("tensor: {e}")))?,
        })
        .map_err(|e| LocalModelError::new("load-failed", format!("probe run: {e}")))?;
    let (_, y) = outputs["y"]
        .try_extract_tensor::<f32>()
        .map_err(|e| LocalModelError::new("load-failed", format!("probe output: {e}")))?;
    if y.len() != 2 || y[0] != 3.0 || y[1] != -4.0 {
        return Err(LocalModelError::new("load-failed", format!("probe graph returned {y:?}")));
    }
    Ok(())
}

// ---- handler ----

struct State<'a> {
    env: &'a ort::environment::Environment,
    embedder: Option<Embedder>,
    cache: Option<EmbedCache>,
    doc_vectors: HashMap<String, Vec<f32>>,
    doc_max_length: usize,
    query_max_length: usize,
}

impl State<'_> {
    fn new(env: &ort::environment::Environment) -> State<'_> {
        State {
            env,
            embedder: None,
            cache: None,
            doc_vectors: HashMap::new(),
            doc_max_length: DEFAULT_DOC_MAX_LENGTH,
            query_max_length: DEFAULT_QUERY_MAX_LENGTH,
        }
    }

    fn embed_docs(&mut self, docs: &[WorkerDoc]) -> Result<usize, LocalModelError> {
        let mut added = 0;
        for doc in docs {
            if self.doc_vectors.contains_key(&doc.doc) {
                continue;
            }
            if let Some(cached) = self.cache.as_mut().and_then(|c| c.get(&doc.doc)) {
                self.doc_vectors.insert(doc.doc.clone(), cached);
                continue;
            }
            let vector = {
                let embedder = self
                    .embedder
                    .as_mut()
                    .ok_or_else(|| LocalModelError::new("not-ready", "Model not loaded"))?;
                embedder.embed(&doc.doc, self.doc_max_length)?
            };
            if let Some(cache) = self.cache.as_mut() {
                cache.set(&doc.doc, &vector);
            }
            self.doc_vectors.insert(doc.doc.clone(), vector);
            added += 1;
        }
        if let Some(cache) = self.cache.as_mut() {
            cache.flush();
        }
        Ok(added)
    }

    fn handle(&mut self, req: Req, out: &mut impl Write) {
        match self.dispatch(req) {
            Ok(reply) => {
                let _ = writeln!(out, "{}", reply);
            }
            Err((id, error)) => {
                let _ = writeln!(
                    out,
                    "{}",
                    json!({ "type": "error", "id": id, "code": error.code, "message": error.message })
                );
            }
        }
        let _ = out.flush();
    }

    fn dispatch(&mut self, req: Req) -> Result<serde_json::Value, (i64, LocalModelError)> {
        match req {
            Req::Ping { id } => Ok(json!({ "type": "pong", "id": id })),
            Req::Stats { id } => Ok(json!({ "type": "ok", "id": id, "rssBytes": rss_bytes() })),
            Req::Probe { id } => probe(self.env)
                .map_err(|e| (id, e))
                .map(|_| json!({ "type": "ok", "id": id, "rssBytes": rss_bytes() })),
            Req::Load {
                id,
                dir,
                cache_dir,
                cache_identity,
                doc_max_length,
                query_max_length,
            } => {
                self.doc_max_length = doc_max_length.unwrap_or(DEFAULT_DOC_MAX_LENGTH);
                self.query_max_length = query_max_length.unwrap_or(DEFAULT_QUERY_MAX_LENGTH);
                let started = Instant::now();
                let mut cached_on_load = 0usize;
                if self.embedder.is_none() {
                    let mut embedder =
                        Embedder::load(self.env, Path::new(&dir)).map_err(|e| (id, e))?;
                    let probe = embedder
                        .embed("warm-up: list the files in src", self.query_max_length)
                        .map_err(|e| (id, e))?;
                    self.embedder = Some(embedder);
                    if let (Some(cache_dir), Some(identity)) = (cache_dir, cache_identity) {
                        let (cache, entries) =
                            EmbedCache::load(Path::new(&cache_dir), &identity, probe.len());
                        cached_on_load = entries;
                        self.cache = Some(cache);
                    }
                }
                Ok(json!({
                    "type": "ok",
                    "id": id,
                    "rssBytes": rss_bytes(),
                    "loadMs": started.elapsed().as_millis() as u64,
                    "cachedDocs": cached_on_load,
                }))
            }
            Req::Warm { id, docs } => {
                let embedded = self.embed_docs(&docs).map_err(|e| (id, e))?;
                Ok(json!({
                    "type": "ok",
                    "id": id,
                    "rssBytes": rss_bytes(),
                    "embeddedDocs": embedded,
                    "cachedDocs": docs.len() - embedded,
                }))
            }
            Req::Select { id, query, docs, k, budget_ms } => {
                let started = Instant::now();
                if self.embedder.is_none() {
                    return Err((id, LocalModelError::new("not-ready", "Model not loaded")));
                }
                let mut missing: Vec<WorkerDoc> = Vec::new();
                for d in &docs {
                    if self.doc_vectors.contains_key(&d.doc) {
                        continue;
                    }
                    match self.cache.as_mut().and_then(|c| c.get(&d.doc)) {
                        Some(cached) => {
                            self.doc_vectors.insert(d.doc.clone(), cached);
                        }
                        None => missing.push(WorkerDoc { name: d.name.clone(), doc: d.doc.clone() }),
                    }
                }
                if !missing.is_empty() {
                    let reply = json!({
                        "type": "select",
                        "id": id,
                        "status": "not-ready",
                        "inProcessMs": started.elapsed().as_secs_f64() * 1000.0,
                        "rssBytes": rss_bytes(),
                    });
                    // Embed them now so the next request is filtered.
                    let _ = self.embed_docs(&missing);
                    return Ok(reply);
                }
                let embedder = self.embedder.as_mut().unwrap();
                let query_vec = embedder
                    .embed(&query, self.query_max_length)
                    .map_err(|e| (id, e))?;
                let mut ranked: Vec<(String, usize, f32)> = docs_rank(&query_vec, &self.doc_vectors, docs);
                ranked.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal).then(a.1.cmp(&b.1)));
                let names: Vec<&String> = ranked.iter().take(k).map(|(n, _, _)| n).collect();
                let in_process_ms = started.elapsed().as_secs_f64() * 1000.0;
                if in_process_ms > budget_ms {
                    Ok(json!({
                        "type": "select",
                        "id": id,
                        "status": "timeout",
                        "inProcessMs": in_process_ms,
                        "rssBytes": rss_bytes(),
                    }))
                } else {
                    Ok(json!({
                        "type": "select",
                        "id": id,
                        "status": "ok",
                        "names": names,
                        "inProcessMs": in_process_ms,
                        "rssBytes": rss_bytes(),
                    }))
                }
            }
        }
    }
}

fn docs_rank(
    query_vec: &[f32],
    doc_vectors: &HashMap<String, Vec<f32>>,
    docs: Vec<WorkerDoc>,
) -> Vec<(String, usize, f32)> {
    docs.into_iter()
        .enumerate()
        .map(|(index, d)| {
            let score = doc_vectors.get(&d.doc).map(|v| cosine(query_vec, v)).unwrap_or(0.0);
            (d.name, index, score)
        })
        .collect()
}

/// libonnxruntime lives next to the binary (bundled) or in the staged
/// onnxruntime-node package (resources/sidecar/node_modules, dev node_modules).
fn find_onnx_dylib() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("MODUS_ONNX_DYLIB").or_else(|_| std::env::var("ORT_DYLIB_PATH")) {
        return Some(PathBuf::from(path));
    }
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let platform = match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        o => o,
    };
    // onnxruntime-node's napi-v6 layout uses npm arch names.
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        a => a,
    };
    let lib_name = match std::env::consts::OS {
        "windows" => "onnxruntime.dll",
        "macos" => "libonnxruntime.dylib",
        _ => "libonnxruntime.so",
    };
    let candidates = [
        exe_dir.join(lib_name),
        exe_dir
            .join("../sidecar/node_modules/onnxruntime-node/bin")
            .join(format!("napi-v6/{platform}/{arch}")),
        // Dev: target/release/modus-tool-filter -> repo-root node_modules.
        exe_dir
            .join("../../node_modules/onnxruntime-node/bin")
            .join(format!("napi-v6/{platform}/{arch}")),
    ];
    for candidate in candidates {
        if candidate.is_file() {
            return Some(candidate);
        }
        if candidate.is_dir() {
            if let Ok(mut entries) = candidate
                .read_dir()
                .map(|rd| {
                    rd.filter_map(|e| e.ok())
                        .map(|e| e.path())
                        .filter(|p| {
                            p.file_name()
                                .and_then(|n| n.to_str())
                                .is_some_and(|n| n.starts_with(lib_name))
                        })
                        .collect::<Vec<_>>()
                })
                .map(|mut v| {
                    v.sort();
                    v
                })
            {
                if let Some(found) = entries.pop() {
                    return Some(found);
                }
            }
        }
    }
    None
}

fn main() {
    let dylib = match find_onnx_dylib() {
        Some(path) => path,
        None => {
            eprintln!("libonnxruntime not found; set MODUS_ONNX_DYLIB");
            std::process::exit(1);
        }
    };
    let env = ort::init_from(&dylib)
        .map_err(|e| e.to_string())
        .and_then(|builder| builder.build().map_err(|e| e.to_string()))
        .unwrap_or_else(|error: String| {
            eprintln!("onnxruntime init failed ({dylib:?}): {error}");
            std::process::exit(1);
        });
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = BufWriter::new(stdout.lock());
    let mut state = State::new(&env);
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<Req>(&line) {
            Ok(req) => state.handle(req, &mut out),
            Err(error) => {
                let _ = writeln!(
                    out,
                    "{}",
                    json!({ "type": "error", "id": -1, "code": "load-failed", "message": format!("bad request: {error}") })
                );
                let _ = out.flush();
            }
        }
    }
}
