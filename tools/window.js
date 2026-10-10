// Builds (on demand) and launches WB2Window.exe, which shows the game in a
// resizable, scaled window. Falls back to running the game directly.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(__dirname, 'window', 'WB2Window.cs');
const EXE = path.join(ROOT, 'build', 'WB2Window.exe');
const CSC = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');

// Returns the wrapper path, compiling it if missing or older than its source.
function ensureWrapper() {
  const fresh = fs.existsSync(EXE) && fs.statSync(EXE).mtimeMs >= fs.statSync(SOURCE).mtimeMs;
  if (fresh) return EXE;
  if (!fs.existsSync(CSC)) return null;
  fs.mkdirSync(path.dirname(EXE), { recursive: true });
  try {
    execFileSync(CSC, ['-nologo', '-target:winexe', '-platform:anycpu', `-out:${EXE}`, SOURCE], { stdio: 'pipe' });
    return EXE;
  } catch (e) {
    console.error('Could not build WB2Window.exe:', String(e.stdout || e.message));
    return null;
  }
}

// Launch a projector (Launcher.exe), scaled if possible.
function launch(launcherExe) {
  const wrapper = ensureWrapper();
  const opts = { cwd: path.dirname(launcherExe), detached: true, stdio: 'ignore' };
  if (wrapper) spawn(wrapper, [launcherExe], opts).unref();
  else spawn(launcherExe, [], opts).unref();
  return { scaled: !!wrapper };
}

module.exports = { ensureWrapper, launch };

// CLI: node tools/window.js [path\to\Launcher.exe]
if (require.main === module) {
  const target = process.argv[2] || path.join(ROOT, 'WorldBuilder2', 'worldbuilder2', 'Launcher.exe');
  const { scaled } = launch(path.resolve(target));
  if (!scaled) console.log('Scaled window unavailable; started the game at its normal size.');
}
