# SparkAI WorkSpace 竞品扫描（2026-11）

2026-11-16 查询。价格随地区/年付/促销变化，“未核实”指未取得可信页面。[1]–[33]见文末。

## 结论

同质在生图/编辑、画布、聊天、订阅与模板；项目状态、需求、溯源、任务恢复和本地主权未统一。Krea、Canva、Adobe 的“画布+对话+分发”闭环最危险；开源与 Agent 压低单点价。SparkAI 宜避开模型/素材规模、推理价格和通用 Agent，聚焦同一项目内可复核、可继续、可本地执行的视觉工作。

## 直接竞品

|产品：定位/交互/价格/分发|优势、重叠、SparkAI 空位|
|---|---|
|Krea：实时画布、图像/视频、Node Agent；网页，免费+订阅，价未核实[1]|实时/模型宽；重叠画布+Agent；空位：需求、谱系、BYO/本地|
|Canva AI 2.0：对话/代理生成可编辑设计；Free/Pro/Business，价未核实[28]|模板/协作/分发；重叠对话设计；空位：谱系、四工作台、本地 Agent|
|Adobe Firefly Boards：网页画布/Boards，生成/协作；积分制[2]|Adobe 生态；重叠画布/生成；空位：BYO、离线、回执|
|Recraft：画布、矢量/栅格、品牌风格；免费+Pro，价未核实[3]|矢量/文字；重叠画布/编辑；空位：provenance、CLI/MCP 合同|
|Freepik/Magnific：素材+Spaces/节点、图像/视频/放大；订阅，价未核实[4]|素材/模板；重叠生成；空位：项目主权、受管本地|
|Figma AI：设计生成、原型/Make；席位+AI credits[5]|结构化设计/协作；重叠可编辑设计；空位：图片/视频成果、素材哈希|
|Playground/Photopea：网页编辑；Playground Pro $15、Auto $45/月；Photopea 免费+Premium，价未核实[6][7]|易用/PSD；表面像工作台；空位：Agent、记忆、追踪|
|Lovart/FLORA：设计 Agent，价未核实[8]；画布/节点、API/MCP，年付 $50/$100/$200/月示例[9]|节点/API；重叠 Agent/画布；空位：单 Agent、来源、本地|
|即梦画布：中文生成、画布、协作、Agent/CLI；网页/移动，会员价未核实[33]|中文/渠道；重叠画布/Agent/CLI；空位：独立项目、BYO|

## 开源/自托管

|产品：定位/交互/许可/分发|优势、重叠与空位|
|---|---|
|ComfyUI：节点图/API，本地/远程，GPL-3.0[11]|控制/节点；执行后端；空位：受管 image_gen、安全、回执|
|InvokeAI：自托管画布/图层，Apache-2.0[12]|画布/图层；重叠 AI 编辑；空位：四工作台、需求、BYO|
|Krita AI Diffusion：Krita 插件连 ComfyUI，GPL-3.0[13]|绘画；需懂 Krita/后端；空位：傻瓜项目台、受管任务|
|Fooocus/A1111：本地 Web UI；Fooocus limited LTS，GPL-3.0[14]；A1111 维护放缓，AGPL-3.0[15]|模型控制；参数面板；空位：追溯、workflow UI|
|Open WebUI：自托管多模型/工具/MCP；0.6.6+ 非 OSI 且品牌受限[16]|模型路由；重叠 Agent/本地执行；空位：图片项目与谱系|

## 垂直工作流

|领域/产品：定位/交互/价格/分发|优势、重叠与空位|
|---|---|
|电商·Photoroom：抠图/背景/批量/目录/Shopify listing；Pro 约 $12.99/月起（地区/年付未核实）[17]|批量/模板/API；commerce；空位：商品知识、证据化采用|
|电商·Flair/Pebblely：商品场景/模板；Flair 免费+$8/$26/$38 月付示例，Pebblely 价未核实[18][19]|电商速度/模板；易商品化；空位：BYO、需求、审计来源|
|中文·美图/稿定/即梦：营销图、电商/社媒模板/视频；网页/移动/会员，套餐未核实[20][21][33]|中文模板/渠道；commerce/social；空位：跨平台资产、本地|
|社媒·Canva/剪映：Canva 模板/品牌；剪映视频/即梦生态，订阅随地区[28][22]|生产效率；social；空位：三领域共用项目/来源链|
|科研·BioRender/Mind the Graph/Figdraw：图标库/拖拽示意图/期刊导出；Mind the Graph 价未核实[23][24][25]|学术符号；scientific；空位：CSV/TSV、Python/R、投稿|

## 相邻 Agent + 本地执行

