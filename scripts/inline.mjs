// Optional compact output for Home Assistant's 128,000-byte inline resources.
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { minify } = require(process.env.TERSER_MODULE || "terser");
const root = new URL("../", import.meta.url);
const source = await readFile(new URL("dist/room-overview-card.js", root), "utf8");
const result = await minify(source, { module: true, compress: { passes: 2 }, mangle: true, format: { comments: /MIT License/ } });
const output = result.code + "\n";
if (Buffer.byteLength(output) > 128000) throw new Error("Inline module exceeds Home Assistant's resource limit; use the standard /local/ installation.");
await writeFile(new URL("dist/room-overview-card-inline.js", root), output);
const demo = output.replaceAll("room-overview-card", "room-overview-card-demo").replaceAll("room-control-card", "room-control-card-demo");
await writeFile(new URL("dist/room-overview-card-demo-inline.js", root), demo);
console.log(`Prepared inline modules (${Buffer.byteLength(output)} / ${Buffer.byteLength(demo)} bytes).`);
