import { cpSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const threePackage = require.resolve("three/package.json");
const threeRoot = dirname(threePackage);
const vendor = resolve("vendor");
mkdirSync(resolve(vendor, "addons/controls"), { recursive: true });
cpSync(resolve(threeRoot, "build/three.module.js"), resolve(vendor, "three.module.js"));
cpSync(resolve(threeRoot, "build/three.core.js"), resolve(vendor, "three.core.js"));
cpSync(resolve(threeRoot, "examples/jsm/controls/OrbitControls.js"), resolve(vendor, "addons/controls/OrbitControls.js"));
console.log("Copied pinned Three.js viewer dependencies.");
