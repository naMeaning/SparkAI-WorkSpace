# SparkAPI 官网 Logo 统一（2026-10-25）

状态：源码/资产、最终生产UI/PE/EXE与安全原位安装已验证，源码与文档同步收口中。本地开发包，非正式Release。

## 任务合同

用户要求软件图标采用 [SparkAPI 官网](https://sparkapi.org) 的真实Logo。使用网站公开原始资源并记录来源与hash；仅做桌面需要的格式/尺寸转换，不AI重绘。应用名、App ID、GUID、EXE及安装目录、升级兼容、项目/设置/认证和业务不变。

验收覆盖原始资产、既有Renderer/native窗口及WPF品牌页面、Windows PE/快捷方式/卸载注册资源；最终本地Windows开发安装包、正常安全原位安装、文档与本轮源码普通push。无真实模型/图片/视频请求、依赖安装、生产变更、正式Release/tag或二进制上传。

## 现有消费链

| 位置 | 资源与owner |
| --- | --- |
| 原始资产与生成 | `assets/windows/naimage-icon-master.png`保留官网原字节；`naimage-icon-source.json`记录来源；既有`release:assets`唯一派生PNG/ICO/BMP，所有打包入口先assets再build |
| 应用内顶栏、登录、启动检查、帮助与favicon | `public/naimage.png`从master原字节复制；Vite复制到dist；原组件保持 |
| 原生主窗口与独立Agent任务栏 | `electron-main.cjs.createWindowIcon()`统一读取public/dist PNG，注入两个BrowserWindow |
| Windows主EXE、快捷方式与卸载列表 | `package.json.win.icon`→`build/naimage.ico`；原快捷方式与NSIS `DisplayIcon`指向主EXE |
| 品牌安装/卸载器PE与页面 | 两csproj `ApplicationIcon`→`assets/windows/naimage.ico`；WPF `BrandShell.LoadLogo()`嵌入public PNG |
| NSIS安装资源与开发启动器 | `release:assets`同步build ICO及两BMP；DevLauncher复用build ICO |

## 现场与证据

- 接受基线：main / `5f6d4d90163aecad83479b62506ccdaf32a30edb`，旧设计/规则/参考及artifacts dirty保留；P1/P2开发制品不覆盖。
- 官网原始图：[apple-touch-icon-transparent.png](https://sparkapi.org/website/assets/images/apple-touch-icon-transparent.png?v=20260720-12)，2026-10-25读取/实际目检，透明金色S与星芒；180×180、16,347 B，SHA-256 `b7f0c93297759bfc177d7ee4c0f01be2cc8b2d43cf4a693ed51bdba324e20cfe`。master与public均保留原始字节，不使用700×152全字标、不AI重绘；180px是实际官方分辨率。
- 官网favicon对照：[favicon-transparent.ico](https://sparkapi.org/website/assets/images/favicon-transparent.ico?v=20260720-12)，9,919 B，SHA-256 `de44f21bb104d4b1d4167cb454cc4f560557c8bffba7d8ca75cea16d2069a594`，16/32/48/64。桌面ICO从同一官方PNG生成16/24/32/48/64/128/256，透明alpha保留，256仅为Windows格式适配放大，不称高清重建。
- 实现：唯一release:assets派生PNG/ICO/BMP，Main删除旧内嵌logo fallback。由于生成现在会同步public PNG，package:dir/package:win原build→assets顺序会在未来改master时使dist滞后，已与默认变体统一为assets→build；应用身份和升级合同保持。
- 资源专项：`.diagnostics/sparkapi-logo-2026-10-25/assets-audit.json`通过官方字节、180px原始尺寸、ICO七帧目录/尺寸、透明alpha0–255、assets/build同字节；Node语法与只读独立复核通过。
- 最终冻结/构建：758输入 `cd08ef832643808c4c63c7cf7d545439d44aa8a86b75c620eb0033b7be638535`，含assets/windows、build ICO/BMP/NSIS include/更新脚本、安装/卸载器及DevLauncher源；最终`package:win:unrestricted` exit0，137dist/199owner包内字节审计通过。修正打包入口前的首轮候选及冻结/日志另存`candidate-01`，未安装、不作为最终交付。

## 实际验证与制品

- 最终生产UI：`.diagnostics/electron/sparkapi-logo-2026-10-25T12-29-14-532Z/report.json` ok。日夜workspace/about/login两组6截图，8处图片natural180、透明/金色/可见且无filter/opacity调色；真实菜单/关于/退出登录动作，2实例正常exit0、forced=false。早期诊断使用已被production压缩的class而失败，证据保留；仅改用稳定ARIA/data-surface后复测通过。
- 原生窗口：真实Win32 `WM_GETICON`取得主窗与独立Agent各180px图标；alpha与不透明RGB逐像素吻合官方原图，按GDI预乘RGB存储比较的MAE0.0386。证据`native-icon-pixels.json`与`pe-icons-runtime.json`，已目检实际原生图。
- Windows PE：`pe-icons-installed.json`绑定app/setup/uninstaller/installed-app/installed-uninstaller五个PE完整hash，并对每个七帧图标资源逐字节SHA核对。`embedded-logos.json`另核对两个WPF内嵌PNG原字节SHA等官方b7f0c932…；`wpf-ui/report.json`安装welcome/卸载confirm两张capture截图目检通过，只取证、不卸载。
- 最终EXE：`release/local-deliveries/sparkapi-logo-2026-10-25/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe`，110,246,912 B / SHA-256 `ac3635ab7e2a75136ebb634566b4bc8cc88f5a147e33389c17e4140755539a74`。ASAR53,533,117 B / `fada87c736ee7a8fbc0fb64b471bbac357cceb7386d9c697da2a9e112e2bddea`。P1/P2独立原制品保持，不以同版本文件名判断身份。
- 安装：`install.json` ok，所有同名实例[]后品牌/S原位升级exit0/23,575ms，原`E:\sparkai-workspace\naimage`/1.0.9、配置/凭据metadata/shortcut偏好保留。安装EXE SHA-256 `96502a6c9919788d2f30d84e23c171d1e579f8b91f6be0b87d968a03751efd1c`和ASAR匹配最终包；无强杀、无凭据内容读取。
- Windows入口：`shortcut-icons.json`实读2条桌面/开始菜单shortcut Target/IconLocation，及注册卸载DisplayIcon，均指向已核对新PE资源的安装主EXE。Explorer可见缓存未单独观察，不清理缓存/重启Explorer；物理DPI未测。未据逻辑指向推断用户Shell缓存已刷新。
- Git：本轮15个源码/资产/文档增量精确暂存后普通commit/push及HEAD/upstream/实际remote核验；旧设计/规则/参考与artifacts dirty保留。实际Git结果后补checkpoint，完整本地身份与证据索引写`.diagnostics/sparkapi-logo-2026-10-25/delivery.json`；二进制安装包与私有配置不入Git。

所有本轮诊断JSON/截图位于`.diagnostics/sparkapi-logo-2026-10-25/`，生产UI六图在上列Electron报告目录。仅官网公开Logo下载；0模型/图片/视频/ComfyUI请求，无新依赖、生产改动、Release/tag或EXE上传。
