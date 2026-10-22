import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* ------------------------------------------------------------------ *
 *  临沂 · 北城新区  —  real OSM footprints, procedural everything else
 *  World frame: x = metres east, z = metres south, y = up.
 *  Origin 35.0905N 118.359E.
 * ------------------------------------------------------------------ */

const D = JSON.parse(document.getElementById('city-data').textContent);
const LAT = 35.0905, LON = 118.359;
const [BX0, BZ0, BX1, BZ1] = D.bbox;
const $ = (id) => document.getElementById(id);
const isTouch = matchMedia('(pointer: coarse)').matches;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- small utils ----------
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const R = rng(20261022);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const pairs = (f) => { const o = []; for (let i = 0; i < f.length; i += 2) o.push([f[i], f[i + 1]]); return o; };
const tick = () => new Promise((r) => setTimeout(r, 0));

function polyArea(p) { let a = 0; for (let i = 0; i < p.length; i++) { const [x1, z1] = p[i], [x2, z2] = p[(i + 1) % p.length]; a += x1 * z2 - x2 * z1; } return a / 2; }
function pip(x, z, p) { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, zi] = p[i], [xj, zj] = p[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; }
function deckProfile(L, s) {
  const H = clamp(L * 0.06, 2.5, 9), Rr = Math.min(L * 0.3, 120);
  const sm = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  return H * sm(s / Rr) * sm((L - s) / Rr);
}

// ---------- value noise for textures ----------
function noiseField(w, h, cells, seed, oct = 4) {
  const out = new Float32Array(w * h);
  const r = rng(seed);
  let amp = 1, tot = 0, c = cells;
  for (let o = 0; o < oct; o++) {
    const g = new Float32Array(c * c); for (let i = 0; i < g.length; i++) g[i] = r();
    for (let y = 0; y < h; y++) {
      const fy = (y / h) * c, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < w; x++) {
        const fx = (x / w) * c, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx);
        const a = g[(y0 % c) * c + (x0 % c)], b = g[(y0 % c) * c + ((x0 + 1) % c)];
        const cc = g[((y0 + 1) % c) * c + (x0 % c)], d = g[((y0 + 1) % c) * c + ((x0 + 1) % c)];
        out[y * w + x] += amp * lerp(lerp(a, b, sx), lerp(cc, d, sx), sy);
      }
    }
    tot += amp; amp *= 0.5; c *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function texFrom(canvas, { srgb = true, repeat = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  return t;
}
function noiseCanvas(w, h, cells, seed, base, amp, extra) {
  const c = makeCanvas(w, h), g = c.getContext('2d');
  const n = noiseField(w, h, cells, seed);
  const img = g.createImageData(w, h);
  const fine = rng(seed + 9);
  for (let i = 0; i < w * h; i++) {
    const v = (n[i] - 0.5) * amp + (fine() - 0.5) * amp * 0.35;
    img.data[i * 4] = clamp(base[0] + v * 255, 0, 255);
    img.data[i * 4 + 1] = clamp(base[1] + v * 255, 0, 255);
    img.data[i * 4 + 2] = clamp(base[2] + v * 255, 0, 255);
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  if (extra) extra(g, w, h);
  return c;
}

// ---------- renderer / scene ----------
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
let quality = isTouch ? 'low' : 'high';
renderer.setPixelRatio(Math.min(devicePixelRatio, quality === 'high' ? 1.75 : 1));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.6;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xa9bccb, 0.00022);
const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.5, 60000);

const rtMain = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, stencilBuffer: true, samples: 4 });
const composer = new EffectComposer(renderer, rtMain);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.2, 0.55, 0.88);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------- lights ----------
const sun = new THREE.DirectionalLight(0xfff1dc, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
const SH = 520;
Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 10, far: 5000 });
sun.shadow.bias = -0.00035; sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xbcd3ea, 0x6f6658, 1.0);
scene.add(hemi);
const moon = new THREE.DirectionalLight(0x9db4ff, 0.0);
scene.add(moon, moon.target);

// ---------- sky ----------
const sky = new Sky();
sky.scale.setScalar(40000);
sky.renderOrder = -1000;
sky.material.depthTest = false;
scene.add(sky);
const skyU = sky.material.uniforms;
skyU.mieCoefficient.value = 0.005; skyU.mieDirectionalG.value = 0.82;

const envScene = new THREE.Scene();
const skyEnv = new Sky(); skyEnv.material = sky.material; skyEnv.scale.setScalar(900); envScene.add(skyEnv);
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null;

// night dome: light-polluted horizon + deep zenith, added over the sky
const nightDome = new THREE.Mesh(new THREE.SphereGeometry(38000, 32, 16), new THREE.ShaderMaterial({
  uniforms: { uAmt: { value: 0 } },
  vertexShader: `varying vec3 vD;
    void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); gl_Position.z = gl_Position.w; }`,
  fragmentShader: `varying vec3 vD; uniform float uAmt;
    void main(){ float h = clamp(vD.y,0.,1.);
      vec3 c = mix(vec3(0.010,0.011,0.019), vec3(0.0015,0.003,0.011), smoothstep(0.0,0.4,h));
      c += vec3(0.022,0.012,0.006) * (1.0 - smoothstep(0.0,0.12,h));
      gl_FragColor = vec4(c*uAmt, 1.); }`,
  side: THREE.BackSide, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
}));
nightDome.renderOrder = -999;
scene.add(nightDome);

// stars + moon
const starGeo = new THREE.BufferGeometry();
{
  const n = 2600, pos = new Float32Array(n * 3), sz = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = R(), v = R() * 0.95 + 0.05, th = 2 * Math.PI * u, ph = Math.acos(v);
    pos.set([Math.sin(ph) * Math.cos(th) * 36000, Math.cos(ph) * 36000, Math.sin(ph) * Math.sin(th) * 36000], i * 3);
    sz[i] = R() ** 3 * 2.2 + 0.7;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
}
const stars = new THREE.Points(starGeo, new THREE.ShaderMaterial({
  uniforms: { uAmt: { value: 0 }, uTime: { value: 0 } },
  vertexShader: `attribute float aSize; varying float vS; uniform float uTime;
    void main(){ vS = aSize; vec4 mv = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*mv; gl_Position.z = gl_Position.w;
      gl_PointSize = aSize*(1.0+0.25*sin(uTime*3.0+position.x)); }`,
  fragmentShader: `varying float vS; uniform float uAmt;
    void main(){ float d = length(gl_PointCoord-0.5); float a = smoothstep(0.5,0.0,d); gl_FragColor = vec4(vec3(0.9,0.93,1.0)*a*uAmt*min(vS,1.6), 1.); }`,
  transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
}));
stars.renderOrder = -998;
scene.add(stars);
const moonDisc = new THREE.Mesh(new THREE.CircleGeometry(190, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, depthTest: false, depthWrite: false, transparent: true }));
moonDisc.renderOrder = -997;
scene.add(moonDisc);

// cloud deck
const clouds = new THREE.Mesh(new THREE.PlaneGeometry(70000, 70000, 1, 1), new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uCover: { value: 0.2 }, uSunDir: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() }, uAmb: { value: new THREE.Color() }, uDark: { value: 0 } },
  vertexShader: `varying vec3 vW;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w;
    #include <logdepthbuf_vertex>
    }`,
  fragmentShader: `varying vec3 vW; uniform float uTime, uCover, uDark; uniform vec3 uSunDir, uSunCol, uAmb;
    #include <common>
    #include <logdepthbuf_pars_fragment>
    float h2(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
    float vn(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
      return mix(mix(h2(i),h2(i+vec2(1,0)),u.x), mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),u.x), u.y); }
    float fbm(vec2 p){ float v=0., a=.5; for(int i=0;i<6;i++){ v+=a*vn(p); p=p*2.03+vec2(1.7,9.2); a*=.5; } return v; }
    void main(){
      #include <logdepthbuf_fragment>
      vec2 p = vW.xz/3200. + vec2(uTime*0.0035, uTime*0.0012);
      float n = fbm(p);
      float d = clamp(smoothstep(1.0-uCover-0.08, 1.0-uCover+0.32, n) + pow(uCover, 6.0)*1.2, 0.0, 1.0);
      float n2 = fbm(p + normalize(uSunDir.xz+1e-4)*0.06);
      float lit = clamp(0.55 + (n-n2)*4.0, 0., 1.);
      vec3 col = mix(uAmb*0.8, uSunCol, lit*(1.0-uDark*0.7));
      float dist = length(vW.xz - cameraPosition.xz);
      float fade = 1.0 - smoothstep(9000., 30000., dist);
      gl_FragColor = vec4(col, d*fade);
    }`,
  transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
}));
clouds.rotation.x = Math.PI / 2;
clouds.position.y = 1900;
clouds.renderOrder = -500;
scene.add(clouds);

