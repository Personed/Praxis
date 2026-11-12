import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = resolve(desktopDir, "../..");
const rendererDir = join(desktopDir, "src/renderer/src");
const componentsDir = join(rendererDir, "components");

// The upstream mark, assembled so this guard does not itself carry it.
const MARK = new RegExp(["react", "[\\s-]?", "bits"].join(""), "i");

// L0 (clean-room): the ten adapted components were deleted and rewritten from specs.
// None of these names may come back anywhere in the renderer.
const REMOVED_COMPONENTS = [
  "Aurora",
  "BranchedMenu",
  "FadeContent",
  "GradientWaves",
  "PromptSendGlyph",
  "ScrollReveal",
  "ShapeGrid",
  "ShinyText",
  "SpringCheck",
  "TextType",
  "ThoughtLine",
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("no third-party component marks left in components/", () => {
  it("only the licensed Prompt Bar keeps its upstream mark", () => {
    const licensedPromptBar = join(componentsDir, "ui/react-bits/PromptBar.tsx");
    const marked = walk(componentsDir)
      .filter((path) => MARK.test(read(path)))
      .filter((path) => path !== licensedPromptBar)
      .map((path) => relative(repoRoot, path));
    expect(marked).toEqual([]);
    expect(MARK.test(read(licensedPromptBar))).toBe(true);
  });

  it("the removed component files do not come back (any extension, any folder)", () => {
    const names = new Set(REMOVED_COMPONENTS);
    const back = walk(rendererDir)
      .filter((path) => names.has((path.split("/").pop() ?? "").split(".")[0] ?? ""))
      .map((path) => relative(repoRoot, path));
    expect(back).toEqual([]);
  });

  it("nothing imports a removed component", () => {
    const importOf = new RegExp(`/(${REMOVED_COMPONENTS.join("|")})["']`);
    const offenders = walk(join(desktopDir, "src"))
      .filter((path) => /\.(ts|tsx|mts|mjs)$/.test(path))
      .filter((path) => importOf.test(read(path)))
      .map((path) => relative(repoRoot, path));
    expect(offenders).toEqual([]);
  });

  it("app.css has no rules marked with the upstream name", () => {
    expect(read(join(rendererDir, "styles/app.css"))).not.toMatch(MARK);
  });
});

describe("license files after L0", () => {
  it("LICENSE is the plain Apache-2.0 text with no third-party exception block", () => {
    const license = read(join(repoRoot, "LICENSE"));
    expect(license.trimStart().startsWith("Apache License")).toBe(true);
    expect(license).toContain("http://www.apache.org/licenses/LICENSE-2.0");
    expect(license.trimEnd().endsWith("limitations under the License.")).toBe(true);
    expect(license).not.toContain("THIRD-PARTY FILES NOT COVERED");
    expect(license).not.toMatch(MARK);
    expect(license).not.toContain("Commons Clause");
  });

  it.each([
    ["README.md", "## License"],
    ["README.zh-CN.md", "## 许可证"],
  ])("%s License section is plain Apache-2.0", (readme, heading) => {
    const text = read(join(repoRoot, readme));
    const start = text.indexOf(heading);
    expect(start).toBeGreaterThanOrEqual(0);
    const end = text.indexOf("\n## ", start + 1);
    const section = text.slice(start, end === -1 ? undefined : end);
    expect(section).toContain("Apache-2.0");
    expect(section).not.toMatch(MARK);
    expect(section).not.toContain("Commons Clause");
    expect(section).not.toMatch(/components\/ui\//);
  });

  it("THIRD_PARTY_NOTICES.md keeps notices for the included components", () => {
    const notices = read(join(repoRoot, "THIRD_PARTY_NOTICES.md"));
    expect(notices).toContain("## Agent Elements (21st.dev)");
    expect(notices).toContain("MIT + Commons Clause License Condition v1.0");
    expect(notices).toMatch(MARK);
    for (const path of notices.match(/`apps\/desktop\/[^`]+`/g) ?? []) {
      expect(existsSync(join(repoRoot, path.slice(1, -1))), path).toBe(true);
    }
  });
});
