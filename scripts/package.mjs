import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import "./build.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
await mkdir(`${root}/releases`, { recursive: true });
const archive = `${root}/releases/room-overview-card-${version}.zip`;
const files = ["README.md", "LICENSE", "hacs.json", "dist/room-overview-card.js"];
// A small, portable ZIP writer using Python's standard library; no npm dependencies.
const result = spawnSync("python3", ["-c", "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED); [z.write(p,p) for p in sys.argv[2:]]; z.close()", archive, ...files], { cwd: root, encoding: "utf8" });
if (result.status !== 0) throw new Error(result.stderr || "The release archive could not be created. Python 3 is required.");
await writeFile(`${root}/releases/manifest.json`, `${JSON.stringify({ version, archive: archive.split("/").pop(), files }, null, 2)}\n`);
console.log(`Packaged ${archive}`);
