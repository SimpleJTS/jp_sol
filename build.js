const esbuild = require('esbuild');
const path = require('path');

esbuild.build({
  entryPoints: [path.join(__dirname, 'src', 'service-worker.js')],
  bundle: true,
  outfile: path.join(__dirname, 'background', 'service-worker.js'),
  format: 'iife',
  target: 'chrome100',
  define: {
    'global': 'globalThis'
  }
}).then(() => {
  console.log('Build complete!');
}).catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
