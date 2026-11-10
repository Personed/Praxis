## 2024-05-18 - ⚡ Bolt: Batch convert member sessions using json_each

**Learning:** When using `node:sqlite`, replacing an N+1 sequence of calls running in a transaction with a batched update using `UPDATE ... FROM json_each(?)` avoids many crossings across the JS-to-C++ boundary. While SQLite handles loops within a transaction extremely efficiently (and often finishes in negligible wall-clock time), moving to a JSON-mapped batch with chunks (e.g., of 500) reduces function call overhead.
**Action:** When a user explicitly requests batching N+1 SQLite queries, ensure the JSON string passed to `json_each` is chunked if it represents large dynamic arrays, and wrap it in a size check to avoid `json_each` syntax errors.

## 2026-10-29 - Optimize SQLite inserts using json_each batching
**Learning:** When fixing N+1 SQLite queries (inserts or updates) in Node.js with \`node:sqlite\`, passing a JSON-stringified array of objects to a single parameterized query utilizing \`INSERT INTO ... SELECT ... FROM json_each(?)\` or \`UPDATE ... FROM json_each(?)\` is an excellent way to reduce query latency by over 20-30% compared to executing statements individually in a loop (even when inside an explicit transaction). However, when batching inserts in this way, uncommitted memory rows in the batch are not immediately visible to \`SELECT\` checks against the database inside the same loop. For example, if a unique naming constraint uses \`SELECT 1 FROM table WHERE name = ?\`, it will fail to see newly assigned names.
**Action:** When batching inserts that rely on uniqueness checks based on the database state, always maintain a local memory construct (e.g., a \`Set\` of taken names) to track newly added elements during the loop before they are committed, ensuring the uniqueness invariant holds true.

## 2024-05-17 - ReadFileSync Event Loop Block
**Learning:** `readFileSync` reads the entire file synchronously, even when we truncate the result later using `subarray`. For big workspace files (e.g. 50MB log files), this will pause the node event loop for hundreds of ms, causing noticeable UI stuttering via the IPC bottleneck.
**Action:** Always allocate exactly the bytes needed via `fs.openSync`, `fs.readSync`, and `fs.closeSync` for workspace files accessed via `files-service`.
