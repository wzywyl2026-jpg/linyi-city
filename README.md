# 临沂·北城 三维城市

临沂市兰山区北城新区的可交互三维模型，在浏览器里运行。范围约 9.9 × 6.8 km：中片北起南京路，经武汉路、成都路、广州路、济南路、天津路、上海路、北京路，南到五洲湖、电视塔和沂河、祊河、柳青河三河口；西片沿祊河两岸一直到祊河与南京路交汇处，东片沿沂河东岸向北到南京路一线。

- 建筑轮廓、道路、水系来自 OpenStreetMap（真实位置）；缺少高度的建筑按同小区相近建筑的层数推算。
- OpenStreetMap 在本区域缺了大量建筑，另用 CMAB 数据集（基于 2022 年卫星影像提取的建筑轮廓与高度）补齐；CMAB 也漏掉的，再用 GlobalBuildingAtlas（全球建筑 LoD1 数据集）补上。合计在 OSM 之外补了约 1 万栋，只补 OSM 里没有的位置，并已对照卫星影像核对过位置。
- 精建地标：临沂广播电视塔（326 m，球形塔楼、算盘珠、Y 形桁架、螺旋桁架、竹简塔座）、五洲湖及岛屿、沂河/祊河/柳青河石砌河岸与滨水步道。
- 昼夜（按临沂经纬度和当天日期计算太阳位置）、晴/多云/雨/雾/雪、最多约 1400 辆车的车流、俯瞰/步行/飞行/跟车视角。

## 网站（发给别人看）

`docs/` 是可以直接部署的完整网站：`docs/index.html` 加上 `docs/lib/` 里自带的 three.js，不依赖任何第三方 CDN 或网络字体，国内网络也能打开。

用 GitHub Pages 发布：仓库 Settings → Pages → Source 选 “Deploy from a branch”，Branch 选 `main`、文件夹选 `/docs`，保存后约一分钟可以通过 `https://wzywyl2026-jpg.github.io/linyi-city/` 访问。免费账户的 Pages 只能用于公开仓库。
`docs/` 也可以整个上传到任何静态网站托管（Netlify、Vercel、Cloudflare Pages、阿里云 OSS 等）。

## 直接打开

`index.html` 是完整的单文件页面，用浏览器打开即可（需要联网加载 three.js 和字体）。
开启 GitHub Pages（Settings → Pages → Branch: `main` / root）后，可以在任何设备上用固定网址访问。

## 目录

| 路径 | 作用 |
| --- | --- |
| `src/app.js` | 三维场景全部代码（Three.js r160）：材质、建筑、道路、水面、电视塔、车流、天气、视角控制 |
| `src/shell.html` | 页面外壳与控制面板（HTML/CSS），构建时把数据和代码填进去 |
| `data/manual.txt` | 对照高德卫星影像（2024 年后）补绘的新建建筑，数据集里都没有；格式同 cmab.txt |
| `data/osm_gba.txt` | OSM 建筑的 GlobalBuildingAtlas 高度：未标高度的直接采用；已标层数的取两者较高（层数标签常只写了裙房） |
| `data/osm_h.txt` | OSM 未标高度建筑的 CMAB 高度（仅在高于原估计时采用，修正被当成两三层的高楼） |
| `data/removed.txt` | 影像上已拆除（裸土或草地、无阴影）的旧轮廓中心点，构建时剔除 |
| `data/extra.txt` | 第二批补充：CMAB 中第一次被过滤掉的建筑，以及 GlobalBuildingAtlas 里另有的建筑（功能代码 U），格式同 cmab.txt |
| `data/cmab.txt` | CMAB 补充建筑（只含 OSM 缺失的），每行一栋：`高度 功能 轮廓`，矩形写成 `中心x,中心z,长,宽,角度`，其余写成多边形顶点增量；功能 R 住宅、B 商业、O 办公、P 公共、I 工业、X 其他 |
| `data/osm.txt` | 南片地图数据（上海路以南到三河口），从 OpenStreetMap 导出的紧凑格式（建筑 B、道路 R、水面 W、绿地 G、河道 V、节点 N） |
| `data/osm_north.txt` | 北片地图数据（上海路到南京路以北约 200 m），格式相同；道路在 z = -1770 处与南片精确衔接 |
| `data/osm_we.txt` | 西片（x < -1500，祊河两岸）和东片（x > 1500，沂河东岸）地图数据；河道多边形已按片区边界裁好 |
| `prep.py` | 合并三份数据（中片道路裁到 x ∈ [-1500, 1500]，跨缝的桥保持完整）并处理成 `data/data.json`：推算楼高、生成河岸、布置行道树和路灯 |
| `data/data.json` | 处理后的场景数据 |
| `build.py` | 生成 `docs/`（独立网站）、`dist/linyi-city.html`（单文件版）、`index.html`（单文件版，从 CDN 加载 three.js）、`test/index.html`（本地测试用） |

## 修改流程

```bash
python3 prep.py     # 只有改了 data/osm*.txt 或 prep.py 时需要（依赖 numpy）
python3 build.py    # 每次改了 src/ 之后运行
```

本地测试版 `test/index.html` 从 `/three/` 读取本地 three.js r160（未提交，见 `.gitignore`）；平时直接打开 `index.html` 即可。

## 坐标约定

原点 北纬 35.0905°、东经 118.359°；x 向东、z 向南、y 向上，单位米。模型由三个矩形片区组成：中片 x ∈ [-1500, 1500]、z ∈ [-4600, 1770]；西片 x ∈ [-6200, -1500]、z ∈ [-5000, 1770]；东片 x ∈ [1500, 3700]、z ∈ [-4600, 1770]（见 `prep.py` 的 `REGIONS`）。电视塔位于 (321.5, 1026.5)，南京路约在 z = -4200 ～ -4490。

## 继续向外扩展

新片区的做法与北片相同：用 OpenStreetMap API 取数据，只保留不与现有范围重叠的部分（建筑按顶点是否落在旧范围内判断，道路在边界处精确切开），存成新的 `data/osm_*.txt`，再在 `prep.py` 里加入读取并在 `REGIONS` 里加上新片区。片区边界上的水面边缘会被当作裁切线而不生成河岸。

## 数据来源

地图数据 © OpenStreetMap 贡献者，按 ODbL 授权：https://www.openstreetmap.org/copyright

补充建筑来自 CMAB（China Multi-Attribute Building dataset，Zhang et al.），按 CC BY 4.0 授权：https://doi.org/10.6084/m9.figshare.27992417

另有部分建筑来自 GlobalBuildingAtlas（Zhu et al., 2025, TUM），https://doi.org/10.14459/2025mp1782307
