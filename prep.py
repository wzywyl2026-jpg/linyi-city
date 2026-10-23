"""Turn compact OSM extracts into scene data for the 3D page.

data/osm.txt        original district (上海路 south to 三河口), z in [-1770, 1770]
data/osm_north.txt  northern extension (上海路 north to 南京路), z in [-4600, -1770];
                    (osm_we.txt: west 祊河 side x<-1500 and east 沂河 side x>1500)
                    its roads are already cut exactly at the z = -1770 seam.

Coordinates: x = metres east of origin, z = metres south of origin
(origin 35.0905N 118.359E). Output: data.json
"""
import json, math, random, re
import numpy as np

random.seed(7)
# mapped regions: centre (original + north), west (祊河 side) and east (沂河 side)
REG_C = (-1500, -4600, 1500, 1770)
REG_W = (-6200, -5000, -1500, 1770)
REG_E = (1500, -4600, 3700, 1770)
REGIONS = [REG_C, REG_W, REG_E]
X0, Z0 = min(r[0] for r in REGIONS), min(r[1] for r in REGIONS)
X1, Z1 = max(r[2] for r in REGIONS), max(r[3] for r in REGIONS)
SEAM = -1770  # boundary between the two centre extracts
CUT_X = sorted({r[0] for r in REGIONS} | {r[2] for r in REGIONS})
CUT_Z = sorted({r[1] for r in REGIONS} | {r[3] for r in REGIONS})


def in_regions(x, z, pad=0):
    return any(r[0] + pad < x < r[2] - pad and r[1] + pad < z < r[3] - pad for r in REGIONS)


def dec(s):
    pts = []
    x = z = 0.0
    for i, q in enumerate(s.split(' ')):
        a, b = map(float, q.split(','))
        if i == 0:
            x, z = a, b
        else:
            x += a; z += b
        pts.append((x, z))
    return pts


def cut_south(p):
    """Keep the part of a polyline with z >= SEAM, splitting exactly at the seam."""
    runs, cur = [], []
    for i, (x, z) in enumerate(p):
        inside = z >= SEAM
        if i:
            px, pz = p[i - 1]
            if (pz >= SEAM) != inside:
                t = (SEAM - pz) / (z - pz)
                m = (round((px + t * (x - px)) * 2) / 2, SEAM)
                cur.append(m)
                if not inside:
                    if len(cur) > 1: runs.append(cur)
                    cur = []
                else:
                    cur = [m]
        if inside:
            cur.append((x, z))
    if len(cur) > 1: runs.append(cur)
    return runs


def clip_rect(p, R):
    """Clip a polyline to rectangle R=(x0,z0,x1,z1); returns list of runs."""
    x0, z0, x1, z1 = R
    runs, cur = [], []
    for i in range(1, len(p)):
        (ax, az), (bx, bz) = p[i - 1], p[i]
        dx, dz = bx - ax, bz - az
        t0, t1 = 0.0, 1.0
        ok = True
        for pp, qq in ((-dx, ax - x0), (dx, x1 - ax), (-dz, az - z0), (dz, z1 - az)):
            if pp == 0:
                if qq < 0: ok = False; break
            else:
                t = qq / pp
                if pp < 0: t0 = max(t0, t)
                else: t1 = min(t1, t)
        if not ok or t0 > t1:
            if len(cur) > 1: runs.append(cur)
            cur = []
            continue
        A = (round(ax + t0 * dx, 1), round(az + t0 * dz, 1)) if t0 > 0 else (ax, az)
        B = (round(ax + t1 * dx, 1), round(az + t1 * dz, 1)) if t1 < 1 else (bx, bz)
        if not cur:
            cur = [A]
        elif cur[-1] != A:
            if len(cur) > 1: runs.append(cur)
            cur = [A]
        cur.append(B)
        if t1 < 1:
            if len(cur) > 1: runs.append(cur)
            cur = []
    if len(cur) > 1: runs.append(cur)
    return [r for r in runs if sum(math.dist(r[k - 1], r[k]) for k in range(1, len(r))) > 1]


water, green, builds, roads, rivers, nodes = [], [], [], [], [], []
lines = ([(l, 'S') for l in open('data/osm.txt', encoding='utf8')] +
         [(l, 'N') for l in open('data/osm_north.txt', encoding='utf8')] +
         [(l, 'WE') for l in open('data/osm_we.txt', encoding='utf8')])
