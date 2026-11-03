// Read-only delivery checks: pinned manifests, complete pnpm lock and packaged build identity.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const builderRequire = createRequire(require.resolve('electron-builder/package.json'));
const yaml = builderRequire('js-yaml');
const asar = builderRequire('@electron/asar');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const reportPath = path.join(root, 'reports', 'release-integrity.json');
const report = { passed: false, at: new Date().toISOString() };
async function filesIn(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    assert(!entry.isSymbolicLink(), 'Unexpected symlink in build outputs');
    if (entry.isDirectory()) files.push(...await filesIn(target));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}
(async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const lockBytes = await fs.readFile(path.join(root, 'pnpm-lock.yaml'));
  // pnpm 12 writes toolchain and project locks as separate YAML documents.
  const locks = yaml.loadAll(lockBytes.toString('utf8'));
  const application = locks.find(doc => doc?.importers?.['.']?.dependencies);
  const toolchain = locks.find(doc => doc?.importers?.['.']?.packageManagerDependencies);
  assert(application, 'Application dependency lock is missing');
  const pinned = pkg.packageManager.split('@').at(-1);
  assert.equal(toolchain?.importers['.'].packageManagerDependencies.pnpm.specifier, pinned);
  const directDependencies = {};
  for (const section of ['dependencies', 'devDependencies']) {
    assert.deepEqual(Object.keys(application.importers['.'][section]).sort(), Object.keys(pkg[section]).sort());
    for (const [name, version] of Object.entries(pkg[section])) {
      assert(/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(version), 'Dependency is not pinned: ' + name);
      const locked = application.importers['.'][section][name];
      assert.equal(locked.specifier, version, 'Manifest/lock mismatch: ' + name);
      assert(locked.version === version || locked.version.startsWith(version + '('), 'Resolution mismatch: ' + name);
      assert(application.packages[`${name}@${version}`]?.resolution?.integrity, 'Integrity missing: ' + name);
      directDependencies[name] = version;
    }
  }
  const asarFile = path.join(root, 'release', 'win-unpacked', 'resources', 'app.asar');
  const packagedManifest = JSON.parse(asar.extractFile(asarFile, 'package.json').toString('utf8'));
  assert.equal(packagedManifest.version, pkg.version);
  assert.equal(packagedManifest.license, pkg.license);
  assert.deepEqual(packagedManifest.dependencies, pkg.dependencies);
  assert.equal(hash(await fs.readFile(path.join(root, "release", "win-unpacked", "LICENSE"))), hash(await fs.readFile(path.join(root, "LICENSE"))));
  const outputHashes = {};
  for (const file of await filesIn(path.join(root, 'out'))) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    const expected = await fs.readFile(file);
    assert.equal(hash(asar.extractFile(asarFile, path.relative(root, file))), hash(expected), 'Packaged output differs: ' + relative);
    outputHashes[relative] = hash(expected);
  }
  assert(Object.keys(outputHashes).length >= 3, 'Compiled outputs missing');
  for (const file of await filesIn(path.join(root, 'docs'))) {
    const relative = path.relative(path.join(root, 'docs'), file);
    assert.equal(hash(await fs.readFile(path.join(root, 'release', 'win-unpacked', 'docs', relative))), hash(await fs.readFile(file)), 'Packaged documentation differs: ' + relative);
  }
  const nativeFiles = (await filesIn(path.join(root, 'release', 'win-unpacked', 'resources', 'app.asar.unpacked'))).filter(file => file.endsWith(path.join('better-sqlite3', 'prebuilds', 'win32-x64.node')));
  assert(nativeFiles.length > 0, 'Unpacked SQLite native module missing');
  const installerFile = `CampusCourseDesktop-Setup-${pkg.version}-x64.exe`;
  const installerBytes = await fs.readFile(path.join(root, 'release', installerFile));
  Object.assign(report, {
    passed: true, version: pkg.version, lockDocuments: locks.length,
    lockSha256: hash(lockBytes), directDependencies, lockedPackageCount: Object.keys(application.packages).length,
    outputHashes, asarSha256: hash(await fs.readFile(asarFile)),
    nativeModules: await Promise.all(nativeFiles.map(async file => ({ file: path.relative(path.join(root, 'release', 'win-unpacked'), file).split(path.sep).join('/'), sha256: hash(await fs.readFile(file)) }))),
    installerFile, installerSha256: hash(installerBytes),
    note: 'Identity checks only; not a real-platform or clean-Windows compatibility result.'
  });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`Release identity verified: ${pkg.version}, ${Object.keys(directDependencies).length} pinned dependencies, ${Object.keys(outputHashes).length} matching compiled files.`);
})().catch(async error => {
  report.error = String(error);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  console.error(error);
  process.exitCode = 1;
});
