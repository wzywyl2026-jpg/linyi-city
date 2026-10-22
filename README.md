# 临沂·北城 三维城市

临沂市兰山区北城新区（五洲湖—电视塔—沂河、祊河、柳青河三河口一带，约 3 × 3.5 km）的可交互三维模型，在浏览器里运行。

- 建筑轮廓、道路、水系来自 OpenStreetMap（真实位置）；缺少高度的建筑按同小区相近建筑的层数推算。
- 精建地标：临沂广播电视塔（326 m，球形塔楼、算盘珠、Y 形桁架、螺旋桁架、竹简塔座）、五洲湖及岛屿、沂河/祊河/柳青河石砌河岸与滨水步道。
- 昼夜（按临沂经纬度和当天日期计算太阳位置）、晴/多云/雨/雾/雪、约 520 辆车的车流、俯瞰/步行/飞行/跟车视角。

## 直接打开

`index.html` 是完整的单文件页面，用浏览器打开即可（需要联网加载 three.js 和字体）。
开启 GitHub Pages（Settings → Pages → Branch: `main` / root）后，可以在任何设备上用固定网址访问。

## 目录

| 路径 | 作用 |
| --- | --- |
| `src/app.js` | 三维场景全部代码（Three.js r160）：材质、建筑、道路、水面、电视塔、车流、天气、视角控制 |
| `src/shell.html` | 页面外壳与控制面板（HTML/CSS），构建时把数据和代码填进去 |
| `data/osm.txt` | 从 OpenStreetMap 导出的紧凑地图数据（建筑 B、道路 R、水面 W、绿地 G、河道 V、节点 N） |
| `prep.py` | 把 `osm.txt` 处理成 `data/data.json`：推算楼高、生成河岸、布置行道树和路灯 |
| `data/data.json` | 处理后的场景数据 |
| `build.py` | 生成 `dist/linyi-city.html`（发布用）、`index.html`（GitHub Pages 用）、`test/index.html`（本地测试用） |

## 修改流程

```bash
python3 prep.py     # 只有改了 osm.txt 或 prep.py 时需要（依赖 numpy）
python3 build.py    # 每次改了 src/ 之后运行
```

本地测试版 `test/index.html` 从 `/three/` 读取本地 three.js r160（未提交，见 `.gitignore`）；平时直接打开 `index.html` 即可。

## 坐标约定

原点 北纬 35.0905°、东经 118.359°；x 向东、z 向南、y 向上，单位米。电视塔位于 (321.5, 1026.5)。

## 数据来源

地图数据 © OpenStreetMap 贡献者，按 ODbL 授权：https://www.openstreetmap.org/copyright