for line, src in lines:
    f = line.rstrip('\n').split('|')
    k = f[0]
    if k == 'W':
        outer = dec(f[2])
        holes = [dec(r) for r in f[3].split('#')] if len(f) > 3 and f[3] else []
        water.append((outer, holes))
    elif k == 'G':
        green.append((f[1], dec(f[2])))
    elif k == 'B':
        builds.append(dict(h=f[1], lv=f[2], t=f[3], n=f[4], p=dec(f[5])))
    elif k == 'R':
        p = dec(f[7])
        if f[3] == '1' and src != 'WE':
            runs = cut_south(p) if src == 'S' else [p]  # bridges stay whole across the x seams
        else:
            R = REG_C if src != 'WE' else (REG_W if p[0][0] < 0 else REG_E)
            runs = [q for r0 in (cut_south(p) if src == 'S' else [p]) for q in clip_rect(r0, R)]
        for run in runs:
            roads.append(dict(c=f[1], lanes=f[2], br=f[3] == '1', layer=f[4], ow=f[5] == '1', n=f[6], p=run))
    elif k == 'V':
        rivers.append((f[1], f[2], dec(f[3])))
    elif k == 'N':
        x, z = map(float, f[-1].split(','))
        nodes.append((f[1], f[2], f[3], x, z))


# ---------- geometry helpers ----------
def area(p):
    a = 0
    for i in range(len(p)):
        x1, z1 = p[i]; x2, z2 = p[(i + 1) % len(p)]
        a += x1 * z2 - x2 * z1
    return a / 2


def pip(x, z, p):
    c = False
    n = len(p)
    j = n - 1
    for i in range(n):
        xi, zi = p[i]; xj, zj = p[j]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi + 1e-12) + xi:
            c = not c
        j = i
    return c


def bbox(p):
    xs = [a for a, b in p]; zs = [b for a, b in p]
    return min(xs), min(zs), max(xs), max(zs)


class Grid:
    """Bucket items by bbox for fast point queries."""
    def __init__(self, cell=60):
        self.cell = cell; self.d = {}

    def add(self, bb, item):
        c = self.cell
        for i in range(int(math.floor(bb[0] / c)), int(math.floor(bb[2] / c)) + 1):
            for j in range(int(math.floor(bb[1] / c)), int(math.floor(bb[3] / c)) + 1):
                self.d.setdefault((i, j), []).append(item)

    def get(self, x, z):
        return self.d.get((int(math.floor(x / self.cell)), int(math.floor(z / self.cell))), [])


water_bb = [(bbox(o), o, h) for o, h in water]


def in_water(x, z):
    for bb, o, hs in water_bb:
        if bb[0] <= x <= bb[2] and bb[1] <= z <= bb[3] and pip(x, z, o):
            if not any(pip(x, z, h) for h in hs):
                return True
    return False


# ---------- road widths ----------
def road_width(r):
    c, ow = r['c'], r['ow']
    lanes = int(r['lanes']) if r['lanes'].isdigit() else 0
    if c in ('trunk', 'primary', 'secondary'):
        if lanes:
            return lanes * 3.5
        return {'trunk': 14, 'primary': 14, 'secondary': 12}[c] if not ow else (10.5 if c != 'secondary' else 9)
    if c.endswith('_link'):
        return lanes * 3.5 if lanes else (5 if ow else 7)
    if c == 'tertiary':
        return 7 if ow else 10
    return {'residential': 7, 'unclassified': 7, 'living_street': 5, 'service': 4, 'pedestrian': 5}.get(c, 5)


for r in roads:
    r['w'] = road_width(r)
    L = 0
    for i in range(1, len(r['p'])):
        L += math.dist(r['p'][i - 1], r['p'][i])
    r['len'] = L

surface_roads = [r for r in roads if r['layer'] != '-1']

# segment grid for distance-to-road queries
seg_grid = Grid(40)
for ri, r in enumerate(surface_roads):
    p = r['p']
    for i in range(1, len(p)):
        (ax, az), (bx, bz) = p[i - 1], p[i]
        m = r['w'] / 2 + 3
        seg_grid.add((min(ax, bx) - m, min(az, bz) - m, max(ax, bx) + m, max(az, bz) + m), (ax, az, bx, bz, r['w'], ri))


def seg_dist(x, z, ax, az, bx, bz):
    dx, dz = bx - ax, bz - az
    L2 = dx * dx + dz * dz
    t = 0 if L2 == 0 else max(0, min(1, ((x - ax) * dx + (z - az) * dz) / L2))
    return math.hypot(x - (ax + t * dx), z - (az + t * dz))


def near_road(x, z, pad=1.5, skip=None):
    for ax, az, bx, bz, w, ri in seg_grid.get(x, z):
        if ri == skip:
            continue
        if seg_dist(x, z, ax, az, bx, bz) < w / 2 + pad:
            return True
    return False


