import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url);
const { version } = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const strip = source => source.replace(/^import .*;\n/gm, "").replace(/^export (?=(const|function|class|async function))/gm, "");
const bundle = async files => (await Promise.all(files.map(name => readFile(new URL(`src/${name}.js`, root), "utf8")))).map(strip).join("\n");
// One registry subscription pool is shared by both cards and both editors.
// Separate closures preserve the original model and style names.
const shared = await bundle(["exclusions", "registry", "native"]);
const controls = await bundle(["control/filter", "control/model", "control/presentation", "control/native-config", "control/styles", "control/card", "control/editor"]);
const overview = await bundle(["control-config", "model", "media", "styles", "card", "editor"]);
const body = `${shared}\nconst { validateConfig, controlFilterReason } = (() => {\n${controls}\nreturn { validateConfig, controlFilterReason };\n})();\n(() => {\n${overview}\n})();`;
await mkdir(new URL("dist/", root), { recursive: true });
const license = await readFile(new URL("LICENSE", root), "utf8");
const output = `/* Room Overview + Control Card v${version}\n${license}\nBuilt from src/; run npm run build.\n*/\n(() => {\n"use strict";\n${body}\n})();\n`;
await writeFile(new URL("dist/room-overview-card.js", root), output);
console.log(`Built ${fileURLToPath(new URL("dist/room-overview-card.js", root))} (${Buffer.byteLength(output)} bytes)`);
if (process.argv.includes("--demo")) {
  const demo = output.replaceAll("room-overview-card", "room-overview-card-demo").replaceAll("room-control-card", "room-control-card-demo");
  await writeFile(new URL("dist/room-overview-card-demo.js", root), demo);
  console.log(`Built isolated demo (${Buffer.byteLength(demo)} bytes)`);
}