// ---------- textures ----------
const TEX = {};
function buildTextures() {
  // paved ground, 32 m per tile
  // urban ground: paved plazas broken by lawn patches, 96 m per tile
  {
    const N = 1024, m = noiseField(N, N, 6, 13, 5), f = noiseField(N, N, 64, 17, 2), r = rng(19);
    const c = makeCanvas(N, N), g = c.getContext('2d'), img = g.createImageData(N, N);
    for (let i = 0; i < N * N; i++) {
      const lawn = smooth(0.40, 0.49, m[i]);
      const n = (f[i] - 0.5) * 0.5 + (r() - 0.5) * 0.12;
      const pr = 146 + n * 36, pg = 139 + n * 36, pb = 126 + n * 34;
      const gr = 96 + n * 60, gg = 116 + n * 60, gb = 70 + n * 40;
      img.data[i * 4] = lerp(pr, gr, lawn); img.data[i * 4 + 1] = lerp(pg, gg, lawn); img.data[i * 4 + 2] = lerp(pb, gb, lawn); img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    g.strokeStyle = 'rgba(80,74,66,0.14)'; g.lineWidth = 1;
    for (let i = 0; i <= N; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, N); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(N, i); g.stroke(); }
    TEX.ground = texFrom(c);
    TEX.ground.repeat.set(1 / 96, 1 / 96);
  }
  TEX.grass = texFrom(noiseCanvas(512, 512, 6, 21, [104, 128, 70], 0.35));
  TEX.grass.repeat.set(1 / 24, 1 / 24);
  TEX.sand = texFrom(noiseCanvas(256, 256, 6, 31, [206, 188, 150], 0.22));
  TEX.sand.repeat.set(1 / 16, 1 / 16);
  TEX.roof = texFrom(noiseCanvas(256, 256, 4, 41, [176, 174, 168], 0.2, (g) => {
    g.strokeStyle = 'rgba(40,40,40,0.15)'; for (let i = 0; i < 256; i += 32) { g.strokeRect(i, 0, 32, 256); }
  }));
  TEX.roof.repeat.set(1 / 16, 1 / 16);
  TEX.paver = texFrom(noiseCanvas(256, 256, 4, 51, [170, 165, 156], 0.18, (g) => {
    g.strokeStyle = 'rgba(80,76,70,0.28)'; g.lineWidth = 1.5;
    for (let y = 0; y < 256; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); for (let x = (y / 32) % 2 ? 16 : 0; x < 256; x += 32) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 32); g.stroke(); } }
  }));
  TEX.stone = texFrom(noiseCanvas(256, 256, 8, 61, [150, 144, 132], 0.3, (g) => {
    g.strokeStyle = 'rgba(50,46,40,0.45)'; g.lineWidth = 2;
    for (let y = 0; y < 256; y += 42) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); for (let x = (y / 42) % 2 ? 0 : 40; x < 256; x += 80) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 42); g.stroke(); } }
  }));
  TEX.stone.repeat.set(1 / 5, 1 / 5);

  // water normal map (tileable)
  {
    const N = 256, h = noiseField(N, N, 8, 71, 5), c = makeCanvas(N, N), g = c.getContext('2d'), img = g.createImageData(N, N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const dx = h[y * N + ((x + 1) % N)] - h[y * N + ((x - 1 + N) % N)];
      const dy = h[((y + 1) % N) * N + x] - h[((y - 1 + N) % N) * N + x];
      const nx = -dx * 6, ny = -dy * 6, nz = 1, l = Math.hypot(nx, ny, nz), i = (y * N + x) * 4;
      img.data[i] = (nx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[i + 2] = (nz / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    TEX.waterN = texFrom(c, { srgb: false });
  }

  // light pool
  {
    const c = makeCanvas(128, 128), g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    TEX.pool = texFrom(c, { repeat: false });
  }
  // headlight beam
  {
    const c = makeCanvas(64, 128), g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 128, 0, 0); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.moveTo(26, 128); g.lineTo(38, 128); g.lineTo(64, 0); g.lineTo(0, 0); g.closePath(); g.fill();
    TEX.beam = texFrom(c, { repeat: false });
  }

  // facades: 8 bays (3.5 m) x 8 floors (3 m) per 512 px tile
  const facade = (kind, seed) => {
    const S = 512, cw = 64, ch = 64, r = rng(seed);
    const base = makeCanvas(S, S), emis = makeCanvas(S, S);
    const g = base.getContext('2d'), e = emis.getContext('2d');
    const wallN = noiseCanvas(S, S, 16, seed, kind === 'off' ? [120, 132, 140] : kind === 'pub' ? [214, 208, 196] : [226, 222, 214], kind === 'off' ? 0.12 : 0.12);
    g.drawImage(wallN, 0, 0);
    e.fillStyle = '#000'; e.fillRect(0, 0, S, S);
    const litCol = () => {
      const t = r();
      if (kind === 'off') return t < 0.45 ? `rgb(${200 + r() * 40},${222 + r() * 25},${235 + r() * 20})` : `rgb(255,${226 + r() * 20},${190 + r() * 30})`;
      return t < 0.75 ? `rgb(255,${190 + r() * 40},${110 + r() * 50})` : `rgb(${235 + r() * 20},${235 + r() * 20},${220 + r() * 25})`;
    };
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
      const x = col * cw, y = row * ch;
      if (kind === 'res') {
        // window + balcony slab
        const wx = x + 12, wy = y + 14, ww = 40, wh = 30;
        const gr = g.createLinearGradient(0, wy, 0, wy + wh); gr.addColorStop(0, '#5d6c78'); gr.addColorStop(1, '#2c3640');
        g.fillStyle = '#efece6'; g.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
        g.fillStyle = gr; g.fillRect(wx, wy, ww, wh);
        g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(wx + ww / 2 - 1, wy, 2, wh);
        if (col % 2 === 0) { g.fillStyle = 'rgba(245,243,238,0.95)'; g.fillRect(x + 4, y + 47, 56, 7); g.fillStyle = 'rgba(90,96,100,0.55)'; g.fillRect(x + 4, y + 40, 56, 2); }
        if (r() < 0.25) { g.fillStyle = '#d9d9d6'; g.fillRect(x + 52, y + 50, 9, 7); }
        if (r() < 0.5) { e.fillStyle = litCol(); e.globalAlpha = 0.55 + r() * 0.45; e.fillRect(wx, wy, ww, wh); e.globalAlpha = 1; }
      } else if (kind === 'off') {
        for (let k = 0; k < 2; k++) {
          const px = x + k * 32 + 2, py = y + 2, pw = 28, ph = 50;
          const gr = g.createLinearGradient(0, py, 0, py + ph); gr.addColorStop(0, `rgb(${120 + r() * 30},${150 + r() * 25},${170 + r() * 20})`); gr.addColorStop(1, `rgb(${50 + r() * 15},${72 + r() * 15},${88 + r() * 15})`);
          g.fillStyle = gr; g.fillRect(px, py, pw, ph);
          if (r() < 0.42) { e.fillStyle = litCol(); e.globalAlpha = 0.5 + r() * 0.5; e.fillRect(px, py, pw, ph); e.globalAlpha = 1; }
        }
        g.fillStyle = 'rgba(40,46,52,0.9)'; g.fillRect(x, y + 54, cw, 10);
        g.fillStyle = 'rgba(200,210,215,0.5)'; g.fillRect(x, y, 2, ch);
      } else {
        const px = x + 18, py = y + 6, pw = 28, ph = 52;
        const gr = g.createLinearGradient(0, py, 0, py + ph); gr.addColorStop(0, '#6b7a84'); gr.addColorStop(1, '#323b43');
        g.fillStyle = gr; g.fillRect(px, py, pw, ph);
        g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(px, py + ph / 2, pw, 2);
        if (r() < 0.35) { e.fillStyle = litCol(); e.globalAlpha = 0.6; e.fillRect(px, py, pw, ph); e.globalAlpha = 1; }
      }
    }
    const t1 = texFrom(base), t2 = texFrom(emis);
    t1.repeat.set(1 / 28, 1 / 24); t2.repeat.set(1 / 28, 1 / 24);
    return [t1, t2];
  };
  [TEX.resA, TEX.resE] = facade('res', 101);
  [TEX.offA, TEX.offE] = facade('off', 202);
  [TEX.pubA, TEX.pubE] = facade('pub', 303);

  // asphalt with markings, 8 m per tile along v; u spans road width
  const roadTex = (lanes, oneway, plain, ped) => {
    const W = 256, H = 256, c = noiseCanvas(W, H, 8, 81 + lanes * 7 + (oneway ? 3 : 0), ped ? [168, 160, 150] : [62, 64, 66], ped ? 0.18 : 0.16);
    const g = c.getContext('2d');
    if (ped) { g.strokeStyle = 'rgba(90,84,76,0.35)'; for (let y = 0; y < H; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); } return texFrom(c); }
    if (plain) return texFrom(c);
    const line = (u, dashed, color, wpx = 4) => { g.fillStyle = color; const x = u * W - wpx / 2; if (dashed) g.fillRect(x, 0, wpx, H * 0.375); else g.fillRect(x, 0, wpx, H); };
    line(0.03, false, 'rgba(235,235,230,0.85)'); line(0.97, false, 'rgba(235,235,230,0.85)');
    if (oneway) { for (let i = 1; i < lanes; i++) line(i / lanes, true, 'rgba(235,235,230,0.8)'); }
    else {
      g.fillStyle = 'rgba(232,186,60,0.9)'; g.fillRect(W / 2 - 6, 0, 4, H); g.fillRect(W / 2 + 2, 0, 4, H);
      const per = Math.max(1, Math.floor(lanes / 2));
      for (let i = 1; i < per; i++) { line(0.5 * i / per, true, 'rgba(235,235,230,0.8)'); line(0.5 + 0.5 * i / per, true, 'rgba(235,235,230,0.8)'); }
    }
    return texFrom(c);
  };
  TEX.road = {};
  for (let l = 1; l <= 5; l++) TEX.road['o' + l] = roadTex(l, true);
  for (const l of [2, 4, 6]) TEX.road['t' + l] = roadTex(l, false);
  TEX.road.plain = roadTex(1, false, true);
  TEX.road.ped = roadTex(1, false, false, true);
}

// ---------- materials ----------
const MAT = {};
const stencilCut = { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp };
function buildMaterials() {
  MAT.ground = new THREE.MeshStandardMaterial({ map: TEX.ground, roughness: 0.95, color: 0xffffff, vertexColors: true, ...stencilCut });
  MAT.grass = new THREE.MeshStandardMaterial({ map: TEX.grass, roughness: 1, color: 0xffffff, ...stencilCut });
  MAT.wood = new THREE.MeshStandardMaterial({ map: TEX.grass, roughness: 1, color: 0x8a9a78, ...stencilCut });
  MAT.pitch = new THREE.MeshStandardMaterial({ map: TEX.grass, roughness: 1, color: 0xa5c98d, ...stencilCut });
  MAT.sand = new THREE.MeshStandardMaterial({ map: TEX.sand, roughness: 1, ...stencilCut });
  MAT.paver = new THREE.MeshStandardMaterial({ map: TEX.paver, roughness: 0.9, ...stencilCut });
  MAT.stone = new THREE.MeshStandardMaterial({ map: TEX.stone, roughness: 0.9, side: THREE.DoubleSide });
  MAT.coping = new THREE.MeshStandardMaterial({ color: 0xc9c3b6, roughness: 0.8 });
  MAT.rail = new THREE.MeshStandardMaterial({ color: 0x5d6064, roughness: 0.5, metalness: 0.6 });
  MAT.concrete = new THREE.MeshStandardMaterial({ color: 0xb9b6ae, roughness: 0.85, map: TEX.roof });
  MAT.roof = new THREE.MeshStandardMaterial({ map: TEX.roof, roughness: 0.95, vertexColors: true });
  const wall = (map, emis, rough, metal, emiCol) => new THREE.MeshStandardMaterial({ map, emissiveMap: emis, emissive: new THREE.Color(emiCol), emissiveIntensity: 0, roughness: rough, metalness: metal, vertexColors: true, envMapIntensity: metal > 0.3 ? 1.0 : 0.6 });
  MAT.res = wall(TEX.resA, TEX.resE, 0.82, 0.0, 0xffffff);
  MAT.off = wall(TEX.offA, TEX.offE, 0.22, 0.55, 0xffffff);
  MAT.pub = wall(TEX.pubA, TEX.pubE, 0.7, 0.05, 0xffffff);
  MAT.shell = new THREE.MeshStandardMaterial({ color: 0xf1efe9, roughness: 0.35, metalness: 0.15, envMapIntensity: 0.9 });
  MAT.road = {};
  for (const k in TEX.road) {
    TEX.road[k].repeat.set(1, 1 / 8);
    MAT.road[k] = new THREE.MeshStandardMaterial({ map: TEX.road[k], roughness: 0.92, ...stencilCut });
    MAT.road[k + '_br'] = new THREE.MeshStandardMaterial({ map: TEX.road[k], roughness: 0.92 });
  }
}

// ---------- geometry helpers ----------
class GeoBuilder {
  constructor(color = false) { this.p = []; this.n = []; this.uv = []; this.c = color ? [] : null; this.idx = []; this.groups = null; }
  get count() { return this.p.length / 3; }
  v(x, y, z, nx, ny, nz, u, w, col) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, w); if (this.c) this.c.push(col.r, col.g, col.b); return this.count - 1; }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.c) g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}
function shapeFrom(ring) { return new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z))); }
function flatShapeGeo(rings, y) {
  // rings: [outer, ...holes] as [[x,z],...]
  const s = shapeFrom(rings[0]);
  for (let i = 1; i < rings.length; i++) s.holes.push(new THREE.Path(rings[i].map(([x, z]) => new THREE.Vector2(x, -z))));
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}
function cylBetween(a, b, r0, r1 = r0, seg = 8) {
  const d = new THREE.Vector3().subVectors(b, a), L = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, L, seg, 1, false);
  g.translate(0, L / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  g.applyQuaternion(q); g.translate(a.x, a.y, a.z);
  return g;
}

// ---------- world content ----------
const world = { buildings: [], walk: null, roadsCar: [], labels: [], lampPoolY: [] };
let water, waterSimple, waterMask;

function buildGround() {
  const g = new THREE.PlaneGeometry(60000, 60000, 240, 240);
  g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 60000, uv.getY(i) * 60000);
  // beyond the mapped district the ground fades to a darker, greener outskirts tone
  const gp = g.attributes.position, gc = new Float32Array(gp.count * 3), far = new THREE.Color(0x5d6650).convertSRGBToLinear();
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), z = gp.getZ(i);
    const dx = Math.max(0, Math.abs(x - (BX0 + BX1) / 2) - (BX1 - BX0) / 2), dz = Math.max(0, Math.abs(z - (BZ0 + BZ1) / 2) - (BZ1 - BZ0) / 2);
    const t = smooth(0, 1800, Math.hypot(dx, dz));
    gc[i * 3] = lerp(1, far.r * 1.6, t); gc[i * 3 + 1] = lerp(1, far.g * 1.6, t); gc[i * 3 + 2] = lerp(1, far.b * 1.6, t);
  }
  g.setAttribute('color', new THREE.BufferAttribute(gc, 3));
  const m = new THREE.Mesh(g, MAT.ground);
  m.receiveShadow = true;
  scene.add(m);

  // water: stencil mask on the ground plane + reflective surface below bank top
  const maskGeos = [];
  for (const w of D.water) maskGeos.push(flatShapeGeo(w.map(pairs), 0));
  waterMask = new THREE.Mesh(mergeGeometries(maskGeos), new THREE.MeshBasicMaterial({
    colorWrite: false, depthWrite: false, depthTest: false,
    stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilFail: THREE.ReplaceStencilOp,
  }));
  waterMask.renderOrder = -100;
  scene.add(waterMask);

  // Water.js derives its mirror plane from the mesh transform, so rotate the mesh, not the geometry
  const wg = new THREE.PlaneGeometry(BX1 - BX0 + 400, BZ1 - BZ0 + 400);
  water = new Water(wg, {
    textureWidth: 1024, textureHeight: 1024, waterNormals: TEX.waterN,
    sunDirection: new THREE.Vector3(), sunColor: 0xffffff, waterColor: 0x3a7778, distortionScale: 1.4, fog: true,
  });
  water.material.uniforms.size.value = 5.0;
  water.material.uniforms.uRefl = { value: 0.6 };
  water.material.fragmentShader = water.material.fragmentShader
    .replace('uniform float alpha;', 'uniform float alpha;\nuniform float uRefl;')
    .replace(/vec3 albedo = mix\([^;]*;/, 'float fres = 0.06 + 0.94 * pow( 1.0 - theta, 4.0 );\n vec3 albedo = waterColor * ( 1.0 - fres ) + reflectionSample * uRefl * fres + specularLight * 0.8;');
  water.rotation.x = -Math.PI / 2;
  water.position.set((BX0 + BX1) / 2, -1.6, (BZ0 + BZ1) / 2);
  scene.add(water);
  waterSimple = new THREE.Mesh(wg.clone().rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1d4a50, roughness: 0.08, metalness: 0.2, normalMap: TEX.waterN, normalScale: new THREE.Vector2(0.4, 0.4), envMapIntensity: 1.2 }));
  TEX.waterN2 = TEX.waterN.clone(); waterSimple.material.normalMap = TEX.waterN2; TEX.waterN2.repeat.set(60, 60); TEX.waterN2.needsUpdate = true;
  waterSimple.position.copy(water.position);
  waterSimple.visible = false;
  scene.add(waterSimple);
}

