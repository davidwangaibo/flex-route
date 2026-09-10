# Flex 扫码 → 路线 → Tesla 导航 方案设计

## 1. 目标
在 Amazon Flex 取货时扫描包裹面单，自动整理出当天所有站点，生成 Google Maps 可用的路线/文件，并逐站推送到 Tesla 车机导航，配合 FSD（Supervised）行驶。

## 2. 先说清楚的三个限制
| 限制 | 说明 | 方案里的应对 |
|---|---|---|
| TBA 条码不含地址 | Flex 面单上的一维码/QR 只有 `TBA…` 运单号。地址是印刷文字。 | 扫码取运单号做去重和计数；同一张照片用 OCR 识别地址块，人工确认后入库。 |
| Tesla 不能导入多站路线 | Tesla App「分享到车辆」只接受一个目的地；车机的多途经点只能在屏幕上手动添加。 | 程序按优化后的顺序，每次一键把"下一站"分享到 Tesla App。 |
| FSD 仍需驾驶员监督 | FSD 只负责开到目的地，不负责停车找门、放包裹，且全程需要驾驶员注意力。 | 程序只解决"导航输入"这一环，不改变驾驶责任。 |

另外：Amazon Flex 服务条款对第三方工具的态度不明确，请自行评估。程序只读取你自己扫描的面单，不接触 Flex 账号。

## 3. 整体流程（两遍扫码）
```
第一遍 录入 ──▶ 站点列表 ──▶ 优化顺序 ──▶ 第二遍 分拣 ──▶ 送达 / 导出
 扫码 + OCR       去重、编辑     地理编码 +      再扫一次条码     逐站「分享到 Tesla」
 逐件录地址       本地保存       就近排序        大字显示"第 N 站"  Google Maps 链接 / CSV / KML
```
为什么要两遍：第几站取决于整条路线的顺序，而顺序要等 40 个地址全部录完才能算。第一遍录完点「优化顺序」，第二遍装车时每件再扫 1 秒，屏幕弹出站号，号码小的放上面/靠外。

## 4. 模块设计
### 4.1 扫描模块
- 摄像头实时识别 Code128 / QR / DataMatrix，正则 `TBA\d{12,}` 提取运单号。
- 同一站点多包裹：运单号不同但地址相同时合并为一站，包裹数 +1。
- 面单拍照 → Tesseract.js OCR → 从文字中找"门牌号 + 街道 … 州 邮编"的地址块，预填到地址栏，用户看一眼确认。

### 4.2 站点数据（本地存储，浏览器 localStorage）
```json
{ "id": "...", "tba": ["TBA3012…"], "address": "123 Main St, Bellevue, WA 98004",
  "note": "门口放置", "status": "pending|done", "order": 3 }
```

### 4.3 分拣模式
- 独立的扫码页。扫到已录入的运单号：绿色大字显示站号、地址、该站件数、已分拣件数，并震动。
- 未录入的运单号：红色"未录入"，长震动提醒。
- 顶部进度条显示"已分拣 x / 总件数"。
- 若顺序尚未优化，站号以黄色显示并提示先优化。

### 4.4 顺序优化（不限站数）
- 先把每个地址地理编码成经纬度：有 Google API Key 走 Geocoding API；没有则走 OpenStreetMap Nominatim（免费，每站约 1 秒，40 站约 40 秒）。经纬度缓存在站点上，只算一次。
- 然后本地算法排序：从手机 GPS 位置出发，最近邻贪心 + 2-opt 改进。40 站在手机上几十毫秒完成，无 25 站上限。
- 加了新站点或改了地址会自动标记"未优化"。

### 4.5 导出
- **Google Maps 导航链接**：`https://www.google.com/maps/dir/?api=1&origin=…&destination=…&waypoints=A|B|C`，每条链接最多 9 个途经点 + 1 个终点，超过自动拆成多条。
- **CSV**（`name,address,note`）和 **KML**：可导入 Google My Maps 做全局查看。
- **逐站推送 Tesla**：Web Share API 分享一条 Google Maps 地点链接，在手机分享面板里选 Tesla App → 车机自动开始导航。iOS/Android 都支持。

### 4.6 送达模式
- 大字显示当前站点、包裹数、备注。
- 按钮：「发送到 Tesla」「已送达 → 下一站」「跳过」。
- 送达后自动切到下一站，再次一键推送。

## 5. 技术选型
| 项 | 选择 | 理由 |
|---|---|---|
| 形态 | 单文件 PWA（HTML + JS） | 手机浏览器直接开，无需上架应用商店。 |
| 扫码 | html5-qrcode | 支持一维/二维码，纯前端。 |
| OCR | Tesseract.js | 纯前端，离线可用；也可换成 Google Vision 提高准确率。 |
| 地理编码 | Google Geocoding 或 OpenStreetMap Nominatim | 后者免费无需 Key。 |
| 路线优化 | 本地最近邻 + 2-opt | 不限站数，离线可算。 |
| 推送到车 | Web Share API → Tesla App | 官方支持的唯一"发到车"通道。 |

## 6. 手机上运行
摄像头和"分享到 Tesla"都要求页面通过 **HTTPS** 打开，所以不能直接在手机上点开 html 文件。最省事的是 GitHub Pages（免费）：
1. 打开 github.com 登录，点右上角 + → New repository，名字随意（如 `flex-route`），Public，Create。
2. 进入仓库 → Add file → Upload files，把 `flex-route.html` 拖进去，改名为 `index.html`，Commit。
3. 仓库 Settings → Pages → Branch 选 `main`，Save。一两分钟后页面顶部出现网址，形如 `https://你的用户名.github.io/flex-route/`。
4. 手机浏览器打开这个网址：iPhone 用 Safari，Android 用 Chrome。首次会请求摄像头权限，允许。
5. 「添加到主屏幕」（iPhone：分享按钮 → 添加到主屏幕；Android：菜单 → 添加到主屏幕），以后像 App 一样打开。
6. 「发送到 Tesla」会弹出系统分享面板，选 Tesla App，车机随即开始导航（需要手机已登录 Tesla App 并绑定车辆）。

数据保存在手机浏览器本地，换浏览器或清缓存会丢，当天送完即可清空。Google API Key 可选，需开启 Geocoding API，并在控制台限制为该网址。

## 7. 后续可做
- 接入 Google Vision 替代本地 OCR。
- 站点地图预览（Leaflet）。
- 批量导出当日记录，用于对账。
