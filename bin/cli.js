#!/usr/bin/env node
// CLI dispatcher: subcommands load their own bundles.
// proxy (default) and export -> dist/node.js
// copilot                          -> dist/copilot-cli.js
// dashboard                        -> dist/dashboard-cli.js

const sub = process.argv[2];

if (sub === 'copilot') {
  process.argv.splice(2, 1);
  import('../dist/copilot-cli.js').catch((err) => {
    console.error('[compresso] failed to start copilot:', err.message);
    process.exit(1);
  });
} else if (sub === 'dashboard') {
  process.argv.splice(2, 1);
  import('../dist/dashboard-cli.js').catch((err) => {
    console.error('[compresso] failed to start dashboard:', err.message);
    process.exit(1);
  });
} else {
  // proxy, export, --help, --version — all handled by the existing bundle
  import('../dist/node.js').catch((err) => {
    if (err && typeof err === 'object' && 'message' in err) {
      console.error('[compresso] failed to start:', err.message);
    } else {
      console.error('[compresso] failed to start:', err);
    }
    console.error('[compresso] did you forget to `npm run build`?');
    process.exit(1);
  });
}