# ---------- buildings ----------
for b in builds:
    p = b['p']
    if area(p) < 0:  # make CCW in x/z (z south) -> consistent winding
        p.reverse()
    b['area'] = abs(area(p))
    b['cx'] = sum(a for a, _ in p) / len(p)
    b['cz'] = sum(c for _, c in p) / len(p)

b_grid = Grid(60)
for i, b in enumerate(builds):
    bb = bbox(b['p'])
    b_grid.add((bb[0] - 3, bb[1] - 3, bb[2] + 3, bb[3] + 3), i)


def in_building(x, z, pad=0):
    for i in b_grid.get(x, z):
        b = builds[i]
        if pip(x, z, b['p']):
            return True
        if pad:
            p = b['p']
            for k in range(len(p)):
                if seg_dist(x, z, *p[k], *p[(k + 1) % len(p)]) < pad:
                    return True
    return False


NAMED = {
    '临沂大剧院': None,  # handled below (two shells)
    '临沂市文化中心': 24, '临沂市博物馆': 21, '临沂市科技馆': 26, '会议中心': 18,
    '临沂市政务服务中心': 14, '临沂鲁商铂尔曼大酒店': 16,
}

tagged = [b for b in builds if b['lv'] not in ('', '0') or b['h']]


def kind(b):
    t, n = b['t'], b['n']
    if any(s in n for s in ('剧院', '文化中心', '博物馆', '科技馆', '会议中心', '政务服务')):
        return 'pub'
    if t in ('school', 'kindergarten', 'retail') or '教学楼' in n or '操场' in n or '服务楼' in n or '综合楼' in n or '办公楼' in n:
        return 'pub'
    if t in ('commercial', 'office') or any(s in n for s in ('大厦', '局', '座', '烟草', '酒店', '中心')):
        return 'off'
    return 'res'


for b in builds:
    b['k'] = kind(b)
    n = b['n']
    lv = int(b['lv']) if b['lv'].isdigit() else 0
    hm = re.match(r'\s*([0-9.]+)', b['h'])
    if hm:
        H = float(hm.group(1))
    elif n in NAMED and NAMED[n]:
        H = NAMED[n]
    elif lv > 0:
        H = lv * (3.6 if b['k'] == 'off' else 3.0) + 1.5
    else:
        # borrow from nearest tagged building of similar footprint (same compound)
        best, bd = None, 1e9
        for t in tagged:
            if t['n'] in NAMED:
                continue
            d = math.hypot(t['cx'] - b['cx'], t['cz'] - b['cz'])
            if d < bd and 0.4 < t['area'] / max(b['area'], 1) < 2.5:
                bd, best = d, t
        rnd = random.Random(hash((round(b['cx']), round(b['cz']))) & 0xffff)
        if best and bd < 160:
            lv2 = int(best['lv']) if best['lv'].isdigit() else 6
            lv2 = max(2, lv2 + rnd.randint(-2, 2))
            H = lv2 * 3.0 + 1.5
        elif b['k'] == 'off':
            H = rnd.randint(16, 26) * 3.6
        elif b['k'] == 'pub':
            H = rnd.randint(3, 5) * 4.0
        elif b['t'] == 'apartments':
            H = rnd.choice([11, 18, 18, 24, 26, 30, 32]) * 3.0 + 1.5
        elif b['area'] < 150:
            H = rnd.randint(1, 2) * 3.5
        elif b['area'] < 900:
            H = rnd.choice([6, 6, 11, 17, 18, 26]) * 3.0 + 1.5
        else:
            H = rnd.randint(3, 6) * 4.0
    b['H'] = round(H, 1)

# theatre: two shell roofs
th = [b for b in builds if b['n'] == '临沂大剧院']
th.sort(key=lambda b: -b['area'])
for i, b in enumerate(th):
    b['H'] = 30 if i == 0 else 24
    b['shell'] = 1
# small curved structures at the tower foot belong to the tower base
for b in builds:
    if b['t'] == 'office' and math.hypot(b['cx'] - 321.5, b['cz'] - 1026.5) < 80:
        b['H'] = 9; b['k'] = 'pub'

# ---------- water banks ----------
def on_edge(ax, az, bx, bz):
    """Edges lying on a region boundary are extract cut lines, not real banks."""
    e = 2
    return (any(abs(ax - c) < e and abs(bx - c) < e for c in CUT_X) or
            any(abs(az - c) < e and abs(bz - c) < e for c in CUT_Z))