|产品：定位/交互/价格/分发|优势、重叠与空位|
|---|---|
|Manus/Genspark：通用 Agent，浏览器/代码/文件；Manus 价未核实[26]；Genspark Plus $24.99/月示例[27]|自治/交付；重叠 Agent；空位：视觉项目、TaskScope|
|Claude Desktop/Codex：桌面/CLI Agent、本地文件/工具/MCP，随订阅/企业计划[29][30]|推理/开发/编排；空位：固定视觉项目、资产/需求界面|
|Cherry Studio/Chatbox：桌面多模型、BYOK、MCP/本地；Cherry 自 v1.5.0 AGPL-3.0[31]，Chatbox Free/Lite/Pro $3.99/$19.99/月示例[32]|切换/开发；重叠 BYO/Agent；空位：本地资产、画布、领域台|

## 同生态：非竞品

`sparkapi.org` 是用户可独立部署的 New API 入口；New API 拥有账号、渠道、quota、计费/Web 管理；Extension 只做轻量授权及 `/v1/image-tasks` 在调用者 Key 下包装原生同步 Images API。桌面免费，拥有项目、画布、四工作台、本地 Agent、ComfyUI、CLI/MCP，并接受 BYO Key。分工是“上游账号/计费→可选扩展→本地创作台”；重叠仅图片请求，不应互写为竞品或复制账号/计费进桌面。[0]

## 同质性分层

- 功能：生图/编辑/抠图/放大/套图/聊天 Agent 商品化，开源更基础。
- 交互：画布+侧栏共享；Krea Node、Canva 对话、FLORA 节点/API 已占住；较深的是单项目 Agent、Requirement、TaskScope、恢复/采用。
- 受众：创作者/设计师重叠最大；电商/社媒/科研/自托管不同，四工作台不等于自然转换。
- 分发：SaaS 账号/积分、开源安装、SparkAI Electron+BYO；也是获客成本。
- 商业：订阅/积分/API 增购主流；软件免费改变支付，但不自动成护城河。
- “会聊天、能生图、有画布”仅表面；可复核状态、跨入口一致、迁移才是候选差异。

## 判断

1. 最危险替代：通用创作者看 Canva AI 2.0、Krea，专业团队看 Adobe Firefly Boards，中文市场看即梦。[1][2][28][33]
2. 最易商品化：生图、抠图、换背景、批量尺寸、套图、积分计费；开源/API 压价。
3. 最可能差异化：Requirement 版本、素材哈希/provenance、采用证据、幂等任务、GUI/CLI/MCP 合同。
4. 本地 Agent+BYO 可避开单一云锁定，前提是连接/凭据/网络收进受管边界。
5. 不宜正面竞争模型数量、素材/模板规模、推理价格、科研图标库或通用 Agent IDE。
6. 开源替代既是流失风险也是后端生态；价值应在普通用户可用的统一项目层。
7. 中文电商/社媒模板/渠道/价更强；SparkAI 应强调资产主权、可复核来源、迁移任务。

## 来源（2026-11-16）

[0] `sparkai_workspace/PRODUCT_INTENT.md` 当前定位/最终目标、`GOAL.md`
[1] https://www.krea.ai/agents [2] https://helpx.adobe.com/firefly/web/create-mood-boards/firefly-boards-overview.html [3] https://www.recraft.ai/pricing [4] https://www.freepik.com/ai/magnific [5] https://www.figma.com/pricing/ [6] https://playground.com/pricing [7] https://www.photopea.com/ [8] https://www.lovart.ai/ [9] https://www.floraai.com/pricing [10] https://jimeng.jianying.com/ai-tool/home
[11] https://github.com/comfyanonymous/ComfyUI [12] https://github.com/invoke-ai/InvokeAI [13] https://github.com/Acly/krita-ai-diffusion [14] https://github.com/lllyasviel/Fooocus [15] https://github.com/AUTOMATIC1111/stable-diffusion-webui [16] https://docs.openwebui.com/license/
[17] https://www.photoroom.com/tools/bulk-image-editing [18] https://flair.ai/pricing [19] https://pebblely.com/ [20] https://design.meitu.com/ [21] https://www.gaoding.com/ [22] https://www.capcut.cn/ [23] https://www.biorender.com/pricing [24] https://mindthegraph.com/pricing/ [25] https://www.figdraw.com/
[26] https://manus.im/ [27] https://www.genspark.ai/pricing [28] https://www.canva.com/newsroom/news/canva-creates-ai/ [29] https://support.anthropic.com/en/articles/10065433-claude-desktop [30] https://openai.com/index/introducing-codex/ [31] https://github.com/CherryHQ/cherry-studio [32] https://chatboxai.app/pricing
[33] https://jimeng.jianying.com/
