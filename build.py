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
