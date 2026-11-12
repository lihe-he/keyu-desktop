// Resolve one verified candidate before any installer or application is launched.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

function inside(parent, child) {
 const relative = path.relative(parent, child);
 return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
function parseArguments(argv) {
 let installer, initial;
 for (let index = 0; index < argv.length; index++) {
  const argument = argv[index];
  if (argument === '--installer' || argument === '--upgrade-from') {
   const value = argv[++index];
   assert(value && !value.startsWith('--'), 'Installer option requires a path.');
   if (argument === '--installer') { assert(!installer, 'Duplicate installer option.'); installer = value; }
   else { assert(!initial, 'Duplicate upgrade source.'); initial = value; }
  } else {
   // Preserve the earlier positional argument as the upgrade starting version.
   assert(!argument.startsWith('-') && !initial, 'Unknown or repeated installer argument.');
   initial = argument;
  }
 }
 return { installer, initial };
}
async function digest(file) {
 const hash = crypto.createHash('sha256');
 for await (const chunk of require('node:fs').createReadStream(file)) hash.update(chunk);
 return hash.digest('hex');
}
async function checkedInstaller(root, raw, expectedVersion) {
 assert(typeof raw === 'string' && raw, 'Verified installer path is missing.');
 const file = path.resolve(root, raw), release = path.join(root, 'release');
 assert(inside(release, file), 'Installer must be inside this project release directory.');
 const match = /^CampusCourseDesktop-Setup-(\d+\.\d+\.\d+)-x64\.exe$/.exec(path.basename(file));
 assert(match && (!expectedVersion || match[1] === expectedVersion), 'Installer filename differs from the expected version.');
 const stat = await fs.lstat(file);
 assert(stat.isFile() && !stat.isSymbolicLink(), 'Installer must be a regular file.');
 const realRelease = await fs.realpath(release), realFile = await fs.realpath(file);
 assert(inside(realRelease, realFile), 'Installer resolves outside the project release directory.');
 const equalPath = process.platform === 'win32' ? (a, b) => a.toLowerCase() === b.toLowerCase() : (a, b) => a === b;
 assert(equalPath(file, realFile), 'Installer path must not follow a reparse point or symlink.');
 return { root, file, relative: path.relative(root, file).split(path.sep).join('/'), version: match[1], sha256: await digest(file) };
}
async function resolveInstallInputs({ root, version, argv = [] }) {
 root = await fs.realpath(root);
 const identity = JSON.parse((await fs.readFile(path.join(root, 'reports', 'release-integrity.json'), 'utf8')).replace(/^\uFEFF/, ''));
 assert(identity.passed === true && identity.version === version, 'Run release identity verification for the current version first.');
 assert(/^[a-f0-9]{64}$/.test(identity.installerSha256), 'Verified installer digest is missing.');
 assert(typeof identity.installerPath === 'string' && identity.installerPath.startsWith('release/') && !/[\\<>:"|?*\x00-\x1f]/.test(identity.installerPath) && !identity.installerPath.split('/').some(part => !part || part === '.' || part === '..'), 'Verified installer path must be relative to the project release directory.');
 const verified = await checkedInstaller(root, identity.installerPath, version);
 assert.equal(verified.sha256, identity.installerSha256, 'Verified installer changed; repeat release identity verification.');
 const parsed = parseArguments(argv);
 const current = parsed.installer ? await checkedInstaller(root, parsed.installer, version) : verified;
 assert.equal(current.sha256, verified.sha256, 'Requested installer is a different candidate from the verified build.');
 const initial = parsed.initial ? await checkedInstaller(root, parsed.initial) : current;
 const [major, minor, patch] = initial.version.split('.').map(Number);
 assert(major > 0 || minor > 1 || (minor === 1 && patch >= 4), 'Upgrade starting version must support isolated verification profiles (0.1.4 or newer).');
 return { current, initial };
}
async function assertInstallerUnchanged(input) {
 const current = await checkedInstaller(input.root, input.file, input.version);
 assert.equal(current.sha256, input.sha256, 'Installer changed during verification; stop and inspect the candidate.');
}

module.exports = { resolveInstallInputs, assertInstallerUnchanged };