def in_other_water(x, z, skip):
    for i, (bb, o, hs) in enumerate(water_bb):
        if i == skip:
            continue
        if bb[0] <= x <= bb[2] and bb[1] <= z <= bb[3] and pip(x, z, o) and not any(pip(x, z, h) for h in hs):
            return True
    return False


banks = []  # list of chains: [x,z,...] with land side to the left/right flag
for wi, (o, hs) in enumerate(water):
    for ring in [o] + hs:
        chain = []
        n = len(ring)
        for i in range(n):
            a, b2 = ring[i], ring[(i + 1) % n]
            if math.dist(a, b2) < 0.1:
                continue
            mx, mz = (a[0] + b2[0]) / 2, (a[1] + b2[1]) / 2
            L = math.dist(a, b2)
            nx, nz = -(b2[1] - a[1]) / L, (b2[0] - a[0]) / L
            w1 = in_water(mx + nx * 1.5, mz + nz * 1.5)
            w2 = in_water(mx - nx * 1.5, mz - nz * 1.5)
            keep = not on_edge(*a, *b2) and (w1 != w2)
            if keep:
                if not chain:
                    chain = [a]
                chain.append(b2)
            else:
                if len(chain) > 1:
                    banks.append(chain)
                chain = []
        if len(chain) > 1:
            banks.append(chain)

# land side per chain: test a point 2m to the left of the first long segment
bank_out = []
for ch in banks:
    side = 1
    for i in range(1, len(ch)):
        (ax, az), (bx, bz) = ch[i - 1], ch[i]
        L = math.dist(ch[i - 1], ch[i])
        if L > 3:
            mx, mz = (ax + bx) / 2, (az + bz) / 2
            nx, nz = -(bz - az) / L, (bx - ax) / L  # left normal (x/z plane)
            left_w = in_water(mx + nx * 2, mz + nz * 2)
            right_w = in_water(mx - nx * 2, mz - nz * 2)
            if left_w and not right_w:
                side = -1
            elif right_w and not left_w:
                side = 1
            else:
                continue
            break
    bank_out.append((side, ch))

# ---------- bridges: deck profile ----------
def deck(L, s):
    H = max(2.5, min(9.0, L * 0.06))
    R = min(L * 0.3, 120)
    def sm(t):
        t = max(0, min(1, t)); return t * t * (3 - 2 * t)
    return H * sm(s / R) * sm((L - s) / R)


# ---------- lamps ----------
lamps = []  # x, y, z, yaw, type(0 road,1 promenade)
MAJOR = ('trunk', 'primary', 'secondary', 'tertiary')
for ri, r in enumerate(surface_roads):
    if r['c'] not in MAJOR or r['len'] < 30:
        continue
    p = r['p']
    sides = [-1] if r['ow'] else [-1, 1]  # right side in x/z with z south: see below
    spacing = 34
    acc = 0; nxt = spacing / 2
    for i in range(1, len(p)):
        (ax, az), (bx, bz) = p[i - 1], p[i]
        L = math.dist(p[i - 1], p[i])
        if L < 0.01:
            continue
        tx, tz = (bx - ax) / L, (bz - az) / L
        # right-hand normal when looking along travel: in x-east/z-south frame right = (-tz, tx)
        rx, rz = -tz, tx
        while nxt < acc + L:
            s = nxt - acc
            x, z = ax + tx * s, az + tz * s
            for sd in sides:
                k = 1 if sd == -1 else -1  # -1 -> right side
                off = r['w'] / 2 + 1.2
                lx, lz = x + rx * off * k, z + rz * off * k
                y = deck(r['len'], nxt) if r['br'] else 0
                if not r['br'] and (in_water(lx, lz) or in_building(lx, lz, 1) or near_road(lx, lz, 0.3, skip=ri)):
                    continue
                yaw = math.atan2(-rx * k, -rz * k)
                lamps.append((round(lx, 1), round(y, 1), round(lz, 1), round(yaw, 2), 0))
            nxt += spacing
        acc += L

# promenade lamps along banks
for side, ch in bank_out:
    acc = 0; nxt = 10
    for i in range(1, len(ch)):
        (ax, az), (bx, bz) = ch[i - 1], ch[i]
        L = math.dist(ch[i - 1], ch[i])
        if L < 0.01:
            continue
        tx, tz = (bx - ax) / L, (bz - az) / L
        nx, nz = -tz * side, tx * side  # towards land
        while nxt < acc + L:
            s = nxt - acc
            x, z = ax + tx * s + nx * 3.0, az + tz * s + nz * 3.0
            if not in_water(x, z) and not in_building(x, z, 2) and not near_road(x, z, 0.5):
                lamps.append((round(x, 1), 0, round(z, 1), round(math.atan2(-nx, -nz), 2), 1))
            nxt += 26
        acc += L