function buildGreens() {
  const groups = { wood: [], park: [], grass: [], beach: [], pitch: [] };
  for (const [k, f] of D.green) {
    const ring = pairs(f);
    const y = { beach: 0.04, grass: 0.06, park: 0.05, wood: 0.07, pitch: 0.08 }[k];
    try { groups[k].push(flatShapeGeo([ring], y)); } catch (e) { /* degenerate polygon */ }
  }
  const matFor = { wood: MAT.wood, park: MAT.grass, grass: MAT.grass, beach: MAT.sand, pitch: MAT.pitch };
  for (const k in groups) {
    if (!groups[k].length) continue;
    const g = mergeGeometries(groups[k]);
    // uv = world metres
    const p = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), p.getZ(i));
    const m = new THREE.Mesh(g, matFor[k]); m.receiveShadow = true; scene.add(m);
  }
}

function buildBanks() {
  const wall = new GeoBuilder(), cop = new GeoBuilder();
  const posts = [];
  const TOP = 0.35, BOT = -4.0, CW = 1.2;
  for (const bk of D.banks) {
    const side = bk[0], pts = pairs(bk.slice(1));
    let acc = 0, nextPost = 0;
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
      const L = Math.hypot(bx - ax, bz - az); if (L < 0.05) continue;
      const tx = (bx - ax) / L, tz = (bz - az) / L;
      const lx = -tz * side, lz = tx * side; // towards land
      // wall faces water (normal = -land)
      const a = wall.v(ax, TOP, az, -lx, 0, -lz, acc, TOP), b = wall.v(bx, TOP, bz, -lx, 0, -lz, acc + L, TOP);
      const c = wall.v(bx, BOT, bz, -lx, 0, -lz, acc + L, BOT), d = wall.v(ax, BOT, az, -lx, 0, -lz, acc, BOT);
      wall.quad(a, b, c, d);
      // coping on land side
      const e = cop.v(ax, TOP, az, 0, 1, 0, 0, 0), f = cop.v(bx, TOP, bz, 0, 1, 0, 0, 0);
      const g2 = cop.v(bx + lx * CW, TOP, bz + lz * CW, 0, 1, 0, 0, 0), h = cop.v(ax + lx * CW, TOP, az + lz * CW, 0, 1, 0, 0, 0);
      cop.quad(e, f, g2, h); cop.quad(e, h, g2, f);
      while (nextPost < acc + L) { const s = nextPost - acc; posts.push([ax + tx * s + lx * 0.25, az + tz * s + lz * 0.25, Math.atan2(tx, tz)]); nextPost += 2.5; }
      acc += L;
    }
  }
  const wm = new THREE.Mesh(wall.build(), MAT.stone); wm.receiveShadow = true; scene.add(wm);
  const cm = new THREE.Mesh(cop.build(), MAT.coping); cm.receiveShadow = true; scene.add(cm);
  // railing: posts + top rail as instanced thin boxes
  const postGeo = new THREE.BoxGeometry(0.08, 1.05, 0.08); postGeo.translate(0, TOP + 0.52, 0);
  const pm = new THREE.InstancedMesh(postGeo, MAT.rail, posts.length);
  const railGeo = new THREE.BoxGeometry(0.06, 0.06, 2.5); railGeo.translate(0, TOP + 1.05, 0);
  const rm = new THREE.InstancedMesh(railGeo, MAT.rail, posts.length);
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  posts.forEach(([x, z, yaw], i) => {
    q.setFromAxisAngle(up, yaw);
    mtx.compose(new THREE.Vector3(x, 0, z), q, one); pm.setMatrixAt(i, mtx);
    mtx.compose(new THREE.Vector3(x + Math.sin(yaw) * 1.25, 0, z + Math.cos(yaw) * 1.25), q, one); rm.setMatrixAt(i, mtx);
  });
  pm.frustumCulled = rm.frustumCulled = false;
  scene.add(pm, rm);
}

const RES_TINT = ['#e8e1d6', '#d9d2c4', '#e6ddd0', '#cfc9c0', '#e3d6c3', '#d8cfc8', '#c9c2b8', '#efe9df', '#d6dbe0', '#e0d0c0'];
const OFF_TINT = ['#c6d4dc', '#b8c8d0', '#d0d8dc', '#aebfc9', '#9fb3bf', '#c9d1cf'];
const PUB_TINT = ['#e9e4da', '#f0ece4', '#d9d3c8'];

function buildBuildings() {
  const B = { 0: new GeoBuilder(true), 1: new GeoBuilder(true), 2: new GeoBuilder(true) };
  const roofs = new GeoBuilder(true);
  const shell = new GeoBuilder();
  const col = new THREE.Color();
  for (const [f, H, k, isShell, name] of D.b) {
    let p = pairs(f);
    if (polyArea(p) < 0) p = p.slice().reverse();
    const tint = (k === 0 ? RES_TINT : k === 1 ? OFF_TINT : PUB_TINT)[Math.floor(R() * (k === 0 ? RES_TINT.length : k === 1 ? OFF_TINT.length : PUB_TINT.length))];
    col.set(tint).convertSRGBToLinear();
    const cx = p.reduce((s, q) => s + q[0], 0) / p.length, cz = p.reduce((s, q) => s + q[1], 0) / p.length;
    world.buildings.push({ p, H, name, cx, cz });
    const g = isShell ? shell : B[k];
    const wallH = isShell ? H * 0.42 : H;
    let acc = R() * 28;
    const vOff = Math.floor(R() * 8) * 3;
    for (let i = 0; i < p.length; i++) {
      const [ax, az] = p[i], [bx, bz] = p[(i + 1) % p.length];
      const L = Math.hypot(bx - ax, bz - az); if (L < 0.05) continue;
      const nx = (bz - az) / L, nz = -(bx - ax) / L; // outward for CCW (x,z)
      if (isShell) {
        const a = g.v(ax, 0, az, nx, 0, nz, 0, 0), b = g.v(bx, 0, bz, nx, 0, nz, 0, 0), c = g.v(bx, wallH, bz, nx, 0, nz, 0, 0), d = g.v(ax, wallH, az, nx, 0, nz, 0, 0);
        g.tri(a, c, b); g.tri(a, d, c);
      } else {
        const u0 = acc, u1 = acc + L;
        const a = g.v(ax, 0, az, nx, 0, nz, u0, vOff, col), b = g.v(bx, 0, bz, nx, 0, nz, u1, vOff, col), c = g.v(bx, wallH, bz, nx, 0, nz, u1, vOff + wallH, col), d = g.v(ax, wallH, az, nx, 0, nz, u0, vOff + wallH, col);
        g.tri(a, c, b); g.tri(a, d, c);
        // parapet lip
      }
      acc += L;
    }
    if (isShell) {
      // stacked shrinking rings rising to a soft crown
      const rings = [1, 0.86, 0.68, 0.46, 0.22];
      const prev = [];
      rings.forEach((s, ri) => {
        const t = ri / (rings.length - 1);
        const y = wallH + (H - wallH) * Math.sin(t * Math.PI / 2);
        prev.push(p.map(([x, z]) => [cx + (x - cx) * s, y, cz + (z - cz) * s]));
      });
      for (let r = 0; r < prev.length - 1; r++) {
        const A = prev[r], Bn = prev[r + 1];
        for (let i = 0; i < A.length; i++) {
          const j = (i + 1) % A.length;
          const v = [A[i], A[j], Bn[j], Bn[i]].map((q) => new THREE.Vector3(...q));
          const nrm = new THREE.Vector3().subVectors(v[1], v[0]).cross(new THREE.Vector3().subVectors(v[3], v[0])).normalize();
          if (nrm.y < 0) nrm.negate();
          const ids = v.map((q) => g.v(q.x, q.y, q.z, nrm.x, nrm.y, nrm.z, 0, 0));
          g.tri(ids[0], ids[2], ids[1]); g.tri(ids[0], ids[3], ids[2]);
          g.tri(ids[0], ids[1], ids[2]); g.tri(ids[0], ids[2], ids[3]);
        }
      }
      const top = prev[prev.length - 1];
      const capC = g.v(cx, H, cz, 0, 1, 0, 0, 0);
      for (let i = 0; i < top.length; i++) { const j = (i + 1) % top.length; const a = g.v(...top[i], 0, 1, 0, 0, 0), b = g.v(...top[j], 0, 1, 0, 0, 0); g.tri(capC, a, b); g.tri(capC, b, a); }
      continue;
    }
    // roof
    const rc = col.clone().multiplyScalar(0.92);
    const contour = p.map(([x, z]) => new THREE.Vector2(x, z));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const base = roofs.count;
    for (const [x, z] of p) roofs.v(x, H, z, 0, 1, 0, x, z, rc);
    for (const [a, b, c] of tris) {
      const [ax, az] = p[a], [bx, bz] = p[b], [cx2, cz2] = p[c];
      const cross = (bx - ax) * (cz2 - az) - (bz - az) * (cx2 - ax);
      if (cross > 0) roofs.tri(base + a, base + c, base + b); else roofs.tri(base + a, base + b, base + c);
    }
    // parapet: thin rim around roof edge
    for (let i = 0; i < p.length; i++) {
      const [ax, az] = p[i], [bx, bz] = p[(i + 1) % p.length];
      const L = Math.hypot(bx - ax, bz - az); if (L < 0.05) continue;
      const nx = (bz - az) / L, nz = -(bx - ax) / L;
      const a = roofs.v(ax, H, az, nx, 0, nz, 0, 0, rc), b = roofs.v(bx, H, bz, nx, 0, nz, 0, 0, rc), c = roofs.v(bx, H + 1.1, bz, nx, 0, nz, 0, 0, rc), d = roofs.v(ax, H + 1.1, az, nx, 0, nz, 0, 0, rc);
      roofs.tri(a, c, b); roofs.tri(a, d, c);
    }
    // rooftop machine room on taller blocks
    if (H > 28 && pip(cx, cz, p)) {
      const ext = Math.min(...p.map(([x, z]) => Math.hypot(x - cx, z - cz)));
      const s = clamp(ext * 0.6, 2.5, 7), h = 3.6;
      const box = new THREE.BoxGeometry(s * 1.4, h, s);
      const ang = Math.atan2(p[1][1] - p[0][1], p[1][0] - p[0][0]);
      box.rotateY(-ang); box.translate(cx, H + h / 2, cz);
      const bp = box.attributes.position, bn = box.attributes.normal, bi = box.index.array, b0 = roofs.count;
      for (let i = 0; i < bp.count; i++) roofs.v(bp.getX(i), bp.getY(i), bp.getZ(i), bn.getX(i), bn.getY(i), bn.getZ(i), bp.getX(i) + bp.getY(i), bp.getZ(i), rc);
      for (let i = 0; i < bi.length; i += 3) roofs.tri(b0 + bi[i], b0 + bi[i + 1], b0 + bi[i + 2]);
    }
  }
  const mk = (gb, mat) => { const m = new THREE.Mesh(gb.build(), mat); m.castShadow = true; m.receiveShadow = true; scene.add(m); return m; };
  mk(B[0], MAT.res); mk(B[1], MAT.off); mk(B[2], MAT.pub); mk(roofs, MAT.roof); mk(shell, MAT.shell);
}

