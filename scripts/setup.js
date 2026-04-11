const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const binScript = path.join(__dirname, '..', 'bin', 'mergeagent');

// Make bin script executable
fs.chmodSync(binScript, '755');

// Add to PATH via symlink
const symlinkTarget = '/usr/local/bin/mergeagent';
try {
  if (fs.existsSync(symlinkTarget)) fs.unlinkSync(symlinkTarget);
  fs.symlinkSync(binScript, symlinkTarget);
} catch {
  console.log('Could not create symlink (may need sudo). Run:');
  console.log(`  sudo ln -sf "${binScript}" ${symlinkTarget}`);
}

// Configure git
execSync('git config --global merge.tool mergeagent');
execSync(`git config --global mergetool.mergeagent.cmd 'mergeagent "$MERGED"'`);
execSync('git config --global mergetool.mergeagent.trustExitCode true');

console.log('\nDone! mergeagent is now your default merge tool.');
console.log('SourceTree: Settings → Diff → Merge Tool → Custom');
console.log('  Command: mergeagent');
console.log('  Arguments: $MERGED');
