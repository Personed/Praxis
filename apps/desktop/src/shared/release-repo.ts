/**
 * The GitHub repository whose Releases publish Modus: used by the Tauri
 * updater endpoint in src-tauri/tauri.conf.json, by the in-app updater's
 * release-page/download URL allowlist and for the default model catalog URL.
 * No Electron or Node imports.
 */
export const RELEASE_REPO = { owner: "Personed", repo: "Praxis" } as const;
