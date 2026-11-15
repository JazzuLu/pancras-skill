# 3D 萌系历史地球仪：前期背景与研究成果调研记录

> **文档定位**：本项目前期探索性调研成果与素材/数据源知识库，供后续架构设计与开发参考（不设固定硬性计划，保持技术方案灵活性）。

---

## 一、 项目背景与核心诉求

1. **项目定位**：
   - 参加**小程序比赛**的交互式 3D 可视化作品。
   - 侧重于**“时空观看、数据叙事与轻量交互”**（拖动时间轴观察历史演进），非重度游戏玩法。
2. **视觉与画风诉求**：
   - **3D 菱形/低多边形地球仪**（萌系 Low-Poly / Geodesic Faceted Globe）。
   - 拥有漂浮流动的 Low-Poly 云彩、微缩树木、卡通地标等治愈系元素。
3. **平台约束**：
   - 微信小程序环境（包体积限制、秒开率要求、内存与发热控制）。
   - 追求极致轻量、启动快、交互顺畅。

---

## 二、 核心研究一：3D 建模方案与素材管线

### 1. 菱形地球（Low-Poly Globe）几何体建模方案

| 方式 | 实现原理 | 优缺点与适用场景 |
| :--- | :--- | :--- |
| **程序化网格生成（推荐）** | 使用 Three.js 原生 `IcosahedronGeometry(radius, detail)` 配合 `flatShading: true` | **零资产体积**，代码内即时生成，可动态根据经纬度调整顶点，最适合小程序 |
| **测地线多面体（Geodesic Sphere）** | 基于正二十面体进行测地线剖分（Goldberg 多面体 / 菱形三十面体） | 视觉面片极其均匀，菱形/六边形质感更纯粹 |
| **DCC 建模导入（Blender）** | 在 Blender 中建好 Low-Poly 地球球体并导出为 `.glb` 格式 | 方便预烘焙微弱顶点色与环境遮蔽（AO），但增加几百 KB 模型加载体积 |

### 2. 开源免费 3D 萌系素材资源库（CC0 / 商用免费）

所有整理的资源库均支持 `.gltf` / `.glb` 格式导出，并遵循免版税或 CC0 协议：

