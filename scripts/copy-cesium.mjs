// 拷贝 Cesium 静态资源到 public/cesium(Workers/Assets/ThirdParty/Widgets)
// 运行时 window.CESIUM_BASE_URL='/cesium/';产物不入 git(见 .gitignore)
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const DEST = join(ROOT, 'public/cesium');
const MARK = join(DEST, '.copied-for');

const pkgDir = dirname(require.resolve('cesium/package.json'));
const SRC = join(pkgDir, 'Build/Cesium');
const pkgVersion = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;

const DIRS = ['Workers', 'Assets', 'ThirdParty', 'Widgets'];

if (existsSync(MARK) && readFileSync(MARK, 'utf8').trim() === pkgVersion) {
  console.log(`cesium 静态资源已就位(v${pkgVersion}),跳过拷贝`);
  process.exit(0);
}

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });
for (const d of DIRS) {
  const src = join(SRC, d);
  if (!existsSync(src)) throw new Error(`缺少 ${src}`);
  cpSync(src, join(DEST, d), { recursive: true, dereference: true });
}
writeFileSync(MARK, pkgVersion);
console.log(`cesium v${pkgVersion} 静态资源已拷贝到 public/cesium/`);
