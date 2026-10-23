# 临沂·北城 三维城市

临沂市兰山区北城新区的可交互三维模型，在浏览器里运行。范围约 3 × 6.4 km：北起南京路，经武汉路、成都路、广州路、济南路、天津路、上海路、北京路，南到五洲湖、电视塔和沂河、祊河、柳青河三河口。

- 建筑轮廓、道路、水系来自 OpenStreetMap（真实位置）；缺少高度的建筑按同小区相近建筑的层数推算。
- 精建地标：临沂广播电视塔（326 m，球形塔楼、算盘珠、Y 形桁架、螺旋桁架、竹简塔座）、五洲湖及岛屿、沂河/祊河/柳青河石砌河岸与滨水步道。
- 昼夜（按临沂经纬度和当天日期计算太阳位置）、晴/多云/雨/雾/雪、约 900 辆车的车流、俯瞰/步行/飞行/跟车视角。

## 直接打开

`index.html` 是完整的单文件页面，用浏览器打开即可（需要联网加载 three.js 和字体）。
开启 GitHub Pages（Settings → Pages → Branch: `main` / root）后，可以在任何设备上用固定网址访问。

## 目录

| 路径 | 作用 |
| --- | --- |
| `src/app.js` | 三维场景全部代码（Three.js r160）：材质、建筑、道路、水面、电视塔、车流、天气、视角控制 |
| `src/shell.html` | 页面外壳与控制面板（HTML/CSS），构建时把数据和代码填进去 |
| `data/osm.txt` | 南片地图数据（上海路以南到三河口），从 OpenStreetMap 导出的紧凑格式（建筑 B、道路 R、水面 W、绿地 G、河道 V、节点 N） |
| `data/osm_north.txt` | 北片地图数据（上海路到南京路以北约 200 m），格式相同；道路在 z = -1770 处与南片精确衔接 |
| `prep.py` | 合并两片数据并处理成 `data/data.json`：推算楼高、生成河岸、布置行道树和路灯 |
| `data/data.json` | 处理后的场景数据 |
| `build.py` | 生成 `dist/linyi-city.html`（发布用）、`index.html`（GitHub Pages 用）、`test/index.html`（本地测试用） |

## 修改流程

```bash
python3 prep.py     # 只有改了 data/osm*.txt 或 prep.py 时需要（依赖 numpy）
python3 build.py    # 每次改了 src/ 之后运行
```

本地测试版 `test/index.html` 从 `/three/` 读取本地 three.js r160（未提交，见 `.gitignore`）；平时直接打开 `index.html` 即可。

## 坐标约定

原点 北纬 35.0905°、东经 118.359°；x 向东、z 向南、y 向上，单位米。模型范围 x ∈ [-1500, 1500]、z ∈ [-4600, 1770]。电视塔位于 (321.5, 1026.5)，南京路约在 z = -4200 ～ -4490。

## 继续向外扩展

新片区的做法与北片相同：用 OpenStreetMap API 取数据，只保留不与现有范围重叠的部分（建筑按顶点是否落在旧范围内判断，道路在边界处精确切开），存成新的 `data/osm_*.txt`，再在 `prep.py` 里加入读取并更新范围常量。

## 数据来源

地图数据 © OpenStreetMap 贡献者，按 ODbL 授权：https://www.openstreetmap.org/copyright