# ---------- trees ----------
trees = []  # x, z, scale, type (0 broadleaf,1 conifer-ish,2 willow)


def ok_tree(x, z, pad=1.2):
    if not in_regions(x, z):
        return False
    if in_water(x, z) or in_building(x, z, 2.5) or near_road(x, z, pad):
        return False
    return True


dens = {'wood': 1 / 70, 'park': 1 / 260, 'grass': 1 / 600}
for kd, p in green:
    if kd not in dens:
        continue
    A = abs(area(p))
    n = int(A * dens[kd])
    n = min(n, 2500)
    bb = bbox(p)
    tries = 0
    got = 0
    while got < n and tries < n * 4:
        tries += 1
        x = random.uniform(bb[0], bb[2]); z = random.uniform(bb[1], bb[3])
        if not pip(x, z, p):
            continue
        if ok_tree(x, z):
            t = 1 if (kd == 'wood' and random.random() < 0.35) else 0
            trees.append((round(x, 1), round(z, 1), round(random.uniform(0.75, 1.3), 2), t))
            got += 1

# street trees
for ri, r in enumerate(surface_roads):
    if r['c'] not in MAJOR + ('residential', 'unclassified') or r['br'] or r['len'] < 20:
        continue
    p = r['p']
    sides = [1] if r['ow'] else [1, -1]
    spacing = 9 if r['c'] in MAJOR else 12
    acc = 0; nxt = spacing / 2
    for i in range(1, len(p)):
        (ax, az), (bx, bz) = p[i - 1], p[i]
        L = math.dist(p[i - 1], p[i])
        if L < 0.01:
            continue
        tx, tz = (bx - ax) / L, (bz - az) / L
        rx, rz = -tz, tx
        while nxt < acc + L:
            s = nxt - acc
            x, z = ax + tx * s, az + tz * s
            for sd in sides:
                off = r['w'] / 2 + 2.6
                lx, lz = x + rx * off * sd, z + rz * off * sd
                if ok_tree(lx, lz, 1.0):
                    trees.append((round(lx, 1), round(lz, 1), round(random.uniform(0.8, 1.05), 2), 0))
            nxt += spacing
        acc += L

# shore trees (willows) along banks
for side, ch in bank_out:
    acc = 0; nxt = 4
    for i in range(1, len(ch)):
        (ax, az), (bx, bz) = ch[i - 1], ch[i]
        L = math.dist(ch[i - 1], ch[i])
        if L < 0.01:
            continue
        tx, tz = (bx - ax) / L, (bz - az) / L
        nx, nz = -tz * side, tx * side
        while nxt < acc + L:
            s = nxt - acc
            d = random.uniform(5.5, 9)
            x, z = ax + tx * s + nx * d, az + tz * s + nz * d
            if ok_tree(x, z, 1.5):
                trees.append((round(x, 1), round(z, 1), round(random.uniform(0.85, 1.25), 2), 2))
            nxt += random.uniform(9, 15)
        acc += L

# ---------- output ----------
def flat(p, r=1):
    out = []
    for x, z in p:
        out += [round(x, r), round(z, r)]
    return out


out = {
    'bbox': [X0, Z0, X1, Z1],
    'regions': [list(r) for r in REGIONS],
    'water': [[flat(o)] + [flat(h) for h in hs] for o, hs in water],
    'banks': [[s] + flat(ch) for s, ch in bank_out],
    'green': [[k, flat(p)] for k, p in green if k != 'pitch'] + [['pitch', flat(p)] for k, p in green if k == 'pitch'],
    'b': [[flat(b['p']), b['H'], {'res': 0, 'off': 1, 'pub': 2}[b['k']], b.get('shell', 0), b['n']] for b in builds],
    'r': [[r['c'], r['w'], 1 if r['br'] else 0, 1 if r['ow'] else 0, r['n'], flat(r['p'])] for r in surface_roads],
    'lamps': [v for l in lamps for v in l],
    'trees': [v for t in trees for v in t],
    'tower': [321.5, 1026.5, 326],
    'signals': [[x, z] for k, n, h, x, z in nodes if k == 'traffic_signals'],
}
s = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
open('data/data.json', 'w', encoding='utf8').write(s)
print('bytes', len(s.encode('utf8')), 'buildings', len(builds), 'roads', len(surface_roads),
      'banks', len(bank_out), 'lamps', len(lamps), 'trees', len(trees))
hs = sorted(b['H'] for b in builds)
print('height pct', hs[len(hs) // 10], hs[len(hs) // 2], hs[9 * len(hs) // 10], hs[-1])
