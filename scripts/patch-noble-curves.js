#!/usr/bin/env node
/**
 * Patches @noble/curves to add nist.js export.
 * 
 * @aptos-labs/ts-sdk imports from '@noble/curves/nist.js' but
 * @noble/curves@1.2.0 doesn't export it. This script:
 * 1. Creates nist.js (CJS) and esm/nist.js (ESM) shim files
 * 2. Adds ./nist.js and ./nist to the package.json exports map
 */
const fs = require('fs');
const path = require('path');

function findNobleDir() {
  // Walk up from this script to find node_modules/@noble/curves
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, 'node_modules', '@noble', 'curves');
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return candidate;
    }
    dir = path.dirname(dir);
  }
  return null;
}

const nobleDir = findNobleDir();
if (!nobleDir) {
  console.log('[patch-noble-curves] @noble/curves not found, skipping');
  process.exit(0);
}

const pkgPath = path.join(nobleDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

// Check if already patched
if (pkg.exports && pkg.exports['./nist.js']) {
  console.log('[patch-noble-curves] Already patched, skipping');
  process.exit(0);
}

// Create CJS shim
const cjsShim = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const p256_1 = require("./p256");
const p384_1 = require("./p384");
const p521_1 = require("./p521");
exports.p256 = p256_1.p256;
exports.p384 = p384_1.p384;
exports.p521 = p521_1.p521;
`;
fs.writeFileSync(path.join(nobleDir, 'nist.js'), cjsShim);

// Create ESM shim if esm dir exists
const esmDir = path.join(nobleDir, 'esm');
if (fs.existsSync(esmDir)) {
  const esmShim = `export { p256 } from './p256.js';
export { p384 } from './p384.js';
export { p521 } from './p521.js';
`;
  fs.writeFileSync(path.join(esmDir, 'nist.js'), esmShim);
}

// Patch exports
if (pkg.exports) {
  pkg.exports['./nist.js'] = {
    types: './p256.d.ts',
    import: './esm/nist.js',
    default: './nist.js'
  };
  pkg.exports['./nist'] = {
    types: './p256.d.ts',
    import: './esm/nist.js',
    default: './nist.js'
  };
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

console.log('[patch-noble-curves] Patched @noble/curves with nist.js exports');
