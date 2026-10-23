import json, sys, os
os.makedirs('dist', exist_ok=True); os.makedirs('test', exist_ok=True)
shell = open('src/shell.html', encoding='utf8').read()
app = open('src/app.js', encoding='utf8').read()
data = open('data/data.json', encoding='utf8').read().replace('</', '<\\/')
cdn = {"imports": {"three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
                   "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"}}
local = {"imports": {"three": "/three/build/three.module.js", "three/addons/": "/three/examples/jsm/"}}
def make(im):
    return shell.replace('%%DATA%%', data).replace('%%IMPORTMAP%%', json.dumps(im)).replace('%%APP%%', app)
open('dist/linyi-city.html', 'w', encoding='utf8').write(make(cdn))
# GitHub Pages entry: same page with a minimal document skeleton
open('index.html', 'w', encoding='utf8').write('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}</style></head><body>' + make(cdn) + '</body></html>')
skel = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0;font:14px system-ui}[hidden]{display:none!important}</style></head><body>'
open('test/index.html', 'w', encoding='utf8').write(skel + make(local) + '</body></html>')
print('built', len(make(cdn).encode()))

# ---------- docs/: self-contained website for GitHub Pages (no third-party CDN or web fonts) ----------
import re, shutil
THREE = os.environ.get('THREE_SRC', '/home/claude/linyi/three-src')
ADDONS = ['controls/MapControls.js', 'objects/Sky.js', 'objects/Water.js', 'postprocessing/EffectComposer.js',
          'postprocessing/RenderPass.js', 'postprocessing/UnrealBloomPass.js', 'postprocessing/OutputPass.js',
          'utils/BufferGeometryUtils.js']
if os.path.isdir(THREE):
    need, stack = set(), list(ADDONS)
    while stack:
        f = stack.pop()
        if f in need: continue
        need.add(f)
        for m in re.findall(r"from\s+'([^']+)'", open(f'{THREE}/examples/jsm/{f}', encoding='utf8').read()):
            if m != 'three':
                stack.append(os.path.normpath(os.path.join(os.path.dirname(f), m)))
    if os.path.isdir('docs/lib'): shutil.rmtree('docs/lib')
    os.makedirs('docs/lib/jsm', exist_ok=True)
    shutil.copy(f'{THREE}/build/three.module.min.js', 'docs/lib/three.module.min.js')
    shutil.copy(f'{THREE}/LICENSE', 'docs/lib/THREE-LICENSE')
    for f in need:
        os.makedirs(os.path.dirname(f'docs/lib/jsm/{f}'), exist_ok=True)
        shutil.copy(f'{THREE}/examples/jsm/{f}', f'docs/lib/jsm/{f}')
else:
    print('three.js source not found; keeping existing docs/lib')
site = {"imports": {"three": "./lib/three.module.min.js", "three/addons/": "./lib/jsm/"}}
page = re.sub(r'<link rel="(?:preconnect|stylesheet)" href="https://fonts\.[^>]*>\n?', '', make(site))
head = ('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<meta name="description" content="临沂兰山区北城新区可交互三维城市模型：电视塔、五洲湖、沂河与祊河，昼夜天气、车流与漫游。">'
        '<meta property="og:title" content="临沂北城三维城市"><meta property="og:description" content="在浏览器里漫游临沂北城新区：电视塔、五洲湖、沂河与祊河。">'
        '<style>[hidden]{display:none!important}</style></head><body>')
os.makedirs('docs', exist_ok=True)
open('docs/index.html', 'w', encoding='utf8').write(head + page + '</body></html>')
open('docs/.nojekyll', 'w').write('')
print('site', len(page.encode()), 'bytes + lib')
