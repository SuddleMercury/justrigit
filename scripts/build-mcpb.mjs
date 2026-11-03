// Builds dist/JustRigIt.mcpb — a one-click Claude Desktop extension (MCP Bundle).
// Claude Desktop runs it with its own built-in Node.js, so nothing else needs installing.
//
//   node scripts/build-mcpb.mjs              (Windows x64 image library; what users get)
//   node scripts/build-mcpb.mjs --platform linux-x64-gnu --out build/test.mcpb   (for testing here)
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { zipSync } from 'fflate';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const PLATFORM = opt('--platform', 'win32-x64-msvc');
const OUT = path.resolve(opt('--out', 'dist/JustRigIt.mcpb'));
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const CANVAS_VERSION = JSON.parse(fs.readFileSync('node_modules/@napi-rs/canvas/package.json', 'utf8')).version;
const STAGE = path.resolve('build/mcpb');
const CACHE = path.resolve('build/cache');

fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(path.join(STAGE, 'server'), { recursive: true });
fs.mkdirSync(CACHE, { recursive: true });

// 1. the server, bundled into one file (three.js, MCP SDK, fflate…); the native image library stays outside
await build({
  entryPoints: ['src/node/mcp-server.mjs'],
  bundle: true, platform: 'node', format: 'esm', target: 'node18', minify: false,
  outfile: path.join(STAGE, 'server', 'index.mjs'),
  external: ['@napi-rs/canvas'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  legalComments: 'none', logLevel: 'warning',
});

// 2. native image library (textures) for the target platform
const nm = path.join(STAGE, 'server', 'node_modules', '@napi-rs');
fs.mkdirSync(nm, { recursive: true });
fs.cpSync('node_modules/@napi-rs/canvas', path.join(nm, 'canvas'), { recursive: true });
const platPkg = `canvas-${PLATFORM}`;
const local = path.join('node_modules/@napi-rs', platPkg);
if (fs.existsSync(local)) fs.cpSync(local, path.join(nm, platPkg), { recursive: true });
else {
  const tgz = path.join(CACHE, `napi-rs-${platPkg}-${CANVAS_VERSION}.tgz`);
  if (!fs.existsSync(tgz)) execSync(`npm pack @napi-rs/${platPkg}@${CANVAS_VERSION} --silent`, { cwd: CACHE, stdio: 'inherit' });
  const dst = path.join(nm, platPkg);
  fs.mkdirSync(dst, { recursive: true });
  execSync(`tar -xzf "${tgz}" -C "${dst}" --strip-components=1`);
}

// 3. the capture engine's Python package, so the server can start the engine (the model and its
//    Python environment stay in %LOCALAPPDATA%\JustRigIt\capture, set up by Install-Capture.bat)
fs.cpSync('capture/jrcapture', path.join(STAGE, 'server', 'capture', 'jrcapture'), {
  recursive: true, filter: (src) => !/__pycache__|\.pyc$/.test(src),
});

// 4. icon (512×512, drawn here so there is no binary in the repo)
const { createCanvas } = await import('@napi-rs/canvas');
const cv = createCanvas(512, 512), g = cv.getContext('2d'); g.scale(2, 2);
const grad = g.createLinearGradient(0, 0, 256, 256); grad.addColorStop(0, '#ff8a3d'); grad.addColorStop(1, '#e8541c');
g.fillStyle = grad; g.beginPath(); g.roundRect(8, 8, 240, 240, 56); g.fill();
g.fillStyle = '#fff'; g.font = 'bold 170px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('J', 128, 140);
fs.writeFileSync(path.join(STAGE, 'icon.png'), await cv.encode('png'));

// 5. manifest
const manifest = {
  manifest_version: '0.3',
  name: 'justrigit',
  display_name: 'JustRigIt',
  version: pkg.version,
  description: 'Rig, animate and motion-capture 3D characters for Unreal, Unity, Godot and Blender — on your own computer.',
  long_description: [
    'Lets Claude use JustRigIt on your computer:',
    '- **Auto-rig** characters that have no skeleton (body and fingers).',
    '- **Motion capture from video** with NVIDIA GEM-X on your own GPU (needs the capture engine: run Install-Capture.bat from the JustRigIt folder once).',
    '- **Retarget** the built-in animation library or your own Mixamo/Quaternius files.',
    '- **Check and fix** import problems, then **export** GLB files with each engine\'s bone names and a step-by-step import guide.',
    '- Claude can **look at** the character (rendered pictures) to check its work.',
    '',
    'Files stay on your computer. Exports go to the folder you choose below.',
    '',
    'Free software by SuddleMercury (AGPL-3.0), developed with Claude. Source: https://github.com/SuddleMercury/justrigit',
  ].join('\n'),
  author: { name: 'SuddleMercury', url: 'https://github.com/SuddleMercury' },
  repository: { type: 'git', url: 'https://github.com/SuddleMercury/justrigit.git' },
  homepage: 'https://github.com/SuddleMercury/justrigit',
  support: 'https://github.com/SuddleMercury/justrigit/issues',
  icon: 'icon.png',
  server: {
    type: 'node',
    entry_point: 'server/index.mjs',
    mcp_config: {
      command: 'node',
      args: ['${__dirname}/server/index.mjs'],
      env: { JUSTRIGIT_EXPORT_DIR: '${user_config.export_dir}' },
    },
  },
  tools: [
    ['get_status', 'What is loaded and what to do next'],
    ['find_files', 'Find videos and 3D models on this computer'],
    ['load_character', 'Load a GLB/GLTF/FBX character'],
    ['auto_rig', 'Add a skeleton (with fingers) to a character'],
    ['capture_video', 'Turn a video of a person into an animation on the character'],
    ['wait_for_capture', 'Continue a capture that is still running'],
    ['add_animations', 'Add library or file animations'],
    ['get_viewport_snapshot', 'Picture of the character, optionally mid-animation'],
    ['run_health_check', 'Check for import problems'],
    ['export_bundle', 'Export for Unreal, Unity, Godot or Blender'],
  ].map(([name, description]) => ({ name, description })),
  tools_generated: true,
  keywords: ['3d', 'rigging', 'animation', 'motion capture', 'unreal', 'godot', 'unity', 'mixamo', 'game dev'],
  license: 'AGPL-3.0-or-later',
  compatibility: { platforms: ['win32', 'darwin', 'linux'], runtimes: { node: '>=18.0.0' } },
  user_config: {
    export_dir: {
      type: 'directory',
      title: 'Export folder',
      description: 'Where finished characters and animations are saved.',
      default: '${DOCUMENTS}/JustRigIt Exports',
      required: false,
    },
  },
};
fs.writeFileSync(path.join(STAGE, 'manifest.json'), JSON.stringify(manifest, null, 2));

// 6. zip it (an .mcpb is a zip with manifest.json at the root)
const files = {};
const add = (dir, rel = '') => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name), rp = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) add(fp, rp); else files[rp] = [new Uint8Array(fs.readFileSync(fp)), { level: /\.(node|png)$/.test(e.name) ? 6 : 9 }];
  }
};
add(STAGE);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, zipSync(files));
console.log(`${path.relative(process.cwd(), OUT)}  ${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB  (${Object.keys(files).length} files, image library: ${PLATFORM})`);