// ---------- roads ----------
function roadKey(r) {
  const [cls, w, br, ow] = r;
  if (cls === 'pedestrian') return 'ped';
  if (['service', 'living_street'].includes(cls)) return 'plain';
  const lanes = Math.max(1, Math.round(w / 3.5));
  if (ow) return 'o' + clamp(lanes, 1, 5);
  if (lanes < 2) return 'plain';
  return 't' + (lanes >= 6 ? 6 : lanes >= 4 ? 4 : 2);
}
function ribbon(gb, pts, w, yAt, vScale = 1, uScale = 1) {
  // pts [[x,z]], yAt(s) -> y
  const n = pts.length;
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const base = gb.count;
  for (let i = 0; i < n; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[Math.min(n - 1, i + 1)];
    let t1x = p1[0] - p0[0], t1z = p1[1] - p0[1], t2x = p2[0] - p1[0], t2z = p2[1] - p1[1];
    const l1 = Math.hypot(t1x, t1z) || 1, l2 = Math.hypot(t2x, t2z) || 1;
    t1x /= l1; t1z /= l1; t2x /= l2; t2z /= l2;
    if (i === 0) { t1x = t2x; t1z = t2z; } if (i === n - 1) { t2x = t1x; t2z = t1z; }
    let tx = t1x + t2x, tz = t1z + t2z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const nx = -tz, nz = tx; // right normal
    const cosA = Math.max(0.4, nx * -t1z + nz * t1x);
    const hw = (w / 2) / cosA;
    const y = yAt(cum[i]);
    gb.v(p1[0] - nx * hw, y, p1[1] - nz * hw, 0, 1, 0, 0, cum[i] * vScale);
    gb.v(p1[0] + nx * hw, y, p1[1] + nz * hw, 0, 1, 0, uScale, cum[i] * vScale);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = base + i * 2, b = a + 1, c = a + 3, d = a + 2;
    gb.tri(a, b, c); gb.tri(a, c, d);
  }
  return cum;
}
function buildRoads() {
  const gbs = {};
  const getGB = (k) => (gbs[k] ||= new GeoBuilder());
  const side = new GeoBuilder();
  const bridgeSide = new GeoBuilder();
  const piers = [];
  const MAJOR = new Set(['trunk', 'primary', 'secondary', 'tertiary']);
  const order = { trunk: 0.16, primary: 0.15, secondary: 0.14, tertiary: 0.13, trunk_link: 0.125, primary_link: 0.125, secondary_link: 0.12, tertiary_link: 0.12, residential: 0.11, unclassified: 0.11, living_street: 0.1, service: 0.1, pedestrian: 0.095 };
  for (const r of D.r) {
    const [cls, w, br, ow, name, f] = r;
    const pts = pairs(f);
    if (pts.length < 2) continue;
    let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const y0 = order[cls] ?? 0.1;
    const yAt = br ? (s) => y0 + deckProfile(L, s) : () => y0;
    const key = roadKey(r) + (br ? '_br' : '');
    ribbon(getGB(key), pts, w, yAt, 1);
    if (MAJOR.has(cls) && !br) ribbon(side, pts, w + 7, () => 0.085, 1 / 4, (w + 7) / 4);
    if (br) {
      // deck edges, parapets and piers
      const gb = bridgeSide;
      const n = pts.length; let acc = 0;
      for (let i = 1; i < n; i++) {
        const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
        const sl = Math.hypot(bx - ax, bz - az); if (sl < 0.05) continue;
        const tx = (bx - ax) / sl, tz = (bz - az) / sl, nx = -tz, nz = tx;
        for (const sd of [-1, 1]) {
          const ox = nx * sd * w / 2, oz = nz * sd * w / 2;
          const ya = yAt(acc), yb = yAt(acc + sl);
          const nn = [nx * sd, 0, nz * sd];
          // parapet (1.1 m) and fascia (1.4 m down)
          const a = gb.v(ax + ox, ya + 1.1, az + oz, ...nn, 0, 0), b = gb.v(bx + ox, yb + 1.1, bz + oz, ...nn, 0, 0);
          const c = gb.v(bx + ox, yb - 1.4, bz + oz, ...nn, 0, 0), d = gb.v(ax + ox, ya - 1.4, az + oz, ...nn, 0, 0);
          gb.tri(a, b, c); gb.tri(a, c, d); gb.tri(a, c, b); gb.tri(a, d, c);
        }
        // underside
        {
          const ya = yAt(acc) - 1.4, yb = yAt(acc + sl) - 1.4;
          const a = gb.v(ax - nx * w / 2, ya, az - nz * w / 2, 0, -1, 0, 0, 0), b = gb.v(bx - nx * w / 2, yb, bz - nz * w / 2, 0, -1, 0, 0, 0);
          const c = gb.v(bx + nx * w / 2, yb, bz + nz * w / 2, 0, -1, 0, 0, 0), d = gb.v(ax + nx * w / 2, ya, az + nz * w / 2, 0, -1, 0, 0, 0);
          gb.tri(a, c, b); gb.tri(a, d, c);
        }
        let s = (Math.ceil(acc / 38) * 38) - acc;
        while (s < sl) { const yy = yAt(acc + s); if (yy > 2.4) piers.push([ax + tx * s, az + tz * s, Math.atan2(tx, tz), yy - 1.4, w]); s += 38; }
        acc += sl;
      }
    }
    if (!['pedestrian', 'service', 'living_street'].includes(cls)) world.roadsCar.push({ cls, w, br, ow, pts, L });
  }
  for (const k in gbs) {
    const m = new THREE.Mesh(gbs[k].build(), MAT.road[k]);
    m.receiveShadow = true; scene.add(m);
  }
  const sm = new THREE.Mesh(side.build(), MAT.paver); sm.receiveShadow = true; scene.add(sm);
  const bm = new THREE.Mesh(bridgeSide.build(), MAT.concrete); bm.castShadow = true; bm.receiveShadow = true; scene.add(bm);
  // piers
  const pg = new THREE.BoxGeometry(1, 1, 1); pg.translate(0, 0.5, 0);
  const pm = new THREE.InstancedMesh(pg, MAT.concrete, piers.length);
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  piers.forEach(([x, z, yaw, top, w], i) => { q.setFromAxisAngle(up, yaw); mtx.compose(new THREE.Vector3(x, -4, z), q, new THREE.Vector3(w * 0.7, top + 4, 2.2)); pm.setMatrixAt(i, mtx); });
  pm.castShadow = true; pm.frustumCulled = false; scene.add(pm);
}

// ---------- trees ----------
let crownMesh, trunkMesh, crownMat;
function buildTrees() {
  const T = D.trees, n = T.length / 4;
  const crownGeo = new THREE.IcosahedronGeometry(1, 2);
  {
    const p = crownGeo.attributes.position; const r = rng(5);
    const map = new Map();
    for (let i = 0; i < p.count; i++) {
      const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
      if (!map.has(key)) map.set(key, 0.82 + r() * 0.3);
      const s = map.get(key); p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.9, p.getZ(i) * s);
    }
    crownGeo.computeVertexNormals();
  }
  const trunkGeo = new THREE.CylinderGeometry(0.13, 0.2, 1, 6); trunkGeo.translate(0, 0.5, 0);
  crownMat = new THREE.MeshStandardMaterial({ roughness: 0.92, color: 0xffffff });
  crownMesh = new THREE.InstancedMesh(crownGeo, crownMat, n);
  trunkMesh = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x4f4338, roughness: 1 }), n);
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
  // late-October palette: mostly green, ginkgo gold and some red-turning maples
  const greens = ['#4a6338', '#55703f', '#435c33', '#5b7540', '#506b45', '#5f6f3e'];
  for (let i = 0; i < n; i++) {
    const x = T[i * 4], z = T[i * 4 + 1], s = T[i * 4 + 2], t = T[i * 4 + 3];
    let h = 3.2 * s, sx = 3.0 * s, sy = 3.4 * s;
    if (t === 1) { sx = 2.2 * s; sy = 4.6 * s; h = 2.4 * s; }
    if (t === 2) { sx = 3.6 * s; sy = 2.8 * s; h = 2.8 * s; }
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * 6.28);
    mtx.compose(new THREE.Vector3(x, h + sy * 0.75, z), q, new THREE.Vector3(sx, sy, sx));
    crownMesh.setMatrixAt(i, mtx);
    mtx.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, h + sy * 0.4, s));
    trunkMesh.setMatrixAt(i, mtx);
    const rr = R();
    if (t === 2) col.set(rr < 0.7 ? '#7d9a4a' : '#9aa94e');
    else if (t === 1) col.set('#3d5a33');
    else if (rr < 0.07) col.set('#b39a45');
    else if (rr < 0.1) col.set('#93573a');
    else col.set(greens[Math.floor(R() * greens.length)]);
    col.offsetHSL(0, 0, (R() - 0.5) * 0.06);
    crownMesh.setColorAt(i, col);
  }
  crownMesh.castShadow = true; trunkMesh.castShadow = false;
  crownMesh.receiveShadow = true;
  crownMesh.frustumCulled = trunkMesh.frustumCulled = false;
  scene.add(crownMesh, trunkMesh);
}