1. **[Kenney.nl (Asset Jesus)](https://kenney.nl/assets)**
   - **特点**：极简 Low-Poly 标杆，模块化强，色彩鲜明。
   - **精选包**：*Nature Kit*（树木、石头）、*Hexagon/Diamond Kit*、*Clouds/Sky Assets*。
   - **协议**：CC0 (Public Domain，完全无限制)。
2. **[Quaternius](https://quaternius.com/assets.html)**
   - **特点**：模型结构完整，包含大量古风与现代微缩建筑（城堡、古城、帆船、风车）。
   - **精选包**：*Medieval Village Pack*、*Stylized Nature Pack*、*Lowpoly Watercraft*。
   - **协议**：CC0 (免费下载与商用)。
3. **[Kay Lousberg (itch.io)](https://kaylousberg.itch.io/)**
   - **特点**：极度治愈的卡通配色与微缩模型，极其契合比赛视觉亮点。
   - **精选包**：*KayKit - Medieval Hexagon / Characters / Props*。
   - **协议**：CC0。
4. **[Poly Pizza](https://poly.pizza/)**
   - **特点**：Google Poly 的开源继承平台，包含数以万计的 Low-Poly 独立模型。
   - **搜索关键词**：`cloud`, `tree`, `isometric`, `ancient castle`, `pyramid`, `temple`。

### 3. 萌系渲染与材质优化技术技巧

- **调色盘贴图（Color Palette Texture Optimization）**：
  - 将所有 3D 小物件（树、云、房子）的材质统一映射到一张 **64×64 像素的色块小图（Color Atlas）** 上。
  - **效果**：不仅风格高度统一，还能将整个场景的 Draw Call（渲染调用）合并到极低水平，彻底消除移动端卡顿。
- **浮空白云动态物理（Floating Clouds Loop）**：
  - 云朵置于环绕地球的同心圆轨道，沿 Y 轴平滑自转。
  - 顶点着色器加入简易波形：$Y_{offset} = \sin(time \times speed + offset) \times amplitude$ 产生柔和上下呼吸感。
- **卡通着色器（Toon / Flat Shading + Rim Light）**：
  - 开启平面着色，配合暖色调边缘光（Rim Light），模拟黏土/手办材质。

---

## 三、 核心研究二：准确的历史与地理数据源

### 1. 历史疆界与国家版图（Historical Boundaries GeoJSON）

| 数据源名称 | 覆盖时空范围 | 数据格式与接入方式 | 特点与适用度 |
| :--- | :--- | :--- | :--- |
| **OpenHistoricalMap (OHM)** | 全球，涵盖古典时代至现代 | 开放 API / Overpass API / GeoJSON 导出 | 开源、社区驱动、时间切片粒度细 |
| **CHGIS (中国历史地理信息系统)** | 中国历代（秦代至清民国） | Shapefile / 矢量转 GeoJSON | 复旦大学与哈佛大学联合项目，**中国历代疆域权威基准** |
| **CShapes 2.0** | 1886 年至现代全球国家边界变化 | 开放数据集 / GIS 文件 | 精准记录近代与现代国家独立、兼并与边界变迁 |
| **Natural Earth (Historical Add-on)** | 常见历史关键节点（1815, 1914, 1938 等） | GeoJSON / TopoJSON | 经过制图优化的标准几何体，适合直接投影 |
| **Euratlas-Periodis Basic** | 欧洲公元 1 年至 2000 年（每世纪切片） | 矢量地图 / 开放图层 | 欧洲历史版图的高精度参考 |

### 2. 历史重大事件时空数据库（Events & Timelines）

1. **Wikidata Historical Events (SPARQL Query)**：
   - 可通过 SPARQL 查询具有特定“时间（P585）+ 经纬度（P625）+ 事件类型”的历史条目，自动生成 JSON 格式的时空事件点（Point of Interest）。
2. **CBDB (中国历代人物传记与事件数据库)**：
   - 包含中国古代历史事件、战争、迁徙的时空坐标记录。
3. **精选历史时空节点建议（首批 Demo 精简集）**：
   - 公元前 221 年（秦统一六国 / 罗马共和国崛起）
   - 公元 750 年（盛唐丝绸之路 / 阿拔斯王朝）
   - 公元 1279 年（蒙古帝国欧亚版图）
   - 公元 1500 年（大航海时代开启与麦哲伦环球航行）
   - 公元 1800 年（工业革命与拿破仑时代）

### 3. 数据轻量化与小程序适配方案

- **TopoJSON 拓扑压缩**：
  - 将复杂的原始 GeoJSON 疆域边界使用 Mapshaper 工具压缩为 **TopoJSON**。
  - **效果**：体积通常可缩减 **80%~90%**（例如全球 1800 年边界从 8MB 压缩至 300KB），并消除相邻国家边界缝隙。
- **离屏 Canvas 动态贴图合成（Dynamic Offscreen Canvas Texture）**：
  - 小程序端加载 TopoJSON，根据用户选择的年份在后台 Canvas 绘制填色与金线描边。
  - 将该 Canvas 直接作为 3D 地球的实时纹理（`CanvasTexture`），无需消耗昂贵的网络瓦片请求。

---

## 四、 技术引擎与架构评估结论

```
┌─────────────────────────────────────────────────────────────┐
│                      小程序端轻量架构体系                    │
└─────────────────────────────────────────────────────────────┘
  【顶层 UI 层】  小程序原生 WXML/WXSS（时间轴滑块、历史卡片、解说音频）
        │ (数据双向绑定)
  【中台数据层】  精简版 TopoJSON 历史版图 + JSON 时空大事件元数据
        │ (动态投影/经纬度转换)
  【底层渲染层】  Three.js WebGL Canvas
                ├── 3D 测地线菱形多面体地球 (FlatShading)
                ├── 浮空 Low-Poly 云层系统 (CC0)
                ├── 3D 萌系微缩地标/树木/帆船 (CC0 色板优化)
                └── 平滑球面插值运镜 (Camera Slerp Controller)
```

1. **引擎决策**：完全排除 Unity / Unreal，采用 **原生 WebGL / Three.js（`threejs-miniprogram`）**。
2. **核心优势**：
   - 启动极快（<1 秒），总包控制在 3MB 以内。
   - 彻底摆脱对外部不稳定 GIS 瓦片服务器的依赖，全部使用离线轻量矢量拓扑与程序化材质。
   - 极高契合小程序设计比赛的“轻巧、流畅、美观、人文”评审导向。