// ---------- street lamps ----------
let lampHeadMat, poolMat, poolMesh;
function buildLamps() {
  const L = D.lamps, n = L.length / 5;
  const roadIdx = [], promIdx = [];
  for (let i = 0; i < n; i++) (L[i * 5 + 4] === 0 ? roadIdx : promIdx).push(i);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x55595d, roughness: 0.45, metalness: 0.7 });
  lampHeadMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
  const roadPole = mergeGeometries([
    (() => { const g = new THREE.CylinderGeometry(0.08, 0.13, 9, 6); g.translate(0, 4.5, 0); return g; })(),
    (() => { const g = new THREE.BoxGeometry(0.1, 0.1, 2.2); g.translate(0, 8.9, 1.1); return g; })(),
  ]);
  const roadHead = (() => { const g = new THREE.BoxGeometry(0.42, 0.14, 0.9); g.translate(0, 8.82, 2.1); return g; })();
  const promPole = (() => { const g = new THREE.CylinderGeometry(0.06, 0.08, 3.6, 6); g.translate(0, 1.8 + 0.35, 0); return g; })();
  const promHead = (() => { const g = new THREE.SphereGeometry(0.28, 10, 8); g.translate(0, 3.95 + 0.35, 0); return g; })();
  const mk = (geo, mat, idx, shadow) => { const m = new THREE.InstancedMesh(geo, mat, idx.length); m.castShadow = shadow; m.frustumCulled = false; scene.add(m); return m; };
  const meshes = [mk(roadPole, poleMat, roadIdx, true), mk(roadHead, lampHeadMat, roadIdx, false), mk(promPole, poleMat, promIdx, false), mk(promHead, lampHeadMat, promIdx, false)];
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  const pools = [];
  roadIdx.forEach((i, k) => {
    const x = L[i * 5], y = L[i * 5 + 1], z = L[i * 5 + 2], yaw = L[i * 5 + 3];
    q.setFromAxisAngle(up, yaw); mtx.compose(new THREE.Vector3(x, y, z), q, one);
    meshes[0].setMatrixAt(k, mtx); meshes[1].setMatrixAt(k, mtx);
    pools.push([x + Math.sin(yaw) * 2.1, y + 0.2, z + Math.cos(yaw) * 2.1, 9]);
  });
  promIdx.forEach((i, k) => {
    const x = L[i * 5], y = L[i * 5 + 1], z = L[i * 5 + 2];
    mtx.compose(new THREE.Vector3(x, y, z), q.identity(), one);
    meshes[2].setMatrixAt(k, mtx); meshes[3].setMatrixAt(k, mtx);
    pools.push([x, y + 0.42, z, 5]);
  });
  const pg = new THREE.PlaneGeometry(2, 2); pg.rotateX(-Math.PI / 2);
  poolMat = new THREE.MeshBasicMaterial({ map: TEX.pool, color: 0xffb05a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
  poolMesh = new THREE.InstancedMesh(pg, poolMat, pools.length);
  pools.forEach(([x, y, z, r], i) => { mtx.compose(new THREE.Vector3(x, y, z), q.identity(), new THREE.Vector3(r, 1, r)); poolMesh.setMatrixAt(i, mtx); });
  poolMesh.frustumCulled = false; poolMesh.renderOrder = 5;
  scene.add(poolMesh);
}

// ---------- 临沂广播电视塔 (326 m) ----------
let towerLED = [], towerBeacons = [], towerGlow;
function buildTower() {
  const [TX, TZ, TH] = D.tower;
  const grp = new THREE.Group(); grp.position.set(TX, 0, TZ);
  const steel = new THREE.MeshStandardMaterial({ color: 0xd3d8dc, roughness: 0.32, metalness: 0.85, envMapIntensity: 1.1 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.55, metalness: 0.05 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fb8c6, roughness: 0.06, metalness: 0.95, envMapIntensity: 1.4, emissive: 0xffd9a0, emissiveIntensity: 0 });
  const add = (g, m, cast = true) => { const me = new THREE.Mesh(g, m); me.castShadow = cast; me.receiveShadow = true; grp.add(me); return me; };
  // plaza
  const plazaTex = TEX.paver.clone(); plazaTex.repeat.set(31, 31); plazaTex.needsUpdate = true;
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(62, 64), new THREE.MeshStandardMaterial({ map: plazaTex, roughness: 0.85 }));
  plaza.rotation.x = -Math.PI / 2; plaza.position.y = 0.2; plaza.receiveShadow = true; grp.add(plaza);
  // core shaft
  add(new THREE.CylinderGeometry(4.3, 6.6, 205, 32, 1), steel).position.y = 102.5;
  add(new THREE.CylinderGeometry(3.6, 4.3, 64, 32, 1), steel).position.y = 237;
  // spherical pod (observation sphere) with glass mullion rings
  const PC = 228, PR = 21;
  const sph = add(new THREE.SphereGeometry(PR, 64, 40), glass);
  sph.position.y = PC;
  for (const dy of [-16, -11, -5.5, 5.5, 11, 16]) {
    const rr = Math.sqrt(PR * PR - dy * dy);
    const t = add(new THREE.TorusGeometry(rr + 0.08, 0.16, 6, 72), steel, false); t.rotation.x = Math.PI / 2; t.position.y = PC + dy;
  }
  for (let k = 0; k < 16; k++) {
    const t = add(new THREE.TorusGeometry(PR + 0.06, 0.12, 4, 64, Math.PI), steel, false);
    t.rotation.y = (k / 16) * Math.PI; t.rotation.z = Math.PI / 2; t.position.y = PC;
  }
  // 224 m outdoor deck ring around the sphere's equator band
  add(new THREE.CylinderGeometry(PR + 2.6, PR + 2.6, 0.7, 72), white).position.y = 223.6;
  { const t = add(new THREE.TorusGeometry(PR + 2.5, 0.07, 4, 96), steel, false); t.rotation.x = Math.PI / 2; t.position.y = 224.9; }
  // mast with stepped antenna
  add(new THREE.CylinderGeometry(1.15, 1.7, 32, 16), steel).position.y = 286;
  add(new THREE.CylinderGeometry(0.35, 0.95, 24, 12), steel).position.y = 314;
  // 算盘珠: stainless beads on the shaft
  const bead = new THREE.LatheGeometry([[4.3, -1.9], [8.6, -0.3], [8.6, 0.3], [4.3, 1.9]].map(([r, y]) => new THREE.Vector2(r, y)), 32);
  for (const y of [128, 140, 152, 164, 176, 188]) add(bead, steel).position.y = y;
  // three Y-shaped trusses
  const legR = 1.25;
  for (let k = 0; k < 3; k++) {
    const th = k * (Math.PI * 2 / 3) + Math.PI / 6;
    const dir = (a, r, y) => new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
    const knot = dir(th, 21, 46), top = dir(th, 5.2, 112);
    const f1 = dir(th - 0.24, 50, 0), f2 = dir(th + 0.24, 50, 0);
    add(cylBetween(f1, knot, legR * 1.15, legR), steel);
    add(cylBetween(f2, knot, legR * 1.15, legR), steel);
    add(cylBetween(knot, top, legR, legR * 0.8), steel);
    for (let j = 1; j <= 3; j++) {
      const t = j / 4, a = f1.clone().lerp(knot, t), b = f2.clone().lerp(knot, t);
      add(cylBetween(a, b, 0.35), steel, false);
      add(cylBetween(a, f2.clone().lerp(knot, t - 0.25), 0.25), steel, false);
    }
    add(cylBetween(knot, dir(th, 6.4, 46), 0.45), steel, false);
    // LED line along the leg (night show)
    const led = new THREE.Mesh(cylBetween(knot.clone().add(new THREE.Vector3(0, 0.8, 0)), top.clone().add(new THREE.Vector3(0, 0.8, 0)), 0.22), new THREE.MeshBasicMaterial({ color: 0 }));
    grp.add(led); towerLED.push(led);
  }
  // 空间螺旋桁架: double helix around the lower shaft
  for (const phase of [0, Math.PI]) {
    const pts = [];
    for (let i = 0; i <= 160; i++) { const t = i / 160, a = phase + t * Math.PI * 2 * 1.35, r = lerp(26, 8.5, t), y = lerp(8, 122, t); pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r)); }
    const curve = new THREE.CatmullRomCurve3(pts);
    add(new THREE.TubeGeometry(curve, 240, 0.85, 8), steel);
    const led = new THREE.Mesh(new THREE.TubeGeometry(curve, 240, 0.3, 6), new THREE.MeshBasicMaterial({ color: 0 }));
    led.position.y = 1.0; grp.add(led); towerLED.push(led);
    // rungs to the shaft
    for (let i = 8; i <= 152; i += 16) { const p = pts[i]; const inner = new THREE.Vector3(p.x, p.y, p.z).setLength(0).add(new THREE.Vector3(Math.cos(Math.atan2(p.z, p.x)) * 6, p.y, Math.sin(Math.atan2(p.z, p.x)) * 6)); add(cylBetween(p, inner, 0.3), steel, false); }
  }
  // 太极: inclined single-plane ring truss with an S-curve
  {
    const tj = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(19, 0.75, 8, 96), steel); ring.castShadow = true; tj.add(ring);
    const arc1 = new THREE.Mesh(new THREE.TorusGeometry(9.5, 0.55, 8, 48, Math.PI), steel); arc1.position.x = 9.5; tj.add(arc1);
    const arc2 = new THREE.Mesh(new THREE.TorusGeometry(9.5, 0.55, 8, 48, Math.PI), steel); arc2.position.x = -9.5; arc2.rotation.z = Math.PI; tj.add(arc2);
    tj.position.set(-30, 26, 18); tj.rotation.set(0.35, 0.9, 0.95);
    grp.add(tj);
  }
  // 竹简 base: fanned slats around a glass drum
  add(new THREE.CylinderGeometry(27, 29, 10, 48, 1, true), glass).position.y = 5;
  add(new THREE.CylinderGeometry(29.5, 29.5, 0.8, 48), white).position.y = 10.2;
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2;
    const g = new THREE.BoxGeometry(3.4, 15 + 4 * Math.sin(i * 1.7), 0.45);
    const m = add(g, white);
    m.position.set(Math.cos(a) * 34, 7, Math.sin(a) * 34);
    m.rotation.y = -a + Math.PI / 2 + 0.55;
    m.rotation.x = -0.32;
  }
  // aviation beacons
  for (const y of [TH, 298, 270, 226]) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(y === TH ? 0.9 : 0.6, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
    if (y === TH) b.position.y = y; else { b.position.set(y === 226 ? 23.4 : 1.8, y, 0); }
    grp.add(b); towerBeacons.push(b);
  }
  // warm pod glow for night
  towerGlow = glass;
  scene.add(grp);
  world.tower = grp;
}

// ---------- traffic ----------
const traffic = { cars: [], edges: [], nodes: [] };
let carBody, carHead, carTail, carBeam, busBody;
function buildTraffic() {
  const SPEED = { trunk: 16, primary: 14, secondary: 12, tertiary: 10, trunk_link: 10, primary_link: 9, secondary_link: 9, tertiary_link: 8, residential: 7, unclassified: 7 };
  const nodes = [], hash = new Map();
  const nodeAt = (x, z) => {
    const kx = Math.round(x / 6), kz = Math.round(z / 6);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const arr = hash.get((kx + dx) + ',' + (kz + dz)); if (!arr) continue;
      for (const id of arr) { const nd = nodes[id]; if (Math.hypot(nd.x - x, nd.z - z) < 4) return id; }
    }
    const id = nodes.length; nodes.push({ x, z, out: [] });
    const k = kx + ',' + kz; if (!hash.has(k)) hash.set(k, []); hash.get(k).push(id);
    return id;
  };
  for (const r of world.roadsCar) {
    const cum = [0]; for (let i = 1; i < r.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]));
    const e = { ...r, cum, len: cum[cum.length - 1], speed: SPEED[r.cls] || 8, lanes: Math.max(1, Math.round(r.w / 3.5)) };
    if (e.len < 5) continue;
    e.a = nodeAt(...r.pts[0]); e.b = nodeAt(...r.pts[r.pts.length - 1]);
    const id = traffic.edges.length; traffic.edges.push(e);
    nodes[e.a].out.push([id, 1]);
    if (!e.ow) nodes[e.b].out.push([id, -1]);
  }
  traffic.nodes = nodes;
  const totalLen = traffic.edges.reduce((s, e) => s + e.len * (e.ow ? 1 : 2), 0);
  const N = Math.min(520, Math.floor(totalLen / 70));
  // geometry: body w/ dark glass + wheels via vertex colour
  const vc = (g, c) => { const n = g.attributes.position.count, a = new Float32Array(n * 3).fill(c); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  const box = (w, h, l, x, y, z, c) => { const g = new THREE.BoxGeometry(w, h, l); g.translate(x, y, z); return vc(g, c); };
  const carGeo = mergeGeometries([box(1.8, 0.72, 4.5, 0, 0.62, 0, 1), box(1.62, 0.62, 2.3, 0, 1.28, -0.25, 0.08),
    ...[[-0.86, 1.45], [0.86, 1.45], [-0.86, -1.45], [0.86, -1.45]].map(([x, z]) => { const g = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 10); g.rotateZ(Math.PI / 2); g.translate(x, 0.33, z); return vc(g, 0.04); })]);
  const busGeo = mergeGeometries([box(2.5, 2.6, 11.5, 0, 1.75, 0, 1), box(2.52, 1.0, 10.6, 0, 2.2, 0.2, 0.1)]);
  const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.55, envMapIntensity: 1.0 });
  const nCar = Math.floor(N * 0.92), nBus = N - nCar;
  carBody = new THREE.InstancedMesh(carGeo, bodyMat, nCar);
  busBody = new THREE.InstancedMesh(busGeo, bodyMat, nBus);
  const hg = mergeGeometries([new THREE.BoxGeometry(0.34, 0.14, 0.05).translate(-0.62, 0.75, 2.26), new THREE.BoxGeometry(0.34, 0.14, 0.05).translate(0.62, 0.75, 2.26)]);
  const tg = mergeGeometries([new THREE.BoxGeometry(0.36, 0.12, 0.05).translate(-0.65, 0.82, -2.26), new THREE.BoxGeometry(0.36, 0.12, 0.05).translate(0.65, 0.82, -2.26)]);
  carHead = new THREE.InstancedMesh(hg, new THREE.MeshBasicMaterial({ color: 0xffffff }), N);
  carTail = new THREE.InstancedMesh(tg, new THREE.MeshBasicMaterial({ color: 0xff2010 }), N);
  const bg = new THREE.PlaneGeometry(3.6, 16); bg.rotateX(-Math.PI / 2); bg.translate(0, 0.25, 10.5);
  carBeam = new THREE.InstancedMesh(bg, new THREE.MeshBasicMaterial({ map: TEX.beam, color: 0xfff1d0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }), N);
  for (const m of [carBody, busBody, carHead, carTail, carBeam]) { m.frustumCulled = false; scene.add(m); }
  carBody.castShadow = busBody.castShadow = true;
  const palette = ['#f2f2f0', '#f2f2f0', '#1b1c1f', '#1b1c1f', '#8d939a', '#b9bec4', '#2a3a55', '#7a1f1f', '#e8e3d8', '#3c4a3f', '#c9b48a'];
  const busPal = ['#2f7d5a', '#2a64a8', '#d8d4c8'];
  const col = new THREE.Color();
  // distribute cars by edge length
  const pickEdge = () => {
    let t = R() * totalLen;
    for (let i = 0; i < traffic.edges.length; i++) { const e = traffic.edges[i]; const w = e.len * (e.ow ? 1 : 2); if ((t -= w) <= 0) return [i, e.ow ? 1 : (R() < 0.5 ? 1 : -1)]; }
    return [0, 1];
  };
  for (let i = 0; i < N; i++) {
    const bus = i >= nCar;
    const [ei, dir] = pickEdge();
    const c = { e: ei, dir, s: R() * traffic.edges[ei].len, v: 0, bus, mesh: bus ? busBody : carBody, mi: bus ? i - nCar : i, laneR: R(), vMul: 0.85 + R() * 0.3 };
    traffic.cars.push(c);
    col.set(bus ? busPal[i % busPal.length] : palette[Math.floor(R() * palette.length)]).convertSRGBToLinear();
    c.mesh.setColorAt(c.mi, col);
  }
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0);
function carPose(c, out) {
  const e = traffic.edges[c.e];
  const d = c.dir > 0 ? c.s : e.len - c.s;
  let i = 1; while (i < e.cum.length - 1 && e.cum[i] < d) i++;
  const t = (d - e.cum[i - 1]) / Math.max(1e-6, e.cum[i] - e.cum[i - 1]);
  const [ax, az] = e.pts[i - 1], [bx, bz] = e.pts[i];
  let tx = bx - ax, tz = bz - az; const l = Math.hypot(tx, tz) || 1; tx = tx / l * c.dir; tz = tz / l * c.dir;
  let off;
  if (e.ow) off = (Math.floor(c.laneR * e.lanes) + 0.5) * (e.w / e.lanes) - e.w / 2;
  else { const per = Math.max(1, Math.floor(e.lanes / 2)); off = (Math.floor(c.laneR * per) + 0.5) * (e.w / 2 / per); }
  if (c.bus) off = e.ow ? e.w / 2 - 1.9 : e.w / 2 - 1.9;
  const x = lerp(ax, bx, t) + (-tz) * off, z = lerp(az, bz, t) + tx * off;
  const y = (e.br ? deckProfile(e.len, d) : 0) + 0.16;
  out.x = x; out.y = y; out.z = z; out.yaw = Math.atan2(tx, tz);
  return out;
}
const pose = { x: 0, y: 0, z: 0, yaw: 0 };
const _busS = new THREE.Vector3(1.35, 2.2, 2.5);
function updateTraffic(dt) {
  const { cars, edges, nodes } = traffic;
  let hi = 0;
  for (const c of cars) {
    const e = edges[c.e];
    const vt = e.speed * c.vMul * (c.bus ? 0.8 : 1) * state.trafficSpeed;
    c.v = lerp(c.v, vt, Math.min(1, dt * 0.8));
    c.s += c.v * dt;
    let guard = 0;
    while (c.s > edges[c.e].len && guard++ < 4) {
      const ce = edges[c.e];
      c.s -= ce.len;
      const nid = c.dir > 0 ? ce.b : ce.a;
      let opts = nodes[nid].out.filter(([id]) => id !== c.e);
      if (!opts.length) opts = nodes[nid].out;
      if (!opts.length) { c.s = 0; c.dir = ce.ow ? 1 : -c.dir; break; }
      // prefer staying on similar or larger roads
      const w = opts.map(([id]) => (['trunk', 'primary', 'secondary'].includes(edges[id].cls) ? 3 : 1));
      let t = R() * w.reduce((a, b) => a + b, 0), k = 0; while ((t -= w[k]) > 0 && k < w.length - 1) k++;
      [c.e, c.dir] = opts[k];
      c.laneR = clamp(c.laneR + (R() - 0.5) * 0.3, 0, 0.999);
    }
    carPose(c, pose);
    _p.set(pose.x, pose.y, pose.z); _q.setFromAxisAngle(_up, pose.yaw);
    _m.compose(_p, _q, _s);
    c.mesh.setMatrixAt(c.mi, _m);
    carBeam.setMatrixAt(hi, _m);
    if (c.bus) _m.compose(_p, _q, _busS);
    carHead.setMatrixAt(hi, _m); carTail.setMatrixAt(hi, _m);
    c.px = pose.x; c.py = pose.y; c.pz = pose.z; c.yaw = pose.yaw;
    hi++;
  }
  carBody.instanceMatrix.needsUpdate = true; busBody.instanceMatrix.needsUpdate = true;
  carHead.instanceMatrix.needsUpdate = carTail.instanceMatrix.needsUpdate = carBeam.instanceMatrix.needsUpdate = true;
}

// ---------- weather particles ----------
let rain, snow;
function buildWeatherFX() {
  const box = new THREE.Vector3(220, 120, 220);
  {
    const N = 9000, pos = new Float32Array(N * 2 * 3), seed = new Float32Array(N * 2 * 3), end = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) { const s = [R(), R(), R()]; seed.set(s, i * 6); seed.set(s, i * 6 + 3); end[i * 2 + 1] = 1; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3)); g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    rain = new THREE.LineSegments(g, new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: box }, uAmt: { value: 0 }, uCol: { value: new THREE.Color(0.75, 0.8, 0.85) } },
      vertexShader: `attribute vec3 aSeed; attribute float aEnd; uniform float uTime; uniform vec3 uCam, uBox;
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main(){ vec3 p = aSeed*uBox; p.y = mod(p.y - uTime*24.0, uBox.y);
          p.xz = mod(p.xz - uCam.xz + uBox.xz*0.5 + vec2(uTime*1.5,0.0), uBox.xz) + uCam.xz - uBox.xz*0.5;
          p.y += uCam.y - uBox.y*0.45; p.y += aEnd*1.1; p.x -= aEnd*0.08;
          gl_Position = projectionMatrix*viewMatrix*vec4(p,1.);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `uniform float uAmt; uniform vec3 uCol;
        #include <common>
        #include <logdepthbuf_pars_fragment>
        void main(){
          #include <logdepthbuf_fragment>
          gl_FragColor = vec4(uCol, 0.32*uAmt); }`,
      transparent: true, depthWrite: false,
    }));
    rain.frustumCulled = false; rain.visible = false; scene.add(rain);
  }
  {
    const N = 7000, pos = new Float32Array(N * 3), seed = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) seed.set([R(), R(), R()], i * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    snow = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(160, 90, 160) }, uAmt: { value: 0 } },
      vertexShader: `attribute vec3 aSeed; uniform float uTime; uniform vec3 uCam, uBox;
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main(){ vec3 p = aSeed*uBox; p.y = mod(p.y - uTime*1.4, uBox.y);
          p.x += sin(uTime*0.7 + aSeed.z*40.0)*1.2; p.z += cos(uTime*0.5 + aSeed.x*40.0)*1.2;
          p.xz = mod(p.xz - uCam.xz + uBox.xz*0.5, uBox.xz) + uCam.xz - uBox.xz*0.5;
          p.y += uCam.y - uBox.y*0.45;
          vec4 mv = viewMatrix*vec4(p,1.); gl_Position = projectionMatrix*mv;
          gl_PointSize = clamp(90.0/-mv.z, 1.0, 9.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `uniform float uAmt;
        #include <common>
        #include <logdepthbuf_pars_fragment>
        void main(){
          #include <logdepthbuf_fragment>
          float d = length(gl_PointCoord-0.5); gl_FragColor = vec4(vec3(0.95), smoothstep(0.5,0.15,d)*0.9*uAmt); }`,
      transparent: true, depthWrite: false,
    }));
    snow.frustumCulled = false; snow.visible = false; scene.add(snow);
  }
}

// ---------- walkability raster (2 m / px) ----------
function buildWalkMask() {
  const S = 2, W = Math.ceil((BX1 - BX0) / S), H = Math.ceil((BZ1 - BZ0) / S);
  const c = makeCanvas(W, H), g = c.getContext('2d', { willReadFrequently: true });
  const tx = (x) => (x - BX0) / S, tz = (z) => (z - BZ0) / S;
  g.fillStyle = 'rgb(255,0,0)'; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgb(0,0,0)';
  for (const w of D.water) {
    g.beginPath();
    for (const ring of w) { const p = pairs(ring); g.moveTo(tx(p[0][0]), tz(p[0][1])); for (const [x, z] of p.slice(1)) g.lineTo(tx(x), tz(z)); g.closePath(); }
    g.fill('evenodd');
  }
  for (const b of world.buildings) { g.beginPath(); g.moveTo(tx(b.p[0][0]), tz(b.p[0][1])); for (const [x, z] of b.p.slice(1)) g.lineTo(tx(x), tz(z)); g.closePath(); g.fill(); }
  g.beginPath(); g.arc(tx(D.tower[0]), tz(D.tower[1]), 8 / S, 0, Math.PI * 2); g.fill();
  // bridge decks: walkable with height in G channel
  g.lineCap = 'round';
  for (const r of D.r) {
    if (!r[2]) continue;
    const pts = pairs(r[5]); let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const sl = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const steps = Math.max(1, Math.ceil(sl / 6));
      for (let k = 0; k < steps; k++) {
        const t0 = k / steps, t1 = (k + 1) / steps;
        const h = deckProfile(L, acc + sl * (t0 + t1) / 2);
        g.strokeStyle = `rgb(255,${Math.round(clamp(h * 20, 1, 255))},0)`;
        g.lineWidth = (r[1] + 1) / S;
        g.beginPath(); g.moveTo(tx(lerp(pts[i - 1][0], pts[i][0], t0)), tz(lerp(pts[i - 1][1], pts[i][1], t0))); g.lineTo(tx(lerp(pts[i - 1][0], pts[i][0], t1)), tz(lerp(pts[i - 1][1], pts[i][1], t1))); g.stroke();
      }
      acc += sl;
    }
  }
  const data = g.getImageData(0, 0, W, H).data;
  world.walk = { W, H, S, data };
}
function walkAt(x, z) {
  const m = world.walk; if (!m) return { ok: true, h: 0 };
  const i = Math.floor((x - BX0) / m.S), j = Math.floor((z - BZ0) / m.S);
  if (i < 0 || j < 0 || i >= m.W || j >= m.H) return { ok: false, h: 0 };
  const k = (j * m.W + i) * 4;
  return { ok: m.data[k] > 128, h: m.data[k + 1] / 20 };
}

// ---------- landmark labels ----------
function centroidOf(name) {
  const bs = world.buildings.filter((b) => b.name === name);
  if (!bs.length) return null;
  const x = bs.reduce((s, b) => s + b.cx, 0) / bs.length, z = bs.reduce((s, b) => s + b.cz, 0) / bs.length;
  return [x, Math.max(...bs.map((b) => b.H)), z];
}
function buildLabels() {
  const L = [];
  const add = (text, sub, x, y, z, kind = 'place') => L.push({ text, sub, pos: new THREE.Vector3(x, y, z), kind });
  add('临沂广播电视塔', '326 米', D.tower[0], D.tower[2] + 8, D.tower[1], 'major');
  add('五洲湖', '', -757, 12, -1013, 'water');
  add('沂河', '', 1250, 6, 250, 'water');
  add('祊河', '', -1050, 6, 720, 'water');
  add('柳青河', '', 300, 6, -300, 'water');
  add('三河口', '沂·祊·柳青交汇', 120, 6, 1330, 'water');
  for (const [n, sub] of [['临沂大剧院', ''], ['临沂市文化中心', ''], ['临沂市科技馆', ''], ['临沂市博物馆', '']]) { const c = centroidOf(n); if (c) add(n, sub, c[0], c[1] + 10, c[2]); }
  const br = D.r.find((r) => r[4] === '北京路沂河大桥');
  if (br) { const p = pairs(br[5]); add('北京路沂河大桥', '', (p[0][0] + p[p.length - 1][0]) / 2, 22, (p[0][1] + p[p.length - 1][1]) / 2); }
  const host = $('labels');
  for (const l of L) {
    const el = document.createElement('div');
    el.className = 'lbl lbl-' + l.kind;
    el.innerHTML = `<span class="lbl-t">${l.text}</span>${l.sub ? `<span class="lbl-s">${l.sub}</span>` : ''}`;
    host.appendChild(el); l.el = el;
  }
  world.labels = L;
}
const _v = new THREE.Vector3();
function updateLabels() {
  const show = state.labels;
  for (const l of world.labels) {
    if (!show) { l.el.style.opacity = 0; continue; }
    _v.copy(l.pos).project(camera);
    const dist = camera.position.distanceTo(l.pos);
    const vis = _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1 && dist < (l.kind === 'major' ? 9000 : 3800) && dist > 25;
    l.el.style.opacity = vis ? (l.kind === 'major' ? 1 : clamp(1.4 - dist / 3800, 0.35, 1)) : 0;
    if (vis) l.el.style.transform = `translate(${(_v.x * 0.5 + 0.5) * innerWidth}px, ${(-_v.y * 0.5 + 0.5) * innerHeight}px)`;
  }
}

// ---------- environment state ----------
const state = {
  hours: 16.75, playing: !reduceMotion, rate: 60, // game seconds per real second
  weather: 'clear', mode: 'orbit', labels: true, trafficSpeed: 1,
  snowCover: 0, wet: 0,
  w: { cover: 0.18, turb: 2.0, ray: 2.0, sunK: 1, fog: 0.00022, rain: 0, snow: 0, dark: 0 },
};
const WEATHER = {
  clear: { cover: 0.18, turb: 2.0, ray: 2.0, sunK: 1.0, fog: 0.00020, rain: 0, snow: 0, dark: 0 },
  cloudy: { cover: 0.56, turb: 6.5, ray: 1.0, sunK: 0.55, fog: 0.00030, rain: 0, snow: 0, dark: 0.25 },
  rain: { cover: 0.97, turb: 14, ray: 0.5, sunK: 0.1, fog: 0.0011, rain: 1, snow: 0, dark: 0.75 },
  fog: { cover: 0.75, turb: 12, ray: 0.6, sunK: 0.28, fog: 0.0042, rain: 0, snow: 0, dark: 0.5 },
  snow: { cover: 0.93, turb: 11, ray: 0.6, sunK: 0.22, fog: 0.0013, rain: 0, snow: 1, dark: 0.6 },
};
const WNAME = { clear: '晴', cloudy: '多云', rain: '雨', fog: '雾', snow: '雪' };

function dayOfYear() {
  const now = new Date(Date.now() + 8 * 3600e3); // Beijing date
  const start = Date.UTC(now.getUTCFullYear(), 0, 0);
  return Math.floor((now.getTime() - start) / 86400e3);
}
const DOY = dayOfYear();
function sunDir(hours, out) {
  const decl = -23.44 * Math.cos(2 * Math.PI / 365 * (DOY + 10)) * Math.PI / 180;
  const B = 2 * Math.PI * (DOY - 81) / 364;
  const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  const solar = hours + (4 * (LON - 120) + eot) / 60;
  const ha = (15 * (solar - 12)) * Math.PI / 180, lat = LAT * Math.PI / 180;
  const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const el = Math.asin(sinEl);
  const azS = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat));
  const az = azS + Math.PI; // from north, clockwise
  out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  return el * 180 / Math.PI;
}

const sunV = new THREE.Vector3(), moonV = new THREE.Vector3(), tmpC = new THREE.Color(), tmpC2 = new THREE.Color();
let lastEnv = { h: -99, w: '' }, elevNow = 0, nightNow = 0;
const C = (h) => new THREE.Color(h);
function updateEnvironment(dt, t) {
  // ease weather params
  const target = WEATHER[state.weather];
  const k = 1 - Math.exp(-dt * 1.2);
  for (const key in target) state.w[key] = lerp(state.w[key], target[key], k);
  const w = state.w;
  state.wet = lerp(state.wet, w.rain > 0.5 ? 1 : (w.snow > 0.5 ? 0.4 : 0), dt * 0.15);
  state.snowCover = clamp(state.snowCover + (w.snow > 0.5 ? dt * 0.04 : -dt * 0.02), 0, 0.75);

  const el = sunDir(state.hours, sunV); elevNow = el;
  const day = smooth(-4, 8, el);
  const night = 1 - smooth(-9, 1, el); nightNow = night;
  const golden = smooth(22, 3, el) * smooth(-3, 2, el);

  // sky
  skyU.sunPosition.value.copy(sunV);
  skyU.turbidity.value = w.turb; skyU.rayleigh.value = w.ray * (1 - night * 0.6);
  // sun light
  tmpC.copy(C(0xfff3e2)).lerp(C(0xff9a4d), golden);
  sun.color.copy(tmpC);
  sun.intensity = 3.4 * day * w.sunK * (1 - golden * 0.35);
  sun.castShadow = quality !== 'off' && sun.intensity > 0.15;
  // shadow follows the view focus
  const focus = state.mode === 'orbit' ? controls.target : camera.position;
  const fx = Math.round(focus.x / 4) * 4, fz = Math.round(focus.z / 4) * 4;
  sun.target.position.set(fx, 0, fz);
  sun.position.set(fx + sunV.x * 2000, Math.max(sunV.y, 0.05) * 2000, fz + sunV.z * 2000);
  // moon
  moonV.set(0.45, 0.62, 0.64).normalize();
  moon.intensity = 0.55 * night * (1 - w.dark * 0.8);
  moon.position.copy(moonV).multiplyScalar(2000).add(sun.target.position); moon.target.position.copy(sun.target.position);
  moonDisc.position.copy(camera.position).addScaledVector(moonV, 30000); moonDisc.lookAt(camera.position);
  moonDisc.material.opacity = night * (1 - w.cover);
  moonDisc.material.color.setScalar(1.6);
  // ambient
  hemi.color.copy(C(0xbcd3ea)).lerp(C(0x7f8a96), w.dark).lerp(C(0x23304a), night);
  hemi.groundColor.copy(C(0x6f6658)).lerp(C(0x2a2622), night);
  hemi.intensity = lerp(0.12, lerp(1.25, 1.0, w.dark), day) + golden * 0.1;
  // fog colour tracks the horizon
  const fogDay = tmpC.copy(C(0xb9c9d6)).lerp(C(0x9da4aa), w.dark);
  const fogGold = C(0xd9a983);
  fogDay.lerp(fogGold, golden * (1 - w.dark));
  fogDay.lerp(C(0x1c1d26), night);
  if (w.snow > 0.3) fogDay.lerp(C(0xc8cdd3), w.snow * day * 0.6);
  scene.fog.color.copy(fogDay);
  scene.fog.density = w.fog * (1 + night * 0.4);
  // clouds
  const cu = clouds.material.uniforms;
  cu.uCover.value = w.cover; cu.uTime.value = t; cu.uSunDir.value.copy(sunV); cu.uDark.value = w.dark;
  cu.uSunCol.value.copy(C(0xffffff)).lerp(C(0xffb07a), golden).multiplyScalar(lerp(0.03, 1.15, day) * lerp(1, 0.55, w.dark));
  cu.uAmb.value.copy(C(0x8d99a8)).lerp(C(0x5b6068), w.dark).multiplyScalar(lerp(0.06, 1, day)).add(tmpC2.set(0x2a1d14).multiplyScalar(night * 0.6));
  clouds.material.opacity = 1;
  nightDome.material.uniforms.uAmt.value = night;
  stars.material.uniforms.uAmt.value = night * (1 - w.cover) * (1 - w.fog * 120);
  stars.material.uniforms.uTime.value = t;
  // exposure
  renderer.toneMappingExposure = lerp(0.95, 0.58, day) * lerp(1, 1.12, w.dark * day);
  bloom.strength = lerp(0.12, 0.85, night);
  bloom.threshold = lerp(0.92, 0.6, night);
  // water
  const wu = water.material.uniforms;
  wu.time.value = t * 0.6;
  wu.sunDirection.value.copy(sunV);
  wu.sunColor.value.copy(sun.color).multiplyScalar(day * w.sunK);
  wu.waterColor.value.copy(C(0x3a7778)).lerp(C(0x22343a), w.dark).multiplyScalar(lerp(0.25, 1, day));
  wu.distortionScale.value = lerp(1.4, 4.5, w.rain);
  wu.uRefl.value = lerp(0.34, 0.85, night);
  TEX.waterN2.offset.set(t * 0.004, t * 0.003);
  // lights: windows, lamps, tower
  const lights = clamp(Math.max(night, w.dark * 0.35 * day + smooth(4, -2, el) * 0.0), 0, 1);
  MAT.res.emissiveIntensity = lights * 1.15;
  MAT.off.emissiveIntensity = lights * 0.75;
  MAT.pub.emissiveIntensity = lights * 0.9;
  const lamp = smooth(3, -3, el) + w.dark * 0.15;
  lampHeadMat.color.copy(C(0xffc27a)).multiplyScalar(clamp(lamp, 0, 1) * 7 + 0.15);
  poolMat.opacity = clamp(lamp, 0, 1) * 0.55;
  carHead.material.color.setScalar(0.6 + clamp(lamp + w.rain, 0, 1) * 7);
  carTail.material.color.setRGB(1, 0.12, 0.06).multiplyScalar(0.8 + clamp(lamp + w.rain, 0, 1) * 4);
  carBeam.material.opacity = clamp(lamp, 0, 1) * 0.35;
  towerGlow.emissiveIntensity = lights * 0.55;
  const hue = (t * 0.03) % 1;
  for (let i = 0; i < towerLED.length; i++) towerLED[i].visible = lights > 0.04;
  for (let i = 0; i < towerLED.length; i++) towerLED[i].material.color.setHSL((hue + i * 0.08) % 1, 0.85, 0.55).multiplyScalar(lights * 4.5);
  const blink = (Math.sin(t * 3.2) > 0.2 ? 1 : 0.1) * (0.3 + night * 6);
  for (const b of towerBeacons) b.material.color.setRGB(1, 0.12, 0.05).multiplyScalar(blink);
  // surfaces: wet roads, snow cover
  const wet = state.wet;
  for (const k in MAT.road) { const m = MAT.road[k]; m.roughness = lerp(0.92, 0.28, wet); m.color.setScalar(lerp(1, 0.62, wet)); }
  const sc = state.snowCover;
  MAT.ground.color.setScalar(1).lerp(C(0xf4f6f8).multiplyScalar(1.6), sc);
  MAT.grass.color.setScalar(1).lerp(C(0xf4f6f8).multiplyScalar(1.6), sc * 0.9);
  MAT.wood.color.copy(C(0x8a9a78)).lerp(C(0xe9edf0).multiplyScalar(1.4), sc * 0.8);
  MAT.roof.color.setScalar(1).lerp(C(0xffffff).multiplyScalar(1.8), sc);
  crownMat.color.setScalar(1).lerp(C(0xe8eef2).multiplyScalar(1.3), sc * 0.55);
  // particles
  rain.visible = w.rain > 0.02; rain.material.uniforms.uAmt.value = w.rain; rain.material.uniforms.uTime.value = t; rain.material.uniforms.uCam.value.copy(camera.position);
  snow.visible = w.snow > 0.02; snow.material.uniforms.uAmt.value = w.snow; snow.material.uniforms.uTime.value = t; snow.material.uniforms.uCam.value.copy(camera.position);
  // environment map refresh when the sky changed enough
  const envKey = state.weather;
  if (Math.abs(state.hours - lastEnv.h) > 0.2 || lastEnv.w !== envKey) {
    lastEnv = { h: state.hours, w: envKey };
    const old = envRT; envRT = pmrem.fromScene(envScene, 0, 1, 2000); scene.environment = envRT.texture; if (old) old.dispose();
  }
}

// ---------- camera & controls ----------
const controls = new MapControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.47; controls.minDistance = 25; controls.maxDistance = 5200;
controls.screenSpacePanning = false; controls.zoomToCursor = true;

const PLACES = {
  overview: { label: '全景', pos: [-1700, 1250, 2650], target: [-150, 0, -100] },
  tower: { label: '电视塔', pos: [-120, 210, 1590], target: [300, 130, 1010] },
  lake: { label: '五洲湖', pos: [-380, 330, -560], target: [-760, 0, -1010] },
  river: { label: '沂河', pos: [520, 140, 380], target: [1180, 10, -420] },
  culture: { label: '文化中心', pos: [-260, 260, 200], target: [-720, 20, -260] },
};
let flight = null;
function flyTo(key, dur = 2.4) {
  const p = PLACES[key];
  setMode('orbit');
  flight = { t: 0, dur: reduceMotion ? 0.01 : dur, p0: camera.position.clone(), t0: controls.target.clone(), p1: new THREE.Vector3(...p.pos), t1: new THREE.Vector3(...p.target) };
}
function updateFlight(dt) {
  if (!flight) return;
  flight.t += dt;
  const u = clamp(flight.t / flight.dur, 0, 1), e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
  const lift = Math.sin(u * Math.PI) * Math.min(600, flight.p0.distanceTo(flight.p1) * 0.25);
  camera.position.lerpVectors(flight.p0, flight.p1, e); camera.position.y += lift;
  controls.target.lerpVectors(flight.t0, flight.t1, e);
  if (u >= 1) flight = null;
}

// first-person (walk / fly) + follow
const fp = { yaw: 0, pitch: -0.05, keys: new Set(), vel: new THREE.Vector3(), y: 1.7, joy: { x: 0, y: 0 }, follow: null };
function setMode(m) {
  if (m === state.mode && m !== 'follow') return;
  const prev = state.mode;
  state.mode = m;
  document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
  controls.enabled = m === 'orbit';
  $('hint').hidden = m === 'orbit';
  $('joy').hidden = !(isTouch && (m === 'walk' || m === 'fly'));
  flight = null;
  if (m === 'walk' || m === 'fly') {
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    fp.yaw = Math.atan2(-dir.x, -dir.z); fp.pitch = m === 'walk' ? -0.04 : Math.asin(clamp(dir.y, -0.9, 0.9));
    if (m === 'walk') {
      // drop to street level near the current focus
      const f = prev === 'orbit' ? controls.target.clone() : camera.position.clone();
      const spot = sidewalkNear(f.x, f.z) || findWalkable(f.x, f.z);
      camera.position.set(spot[0], spot[2] + 1.7, spot[1]); fp.y = camera.position.y;
      if (spot[3] !== undefined) { fp.yaw = spot[3]; fp.pitch = 0.02; }
    }
    $('hint').textContent = isTouch ? (m === 'walk' ? '左侧拖动行走 · 右侧拖动转头' : '左侧拖动飞行 · 右侧拖动转向') : (m === 'walk' ? 'WASD 行走 · 拖动或点击锁定鼠标转头 · Shift 奔跑 · Esc 释放鼠标' : 'WASD 飞行 · E/空格 上升 · Q/C 下降 · Shift 加速 · 拖动转向');
  }
  if (m === 'follow') {
    const majors = traffic.cars.filter((c) => !c.bus && ['trunk', 'primary', 'secondary'].includes(traffic.edges[c.e].cls));
    fp.follow = (majors.length ? majors : traffic.cars)[Math.floor(R() * (majors.length || traffic.cars.length))];
    $('hint').textContent = '正在跟随一辆车 · 再点“跟车”换一辆';
    fp.snap = true;
  }
  if (m === 'orbit') {
    if (prev !== 'orbit') {
      const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
      const tgt = camera.position.clone().addScaledVector(dir, 120); tgt.y = 0;
      if (camera.position.y < 40) camera.position.y = 90;
      controls.target.copy(tgt);
    }
    if (document.pointerLockElement) document.exitPointerLock();
  }
}
function sidewalkNear(x, z) {
  // nearest point on a main street, stepped onto its pavement, facing along the street
  let best = null, bd = 1e9;
  for (const r of world.roadsCar) {
    if (r.br || !['primary', 'secondary', 'tertiary', 'trunk'].includes(r.cls)) continue;
    for (let i = 1; i < r.pts.length; i++) {
      const [ax, az] = r.pts[i - 1], [bx, bz] = r.pts[i];
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1);
      const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(px - x, pz - z);
      if (d < bd) { bd = d; best = { px, pz, dx, dz, w: r.w }; }
    }
  }
  if (!best || bd > 600) return null;
  const L = Math.hypot(best.dx, best.dz) || 1, tx = best.dx / L, tz = best.dz / L;
  for (const sd of [1, -1]) {
    const sx = best.px - tz * sd * (best.w / 2 + 2.2), sz = best.pz + tx * sd * (best.w / 2 + 2.2);
    const w = walkAt(sx, sz);
    if (w.ok) return [sx, sz, w.h, Math.atan2(-tx, -tz)];
  }
  return null;
}
function findWalkable(x, z) {
  for (let r = 0; r < 400; r += 4) {
    for (let a = 0; a < Math.PI * 2; a += Math.max(0.2, 4 / Math.max(r, 1))) {
      const px = clamp(x + Math.cos(a) * r, BX0 + 5, BX1 - 5), pz = clamp(z + Math.sin(a) * r, BZ0 + 5, BZ1 - 5);
      const w = walkAt(px, pz); if (w.ok) return [px, pz, w.h];
    }
  }
  return [x, z, 0];
}
addEventListener('keydown', (e) => {
  if (e.target.closest('input,select,textarea')) return;
  fp.keys.add(e.code);
  if (state.mode !== 'orbit' && ['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => fp.keys.delete(e.code));
addEventListener('blur', () => fp.keys.clear());
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  if (state.mode === 'walk' || state.mode === 'fly') {
    if (isTouch) return;
    drag = { x: e.clientX, y: e.clientY, moved: false };
    canvas.setPointerCapture(e.pointerId);
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (document.pointerLockElement === canvas) { fp.yaw -= e.movementX * 0.0022; fp.pitch = clamp(fp.pitch - e.movementY * 0.0022, -1.45, 1.45); return; }
  if (drag) { const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true; fp.yaw -= dx * 0.004; fp.pitch = clamp(fp.pitch - dy * 0.004, -1.45, 1.45); drag.x = e.clientX; drag.y = e.clientY; }
});
canvas.addEventListener('pointerup', () => {
  if (drag && !drag.moved && (state.mode === 'walk' || state.mode === 'fly') && canvas.requestPointerLock) { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (err) { /* not available here */ } }
  drag = null;
});
// touch: left half moves, right half looks
{
  const zone = $('joy');
  const touches = new Map();
  zone.addEventListener('pointerdown', (e) => { touches.set(e.pointerId, { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, left: e.clientX < innerWidth / 2 }); zone.setPointerCapture(e.pointerId); });
  zone.addEventListener('pointermove', (e) => {
    const t = touches.get(e.pointerId); if (!t) return;
    if (t.left) { fp.joy.x = clamp((e.clientX - t.x0) / 60, -1, 1); fp.joy.y = clamp((e.clientY - t.y0) / 60, -1, 1); }
    else { fp.yaw -= (e.clientX - t.x) * 0.006; fp.pitch = clamp(fp.pitch - (e.clientY - t.y) * 0.006, -1.4, 1.4); }
    t.x = e.clientX; t.y = e.clientY;
  });
  const end = (e) => { const t = touches.get(e.pointerId); if (t && t.left) fp.joy.x = fp.joy.y = 0; touches.delete(e.pointerId); };
  zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);
}
const _fwd = new THREE.Vector3(), _rt = new THREE.Vector3();
function updateFirstPerson(dt) {
  const k = fp.keys;
  let mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + fp.joy.x;
  let mz = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - fp.joy.y;
  const fast = k.has('ShiftLeft') || k.has('ShiftRight');
  camera.rotation.order = 'YXZ'; camera.rotation.set(fp.pitch, fp.yaw, 0);
  if (state.mode === 'walk') {
    const sp = fast ? 9 : 3.2;
    _fwd.set(-Math.sin(fp.yaw), 0, -Math.cos(fp.yaw)); _rt.set(Math.cos(fp.yaw), 0, -Math.sin(fp.yaw));
    const dx = (_fwd.x * mz + _rt.x * mx) * sp * dt, dz = (_fwd.z * mz + _rt.z * mx) * sp * dt;
    const p = camera.position;
    const cur = walkAt(p.x, p.z);
    const tryX = walkAt(p.x + dx * 3, p.z), tryZ = walkAt(p.x, p.z + dz * 3);
    const okStep = (w) => w.ok && Math.abs(w.h - cur.h) < 1.2;
    if (okStep(tryX) || !cur.ok) p.x += dx;
    if (okStep(tryZ) || !cur.ok) p.z += dz;
    const g = walkAt(p.x, p.z);
    const bob = (Math.abs(mx) + Math.abs(mz)) > 0.1 ? Math.sin(performance.now() * (fast ? 0.016 : 0.009)) * (fast ? 0.06 : 0.03) : 0;
    fp.y = lerp(fp.y, g.h + 1.7, Math.min(1, dt * 8));
    p.y = fp.y + bob;
  } else if (state.mode === 'fly') {
    const sp = fast ? 160 : 40;
    camera.getWorldDirection(_fwd); _rt.set(Math.cos(fp.yaw), 0, -Math.sin(fp.yaw));
    const up = (k.has('KeyE') || k.has('Space') ? 1 : 0) - (k.has('KeyQ') || k.has('KeyC') ? 1 : 0);
    fp.vel.lerp(_fwd.multiplyScalar(mz).addScaledVector(_rt, mx).add(new THREE.Vector3(0, up, 0)).multiplyScalar(sp), Math.min(1, dt * 4));
    camera.position.addScaledVector(fp.vel, dt);
    camera.position.y = clamp(camera.position.y, 3, 3000);
    camera.position.x = clamp(camera.position.x, BX0 - 3000, BX1 + 3000);
    camera.position.z = clamp(camera.position.z, BZ0 - 3000, BZ1 + 3000);
  }
}
const _cam = new THREE.Vector3(), _look = new THREE.Vector3();
function updateFollow(dt) {
  const c = fp.follow; if (!c || c.px === undefined) return;
  const back = c.bus ? 22 : 14, up = c.bus ? 7 : 4.5;
  _cam.set(c.px - Math.sin(c.yaw) * back, c.py + up, c.pz - Math.cos(c.yaw) * back);
  if (fp.snap) { camera.position.copy(_cam); fp.snap = false; } else camera.position.lerp(_cam, Math.min(1, dt * 3));
  _look.set(c.px + Math.sin(c.yaw) * 10, c.py + 1.5, c.pz + Math.cos(c.yaw) * 10);
  camera.lookAt(_look);
}

// ---------- UI ----------
function fmtTime(h) { h = ((h % 24) + 24) % 24; const hh = Math.floor(h), mm = Math.floor((h - hh) * 60); return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; }
function syncUI() {
  $('time-val').textContent = fmtTime(state.hours);
  $('time').value = String(Math.round(state.hours * 60));
  const d = new Date(Date.now() + 8 * 3600e3);
  const el = elevNow;
  const phase = el > 6 ? '白天' : el > -0.8 ? (state.hours < 12 ? '日出' : '日落') : el > -7 ? (state.hours < 12 ? '黎明' : '黄昏') : '夜晚';
  $('readout').textContent = `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 · ${fmtTime(state.hours)} · ${WNAME[state.weather]} · ${phase}`;
  $('sun-el').textContent = `太阳高度 ${el.toFixed(1)}°`;
}
function bindUI() {
  $('time').addEventListener('input', (e) => { state.hours = Number(e.target.value) / 60; syncUI(); });
  $('play').addEventListener('click', () => { state.playing = !state.playing; $('play').setAttribute('aria-pressed', String(state.playing)); $('play').textContent = state.playing ? '暂停' : '播放'; });
  $('play').textContent = state.playing ? '暂停' : '播放'; $('play').setAttribute('aria-pressed', String(state.playing));
  $('rate').addEventListener('change', (e) => { state.rate = Number(e.target.value); });
  $('now').addEventListener('click', () => { const d = new Date(Date.now() + 8 * 3600e3); state.hours = d.getUTCHours() + d.getUTCMinutes() / 60; state.rate = 1; $('rate').value = '1'; syncUI(); });
  document.querySelectorAll('[data-weather]').forEach((b) => b.addEventListener('click', () => {
    state.weather = b.dataset.weather;
    document.querySelectorAll('[data-weather]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    syncUI();
  }));
  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  document.querySelectorAll('[data-place]').forEach((b) => b.addEventListener('click', () => flyTo(b.dataset.place)));
  $('labels-t').addEventListener('click', (e) => { state.labels = !state.labels; e.currentTarget.setAttribute('aria-pressed', String(state.labels)); });
  $('quality-t').addEventListener('click', (e) => { setQuality(quality === 'high' ? 'low' : 'high'); });
  $('collapse').addEventListener('click', () => { const p = $('panel'); const c = p.classList.toggle('collapsed'); $('collapse').textContent = c ? '展开' : '收起'; $('collapse').setAttribute('aria-expanded', String(!c)); });
}
function setQuality(q) {
  quality = q;
  const hi = q === 'high';
  $('quality-t').textContent = hi ? '画质 高' : '画质 低';
  $('quality-t').setAttribute('aria-pressed', String(hi));
  renderer.setPixelRatio(Math.min(devicePixelRatio, hi ? 1.75 : 1));
  sun.shadow.mapSize.set(hi ? 4096 : 2048, hi ? 4096 : 2048);
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  water.visible = hi; waterSimple.visible = !hi;
  onResize();
}
function onResize() {
  const w = innerWidth, h = innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h); composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h);
}
addEventListener('resize', onResize);

// ---------- boot ----------
const steps = [
  ['生成材质', buildTextures], ['准备材质', buildMaterials], ['铺设地面与水面', buildGround], ['种植绿地', buildGreens],
  ['砌筑河岸', buildBanks], ['拉起建筑', buildBuildings], ['铺设道路与桥梁', buildRoads], ['种树', buildTrees],
  ['安装路灯', buildLamps], ['建造电视塔', buildTower], ['放出车流', buildTraffic], ['准备天气', buildWeatherFX],
  ['计算步行范围', buildWalkMask], ['标注地标', buildLabels],
];
async function boot() {
  for (let i = 0; i < steps.length; i++) {
    $('load-step').textContent = steps[i][0];
    $('load-bar').style.width = `${Math.round((i / steps.length) * 100)}%`;
    await tick();
    steps[i][1]();
  }
  $('load-bar').style.width = '100%';
  bindUI();
  if (innerHeight < 620) { $('panel').classList.add('collapsed'); $('collapse').textContent = '展开'; $('collapse').setAttribute('aria-expanded', 'false'); }
  const p = PLACES.tower;
  camera.position.set(...p.pos); controls.target.set(...p.target); controls.update();
  if (quality === 'low') setQuality('low'); else setQuality('high');
  syncUI();
  let last = performance.now(), t = 0, uiT = 0;
  const loop = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now; t += dt;
    if (state.playing) { state.hours = (state.hours + dt * state.rate / 3600) % 24; }
    updateFlight(dt);
    if (state.mode === 'orbit') {
      controls.update();
      controls.target.x = clamp(controls.target.x, BX0 - 800, BX1 + 800); controls.target.z = clamp(controls.target.z, BZ0 - 800, BZ1 + 800);
    } else if (state.mode === 'follow') updateFollow(dt);
    else updateFirstPerson(dt);
    updateTraffic(dt);
    updateEnvironment(dt, t);
    updateLabels();
    composer.render(dt);
    uiT += dt; if (uiT > 0.25) { uiT = 0; syncUI(); }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  $('loading').classList.add('done');
  setTimeout(() => { $('loading').hidden = true; }, 900);
  window.__city = { scene, camera, state, setMode, flyTo, world, traffic, water, waterSimple, setQuality, renderer };
}
boot().catch((err) => {
  console.error(err);
  $('load-step').textContent = '加载失败：' + (err && err.message ? err.message : err) + '。请刷新页面重试。';
});
