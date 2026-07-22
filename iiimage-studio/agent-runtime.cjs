/*
IIimage Agent Runtime Map

File Contract
- agent-runtime.cjs orchestrates the desktop Agent loop: prompt entries, tool execution, memory/context stores, image generation, and model response parsing.
- Tool schema ownership lives in runtime/tool-schemas.cjs and is consumed here as a stable contract.
- It returns workflow actions to the frontend instead of mutating React state directly.
- Keep workbench/node control as tool actions so frontend and runtime stay loosely coupled.

Region Index
01 Runtime Constants And Default Prompt Entries
02 Tool Labels, Briefs, Errors, And Progress Helpers
03 Image And Layer Argument Normalizers
04 Tool Schema Integration
05 Context, Memory, And Toolmemory Stores
06 Tool Execution
07 Model Calls, Streaming Parsing, And Agent Loop
08 Prompt Assist, Smoke Test, And Public Runtime API
*/

const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const {
  imagePromptQualities,
  imagePromptRatios,
  imagePromptResolutions,
  normalizeImage2Size,
  normalizeImagePromptResolution,
  normalizeImageToolFrame,
  parseImageRatioValue,
  parseImageSizeValue,
  validateImageFrameFields
} = require("./runtime/image-frame.cjs");
const {
  imageInfo,
  mimeTypeForPath,
  prepareViewImageModelPayload,
  readRuntimeImageFile,
  runtimeImageSourceMaxBytes,
  viewImageModelPayloadMaxBytes,
  viewImagePathAllowed,
  viewImagePayloadBudgetForBatch
} = require("./runtime/view-image-payload.cjs");
const {
  agentToolSchemas,
  imageModelContractForSettings,
  imageModelPoolFromSettings,
  primaryImageToolName,
  toolSchemas
} = require("./runtime/tool-schemas.cjs");
const {
  contentDeltaFromChunk,
  messageFromResponse,
  reasoningDeltaFromChunk,
  responseFromStreamChunks
} = require("./runtime/responses-parser.cjs");

let DatabaseSync = null;
let sqliteLoadError = null;
let sharpImage = null;

try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch (error) {
  sqliteLoadError = error;
}

try {
  sharpImage = require("sharp");
} catch {
  sharpImage = null;
}

const visibleToolChars = 6000;
const dateMemoryCompactChars = 200000;
const mainContextCompactTokens = 32000;
const mainContextCompactMessageCount = 24;
const mainContextRecentMessages = 10;
const tokenCharRatio = 4;
const mainAgentPromptMaxChars = 100000;
const scopedFastMemoryMaxChars = 64000;
const fastMemoryPromptMaxChars = 12000;
const fastMemoryPromptSegmentChars = 1400;
const mainWorkbenchSnapshotMaxChars = 9000;
const mainWorkbenchRecentArtifacts = 24;
const protocolHistoryMaxTurns = 36;
const protocolHistoryPromptChars = 180000;
const protocolHistoryStoreChars = 260000;
const promptTextContractRevision = 12;
const imageToolNames = new Set([primaryImageToolName]);
const internalOnlyToolNames = new Set(["memory", "context_manage"]);
const experiencePublicArgumentKeys = new Set(["action", "title", "text", "summary", "instruction", "rating", "brief"]);
const knownImageModelFallbacks = ["gpt-image-2", "gpt-image-1.5", "gpt-image-1"];
const normalizedImageToolArgsMarker = Symbol("iiimage.normalizedImageToolArgs");

function isImageToolName(name = "") {
  return imageToolNames.has(String(name || ""));
}

const defaultMainAgentPromptLines = [
  "你是 IIimage 项目的图片生产 Agent，也是用户在项目内的唯一智能操作入口。画布展示单图、图片组、分层 PNG 组、用户主动保存的可复用需求节点和它们的来源关系；命令、搜索、分析、计划和工具过程只出现在对话时间线，绝不能变成画布节点。你不创建子 Agent，也不能自行创建任意任务链；需求节点只是用户保存并反复优化的一段图片处理要求。",
  "默认使用简短、直接的 Markdown 回复。普通问答直接回答；需要调用工具时先用一句自然语言说明你理解了什么、准备做什么，再在同一轮返回真实 tool_call，不能用“我会、正在、马上生成”代替工具调用。图片完成后只说明生成数量、任务类型和必要的失败信息。",
  "IIimage 自有工具调用填写 brief：用一句简短、用户可读的话说明本次工具正在做什么，不写“Brief”标题，不暴露路径、内部标识、内部参数或实现细节。Codex 原生 web_search、view_image、shell_command 使用其原生 Schema，不额外伪造 brief。image_gen 的 prompt/items.prompt 只能包含最终画面需要呈现的视觉内容，必须彻底省略任务 nonce、AIDebug/SELFTEST 标记、文件路径、节点或调用 ID、记忆 ID、实现说明和其他非画面文本，即使以“不要出现”或“内部约束”形式也不能复制进去。顶层 prompt 必须填写完整视觉提示词，界面会默认折叠展示；count=1 时只使用顶层 prompt，禁止生成 items。只有至少两个不同成品时才填写 items.prompt，不得添加 temp、placeholder、todo、示例或测试占位项。工具调用不能由文字承诺替代。",
  `按任务选择最小必要工具：${primaryImageToolName} 负责所有真实图片生成和编辑；shell_command 只做项目内受控只读诊断；view_image 把本地图片作为 input_image 放回当前模型上下文；web_search 是 GPT Responses 原生联网工具；workflow 只管理已有成果；experience 保存稳定的创作偏好；ask_user 仅补充真正缺失的关键输入。后台上下文维护由运行时自动完成，主 Agent 不直接管理内部记忆条目。模型由用户设置决定，不要擅自降级。`,
  `${primaryImageToolName} 支持 generate、edit、replace、variants、layers、cutout、redraw。count=1 时完整提示词只写在顶层 prompt，绝不填写 items；相同提示词生成多张用 count；只有本轮确实存在至少两个不同成品提示词时才使用 items，每项对应一张独立图片且最多 10 项。Current Task Scope 存在 SOURCE 时禁止使用 generate，因为 generate 不会读取原图；必须按意图使用 edit、replace、variants、layers、cutout 或 redraw，并在多 SOURCE 时逐项填写 sourceBindingId。缺少需要处理的 SOURCE 时使用 ask_user(kind=source_images)，缺少仅作参考的 REFERENCE 时使用 ask_user(kind=reference_images)，不要猜路径，也不要把 REFERENCE 当成 SOURCE。cutout/redraw 没有蒙版时只会打开选区编辑器，用户提交选区后才执行图片生成。`,
  "先理解目标，再直接执行；不要只输出计划。图片任务成功则简短汇报，失败则读取错误类别并最多修正参数重试两次。复杂任务可先用 view_image、web_search 或 shell_command 获取必要事实，再调用 image_gen。缺少来源图片时打开参考图收集，不得假装已经出图。",
  "默认交付商业级高质量图片：主体与视觉层级明确，构图有清晰意图，景别严格符合用户要求，留白和视觉动线可控，材质、光线、边缘与细节可信。特效必须克制且服务主体；除非用户明确要求，不堆砌粒子、光斑、几何碎片、廉价辉光、无意义装饰或伪文字，也不把多个独立方案画成拼贴。先服从用户给定的风格与审美，再用这些底线避免俗气、混乱和模板感。",
  "审美决策按用户当前明确要求、参考图角色与用途、当前选中成果、当前会话 FastMemory、通用质量底线的顺序执行。不得擅自把所有任务套成电影感、蓝金、高级黑、东方风、海报感或其他固定模板；用户要求宽泛时只补充有助于构图、材质、光线和可用性的细节，不虚构品牌、口号、角色设定、商品卖点或装饰元素。",
  "调用 image_gen 前，把用户目标整理成紧凑的结构化视觉提示词，优先按用途、主体及身份或商品、场景、风格与媒介、构图与景别、光线与氛围、必须逐字呈现的文字、参考图分工、保留项与禁改项、输出意图组织。复杂任务可使用这些短标签；不要把分析过程、内部说明或用户对话原文写入 prompt。",
  "每张输入图片都要明确分工：edit_target/source 是被修改的原图，identity 提供人物身份，garment 提供服装版型与图案，product 提供商品几何、标签和材质，style 只提供视觉语言，composition 只提供取景与版式，scene 只提供环境。不得默认把所有参考图都当作编辑目标，也不得让风格参考图替换主体或商品。purpose 要说明从该图迁移什么、必须保留什么。",
  "运行时会提供不可变的 TaskScope v2：scopeType 描述单图、容器、容器组或分层范围，SOURCE 是本轮需要处理的素材，REFERENCE 只影响视觉参考而不决定输出数量，resultPolicy 规定成果按单图、来源、容器或图层归组。snapshotHash 和 canvasRevision 用于识别这一轮冻结的画布状态；调用 ask_user 后继续任务时必须沿用同一份作用域，不得因为画布历史信息自行扩大或替换来源。confirmationPolicy=preview-3 时先向用户确认是否先做 3 版，staged 时确认分批规模，direct 仅在用户已经明确授权直接批量时使用，auto 不要添加多余确认。",
  "所有编辑、替换、重绘、抠图和基于来源图的变体都遵循‘只改变目标变量，其他成功要素保持不变’：重复声明人物身份与面部、姿势、商品几何与标签、服装结构与图案、背景、版式、文字、镜头和配色中需要锁定的部分。用户只要求局部变化时不得顺带重做整张图；系列与多版的每个 items.prompt 都要重复核心不变量，只写清本项唯一变化。",
  "电商商品图优先保证商品轮廓、比例、结构、标签、Logo、材质、颜色和真实接触关系；用户要求保留位置或尺度时，质检必须比较商品中心点以及宽高占整幅画面的比例，明显超过约 10% 的偏移或缩放应视为需要修正，不能只判断商品身份相似。多角度图要保持同一商品身份，只改变镜头，并为每张明确方位角、俯仰角、应当显露的侧面或顶部结构及对应投影变化，角度差在缩略图中也必须明显，禁止仅镜像、轻微平移或继续输出近似正面图；若参考图只展示正面，未展示的背面结构只能作为推断，最终必须说明该边界。质检中若图片仍像正面或前侧，就不得声称后侧机位已经成功。换物或改文案只替换指定目标，要求文字时用引号写出逐字正文，禁止额外单词和伪文字。服装上身优先锁定模特身份、人体结构与服装版型、领口、袖型、缝线、图案、Logo、材质、颜色和垂坠关系，不能把服装参考仅当作配色灵感。",
  "Logo 任务先探索清晰概念、轮廓和缩小辨识度，可按需要生成单色、反白或透明背景版本；image_gen 输出是栅格概念图，不得声称是可编辑矢量文件。UI 视觉任务先定义目标尺寸、信息层级、阅读顺序、导航与实际控件，再决定装饰风格；需要切片或分层时使用真实 layers，不把不可交互的装饰拼贴冒充可用界面。",
  "插画发布任务要服从平台比例、安全区、主体辨识度与系列一致性。角色定制和游戏原画要锁定面部身份、轮廓、体型、服装结构、配色、材质与标志性道具；三视图、表情、姿势和连续场景必须是同一角色，除非用户明确要求变体，不得在每张图中重新设计角色。",
  "image_gen 成功返回真实图片后，在最终回复前进行视觉质检：单图必须调用 view_image 查看新成果；多图若提示词相同，至少检查代表图、首尾图和任何明显异常图，若提示词不同则逐张检查。正常构图、文字和一致性质检使用 detail=high；detail=original 只用于单张图片确实需要原始像素或原生分辨率核对时，多张图片不得在同一轮全部请求 original。需要把成图与来源或身份参考对比时，在同一个 assistant 回合并行调用所需的 view_image，让下一轮同时获得完整对照；不要在连续回合里来回交替查看同一批路径。当前质检中某条路径已成功查看后，除非生成了新成果、切换 detail 有明确必要或首次观察失败，否则不得重复打开。核对后必须立即二选一：确认交付，或最多主动修正并重新生成一次再复核；如果修正后仍明显不满足用户约束，保留可用文件但必须明确报告部分失败、具体未达项和所需补充参考，禁止把不合格结果描述为已经成功。不要无休止抽卡、循环验图，也不要仅用文字宣称图片合格。用户明确要求不复核或只要快速草稿时可跳过。",
  "image_gen 成功回执会直接列出可供 view_image 使用的 project-local output_paths。必须优先使用这些路径检查新成果，不要再调用 workflow 或 shell_command 搜索、猜测或解析输出位置；只有回执明确缺少路径时才根据错误信息决定下一步。",
  "image_gen 返回 ok=false 时不要假装完成。transient、timeout、rate_limit 或 upstream_5xx 可降低张数或分辨率后重试；quota、auth、invalid_input、missing_reference 或 policy 应直接说明。最多连续重试两次同类错误。",
  "工具输出可能被截断，运行时会保留完整回执供后续读取。最终回复只保留用户需要看的结论、图片结果和下一步；不要伪造未展示的日志细节，也不要要求用户粘贴运行时已有的工具回执。",
  "没有来源图时 operation=generate；有上传参考图时可 generate 或 edit；换物、改字等精确替换用 replace；基于当前图片出多款用 variants；分层 PNG 用 layers；主体抠图用 cutout；带蒙版局部修改用 redraw。用户说 N 张、N 版、N 种款式时必须准确生成 N 张，最多 10 张。",
  `${primaryImageToolName} 会自动把成果同步到画布。单图使用标准节点；count>1 时必须明确 generationMode：用户在同一轮要求 N 张、N 版、N 个方案或 N 个候选时使用 parallel，并进入批量图片组；只有明确要求一次一张、按故事/时间顺序逐张延续或连续系列时才使用 sequential，并进入连续系列。不同提示词 items 通常使用 parallel；每张图都保留自己的提示词并可拖出为标准节点。基于画布来源继续时设置 parentId，但 parentId 只表示来源关系，不决定 generationMode。`,
  "用户要求‘带分层’、列出多个‘某某一层’或要求分层 PNG 时，只调用一次 image_gen(operation=layers)，禁止用普通 generate/edit 只描述视觉层次。layerPlan 是必填项，必须逐项保留用户列出的每一层并按从底到顶排序；用户指定 N 层就必须准确提供 N 层。role=subject 只用于画面的主要人物、动物或其他有生命主体；香水瓶、商品、服装单品、手持物、家具、器皿及其他独立物件即使被称为‘人物道具’也必须使用 role=decoration，不能标成 subject。背景不透明，主体、前景、装饰、文字等层必须争取真实透明像素；role=text 的每一层还必须在 text 字段给出要实际绘制的完整正文，不能只写‘标题字形’或‘辅助文字’。所有层使用相同完整画布尺寸，并归入一个带唯一编号的分层组；运行时生成合成预览、逐层素材，并由客户端完成透明提取、重组校验和画布提交。工具返回本地校验待完成时，只说明正在校验，不能提前声称已完成、已重组或已展示到画布。缺层、透明度、正文、尺寸或重组一致性不通过时必须明确失败，不能只靠提示词宣称成功。Current Workbench Snapshot 若显示 layerRecovery，只使用 resumeLayerGroupId 指向该组，并把 retryLayerIds 限定为 failed 列表；工具会复用 successful 图层，禁止重新生成已成功层。",
  `调用 ${primaryImageToolName} 时，如果用户给了比例，必须设置 ratio；优先使用 ratio + resolution 表达最终交付画幅，不要猜图像服务的底层请求尺寸。3:4 竖图优先使用 ratio=3:4。`,
  "用户在同一轮要求多版、多张候选或‘基于这张再来 N 张’时，用 count + generationMode=parallel，并继承 parentId；‘继续基于当前图’只说明来源关系，不等于 sequential。sequential 仅用于用户明确要求一次一张、按故事/时间顺序推进或连续系列。用户要求至少两个明确不同主题、文案或商品方案时才用 items，为每张写自己的完整 prompt，通常设置 generationMode=parallel。单图任务只填 prompt/count=1，禁止为了满足 items 的最小项数添加 temp、placeholder、todo、sample 或任何无意义第二项。任何多图都禁止让模型画成三联图、九宫格、拼贴或分镜。",
  "当用户评价刚才或当前图片存在问题，并给出景别、构图、风格、设计感、元素多少、主体比例等调整意见时，默认意图是立即改进并再生成一版，不是让你复述问题。除非用户明确说只分析、先讨论或不要再画，否则同一轮先调用 experience(action=add) 把反馈提炼为可复用的创作经验，再调用 image_gen 基于当前选中或最近生成图片继续创作。experience 必须排在 image_gen 之前；经验要泛化成稳定原则，不照抄抱怨。不要先输出“收到，问题明确”或逐条复盘，直接让工具结果体现理解。",
  "当前选择与输入区附件会作为动态上下文提供，但运行时不会猜测来源节点；需要画布来源时自行填写 parentId，输入区附件会作为参考图使用。不要要求用户复制文件路径，也不要把路径写进回复。元素替换和多款设计必须继承来源图；非替换区域、主体身份、产品轮廓和用户要求保留的内容应尽量稳定。",
  "自定义函数工具结果会按 Responses function_call_output 协议回到同一模型上下文；view_image 直接返回 input_image；web_search 由 Responses 原生执行。根据真实回执继续执行、重试或停止，不要伪造工具结果。"
];

const defaultMemoryAgentPromptLines = [
  "你是 IIimage 的后台记忆 Agent。你不面对用户，只负责上下文压缩、datememory 写入、toolmemory 大回执摘要和 fastmemory 经验提炼。",
  "维护任务只处理本轮明确提供的内容，不主动展开主 Agent 的完整上下文。",
  "写 datememory 时按日期生成日记，关键词必须明确；保留任务起因、关键过程、决定、结果、风险和下一步线索。",
  "压缩 context 时保留用户意图、关键决策、图像参数、必要的工具引用、错误证据和验证结果；同时把稳定偏好或可复用绘图经验写入当前项目当前会话的 fastmemory。",
  "完成后只返回处理结果，不把大段上下文带回前台。"
];

const defaultMainAgentPrompt = defaultMainAgentPromptLines.join("\n");
const defaultMemoryAgentPrompt = defaultMemoryAgentPromptLines.join("\n");
const defaultMainAgentPromptRevision = promptTextContractRevision;
const defaultMainAgentPromptHash = textSha256(defaultMainAgentPrompt);
const previousDefaultMainAgentPromptHashes = new Set([
  "2bd57aa9e4acd058da0165cc61ac3d7d124509a0fbc5f1d899327d9aace53495",
  "06fbfb3284cf0d5118ba736106b37ad1ebde446edae4173ea4f949263e5e3601",
  "d8ba796ee479789ca507d7035d06d4c93984deeb87cdc805fd773e236786c3bf",
  "b01c6266e20eda825573a44e0fe7a0acd474e7470c820284b5bc88a53e9bbf85",
  "958c11cc1e2628da78b03f7ca3a5836b6d2d940c779ee256672343dde0b140d6",
  "fa1925ab7fb0f1d41aedc0b5a9d7955e80cea19462635017cddad925c531e313",
  "09536ba4b34f809746b7c14d2b0fbbfbd090f35d66a6239e801346f9d40e2356"
]);

function textSha256(value = "") {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function promptStoreStatus(store = {}) {
  const text = String(store.mainPrompt || defaultMainAgentPrompt);
  const currentPromptHash = textSha256(text);
  const isDefault = text === defaultMainAgentPrompt;
  const baseDefaultPromptRevision = Number(store.baseDefaultPromptRevision || 0);
  const baseDefaultPromptHash = String(store.baseDefaultPromptHash || "").trim().toLowerCase();
  return {
    isDefault,
    currentPromptHash,
    defaultPromptRevision: defaultMainAgentPromptRevision,
    defaultPromptHash: defaultMainAgentPromptHash,
    baseDefaultPromptRevision,
    baseDefaultPromptHash,
    defaultUpdateAvailable: !isDefault && (
      baseDefaultPromptRevision !== defaultMainAgentPromptRevision ||
      baseDefaultPromptHash !== defaultMainAgentPromptHash
    )
  };
}

function defaultPromptText(section = "main") {
  return section === "memory" ? defaultMemoryAgentPrompt : defaultMainAgentPrompt;
}

function migrateLegacyPromptEntryText(entryId, value) {
  let text = String(value || "").replace(/\0/g, "");
  if (entryId === "prompt-main-tool-brief") {
    text = text.replace(/不暴露路径、entry id、内部参数/g, "不暴露路径、内部标识、内部参数");
  }
  if (entryId === "prompt-main-output-budget") {
    text = text.replace(/工具输出可能被截断，回执会带 entryId 或 memoryRef。/g, "工具输出可能被截断，运行时会保留完整回执供后续读取。");
  }
  if (entryId === "prompt-main-entry-id-contract") {
    text = text.replace(
      /工具结果会以 role=tool 的 JSON 回执返回，包含 ok、tool、summary、entryId、errorCategory、memoryRef 等字段。/g,
      "工具结果会以 role=tool 的结构化回执返回，包含执行状态、工具名称、摘要和错误类别等必要信息。"
    );
  }
  if (entryId === "prompt-memory-compact") {
    text = text.replace(/工具 entry id/g, "必要的工具引用");
  }
  return text
    .split(/\r?\n/)
    .filter((line) => !/\b(?:entry[_ ]?ids?|entryId|memoryRef|selector|sourceEntryIds|selectedEntryIds)\b\s*[:=]/i.test(line))
    .map((line) => line.replace(/\b(?:fmem|ent|pmt|mctx)-[a-z0-9_-]+\b/gi, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function migrateLegacyPlainTextPrompt(section, value) {
  let text = String(value || "").replace(/\0/g, "").replace(/\r\n/g, "\n");
  if (section === "memory") {
    text = text
      .replace(
        /维护任务会一次性给出 datememorycontext 或需要 compact 的 entries。只处理本轮 payload，不主动展开主 Agent 的完整上下文。/g,
        "维护任务只处理本轮明确提供的内容，不主动展开主 Agent 的完整上下文。"
      )
      .replace(/写入 fastmemory。/g, "写入当前项目当前会话的 fastmemory。");
  } else {
    text = text.replace(
      /memory\s*\/\s*context_manage 属于内部维护，不主动调用。/gi,
      "后台上下文维护由运行时自动完成，主 Agent 不直接管理内部记忆条目。"
    );
    text = text
      .split(/\n\s*\n/)
      .filter((paragraph) => !/(?:workflow\s*\(\s*operation\s*=\s*(?:list_agents|manage_agent|create_agent_node)|创建子\s*Agent|管理子\s*Agent|列出子\s*Agent|母\s*Agent)/i.test(paragraph))
      .join("\n\n");
  }
  return migrateLegacyPromptEntryText("", text)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function promptTextStoreFromRaw(rawStore) {
  const source = rawStore && typeof rawStore === "object" ? rawStore : {};
  const now = new Date().toISOString();
  const isPlainTextStore = source.version === 2 || source.format === "plain-text" || Object.prototype.hasOwnProperty.call(source, "mainPrompt");

  if (isPlainTextStore) {
    const rawMainPrompt = typeof source.mainPrompt === "string" ? source.mainPrompt.replace(/\0/g, "") : "";
    const rawMemoryPrompt = typeof source.memoryPrompt === "string" ? source.memoryPrompt.replace(/\0/g, "") : "";
    const currentContract = Number(source.contractRevision || 0) >= promptTextContractRevision;
    const inheritsPreviousDefault = previousDefaultMainAgentPromptHashes.has(textSha256(rawMainPrompt.replace(/\r\n/g, "\n")));
    const migratedMainPrompt = inheritsPreviousDefault
      ? defaultMainAgentPrompt
      : currentContract
        ? rawMainPrompt
        : migrateLegacyPlainTextPrompt("main", rawMainPrompt);
    const migratedMemoryPrompt = currentContract ? rawMemoryPrompt : migrateLegacyPlainTextPrompt("memory", rawMemoryPrompt);
    const mainPrompt = migratedMainPrompt.trim() ? migratedMainPrompt : defaultMainAgentPrompt;
    const memoryPrompt = migratedMemoryPrompt.trim() ? migratedMemoryPrompt : defaultMemoryAgentPrompt;
    const promptMatchesDefault = mainPrompt === defaultMainAgentPrompt;
    const rawBaseDefaultPromptRevision = Number(source.baseDefaultPromptRevision || 0);
    const rawBaseDefaultPromptHash = /^[a-f0-9]{64}$/i.test(String(source.baseDefaultPromptHash || ""))
      ? String(source.baseDefaultPromptHash).toLowerCase()
      : "";
    const baseDefaultPromptRevision = promptMatchesDefault
      ? defaultMainAgentPromptRevision
      : Math.max(0, rawBaseDefaultPromptRevision);
    const baseDefaultPromptHash = promptMatchesDefault
      ? defaultMainAgentPromptHash
      : rawBaseDefaultPromptHash;
    const updatedAt = typeof source.updatedAt === "string" && source.updatedAt.trim() ? source.updatedAt : now;
    const store = {
      version: 2,
      format: "plain-text",
      contractRevision: promptTextContractRevision,
      mainPrompt,
      memoryPrompt,
      baseDefaultPromptRevision,
      baseDefaultPromptHash,
      updatedAt
    };
    return {
      store,
      changed:
        source.version !== store.version ||
        source.format !== store.format ||
        Number(source.contractRevision || 0) !== store.contractRevision ||
        source.mainPrompt !== store.mainPrompt ||
        source.memoryPrompt !== store.memoryPrompt ||
        Number(source.baseDefaultPromptRevision || 0) !== store.baseDefaultPromptRevision ||
        String(source.baseDefaultPromptHash || "").toLowerCase() !== store.baseDefaultPromptHash ||
        source.updatedAt !== store.updatedAt ||
        Object.prototype.hasOwnProperty.call(source, "entries")
    };
  }

  const entries = Array.isArray(source.entries)
    ? source.entries
        .filter((entry) => entry && typeof entry === "object" && String(entry.status || "active") === "active")
        .map((entry, index) => ({
          section: String(entry.section || "main"),
          orderIndex: Number.isFinite(Number(entry.order_index)) ? Number(entry.order_index) : index + 1,
          sourceIndex: index,
          text: migrateLegacyPromptEntryText(String(entry.entry_id || ""), entry.text).trim()
        }))
        .filter((entry) => entry.text)
        .sort((a, b) => a.orderIndex - b.orderIndex || a.sourceIndex - b.sourceIndex)
    : [];
  const sectionText = (section) => entries.filter((entry) => entry.section === section).map((entry) => entry.text).join("\n\n");
  const mainPrompt = migrateLegacyPlainTextPrompt("main", sectionText("main")) || defaultMainAgentPrompt;
  const promptMatchesDefault = mainPrompt === defaultMainAgentPrompt;
  return {
    store: {
      version: 2,
      format: "plain-text",
      contractRevision: promptTextContractRevision,
      mainPrompt,
      memoryPrompt: migrateLegacyPlainTextPrompt("memory", sectionText("memory")) || defaultMemoryAgentPrompt,
      baseDefaultPromptRevision: promptMatchesDefault ? defaultMainAgentPromptRevision : 0,
      baseDefaultPromptHash: promptMatchesDefault ? defaultMainAgentPromptHash : "",
      updatedAt: now
    },
    changed: true
  };
}

function sanitizeFastMemoryText(value) {
  const internalIdPattern = /\b(?:fmem|ent|pmt|mctx)-[a-z0-9_-]+\b/gi;
  const lines = String(value || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (/^#{1,6}\s*(?:fast\s*memory|fastmemory)\s+compact\b/i.test(trimmed)) return false;
      if (/^\[(?:fmem|ent|pmt|mctx)-[a-z0-9_-]+\]\s+[^\s/]+\/[^\s]+/i.test(trimmed)) return false;
      if (/["']?(?:rating|source|entries|entry[_ ]?ids?|entryId|selector|keywords|instruction|section|title|status|compact_of|projectId|conversationId)["']?\s*[:=]/i.test(trimmed)) return false;
      return true;
    })
    .map((line) =>
      line
        .replace(internalIdPattern, "")
        .replace(/\bkeywords\s*=\s*[^\n]+/gi, "")
        .replace(/\bfmem\b/gi, "")
        .replace(/\b(?:entry[_ ]?ids?|entryId|selector|keywords)\b/gi, "")
        .replace(/\[\s*\]/g, "")
        .replace(/[ \t]+$/g, "")
    );
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function splitFastMemoryPromptSegments(value, maxChars = fastMemoryPromptSegmentChars) {
  const text = sanitizeFastMemoryText(value);
  if (!text) return [];

  const hardSplit = (block) => {
    const parts = [];
    let remaining = String(block || "").trim();
    while (remaining.length > maxChars) {
      const minimumCut = Math.floor(maxChars * 0.58);
      const window = remaining.slice(minimumCut, maxChars + 1);
      let cut = -1;
      for (const match of window.matchAll(/[。！？!?；;，,、\n]/g)) cut = minimumCut + Number(match.index || 0) + 1;
      if (cut < minimumCut) cut = maxChars;
      parts.push(remaining.slice(0, cut).trim());
      remaining = remaining.slice(cut).trim();
    }
    if (remaining) parts.push(remaining);
    return parts.filter(Boolean);
  };

  const blocks = text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const segments = [];
  let current = "";
  const flush = () => {
    if (!current.trim()) return;
    segments.push(current.trim());
    current = "";
  };
  for (const block of blocks) {
    const pieces = block.length > maxChars ? hardSplit(block) : [block];
    for (const piece of pieces) {
      const candidate = current ? `${current}\n\n${piece}` : piece;
      if (candidate.length <= maxChars) {
        current = candidate;
      } else {
        flush();
        if (piece.length <= maxChars) current = piece;
        else segments.push(...hardSplit(piece));
      }
    }
  }
  flush();
  return segments;
}

function fastMemoryQueryTerms(scope = {}) {
  const recentUserText = (Array.isArray(scope.messages) ? scope.messages : [])
    .filter((message) => message?.role === "user" && !message.hidden)
    .slice(-4)
    .map((message) => String(message?.content || ""));
  const source = [String(scope.prompt || ""), ...recentUserText].join("\n").toLowerCase();
  const terms = new Set();
  for (const token of source.match(/[a-z0-9][a-z0-9_-]{1,31}|[\p{Script=Han}]{2,24}/gu) || []) {
    const clean = token.trim();
    if (!clean) continue;
    if (/^[a-z0-9]/.test(clean)) {
      terms.add(clean);
      continue;
    }
    if (clean.length <= 12) terms.add(clean);
    for (const width of [4, 3, 2]) {
      if (clean.length < width) continue;
      for (let index = 0; index <= clean.length - width && terms.size < 64; index += 1) {
        terms.add(clean.slice(index, index + width));
      }
    }
    if (terms.size >= 64) break;
  }
  return [...terms].sort((left, right) => right.length - left.length).slice(0, 64);
}

function fastMemorySegmentRelevance(text, terms = []) {
  const haystack = String(text || "").toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (!haystack.includes(term)) continue;
    score += Math.max(2, Math.min(18, term.length * 2));
  }
  return score;
}

function selectFastMemoryPromptContext(entries = [], scope = {}) {
  const orderedEntries = [...entries].sort((left, right) => Number(left.order_index || 0) - Number(right.order_index || 0));
  const terms = fastMemoryQueryTerms(scope);
  const segments = [];
  orderedEntries.forEach((entry, entryIndex) => {
    const chunks = splitFastMemoryPromptSegments(entry.text);
    chunks.forEach((text, segmentIndex) => {
      segments.push({
        text,
        entryIndex,
        segmentIndex,
        segmentCount: chunks.length,
        globalIndex: segments.length,
        relevance: fastMemorySegmentRelevance(text, terms)
      });
    });
  });
  if (!segments.length) return { text: "", totalChars: 0, selectedChars: 0, totalSegments: 0, selectedSegments: 0, truncated: false };

  const completeText = orderedEntries
    .map((entry) => sanitizeFastMemoryText(entry.text))
    .filter(Boolean)
    .join("\n\n")
    .trim();
  if (completeText.length <= fastMemoryPromptMaxChars) {
    return {
      text: completeText,
      totalChars: completeText.length,
      selectedChars: completeText.length,
      totalSegments: segments.length,
      selectedSegments: segments.length,
      truncated: false
    };
  }

  const selected = new Map();
  let selectedChars = 0;
  const add = (segment) => {
    if (!segment || selected.has(segment.globalIndex)) return false;
    const separatorChars = selected.size ? 2 : 0;
    if (selectedChars + separatorChars + segment.text.length > fastMemoryPromptMaxChars) return false;
    selected.set(segment.globalIndex, segment);
    selectedChars += separatorChars + segment.text.length;
    return true;
  };

  const recentEntryIndexes = [...new Set(segments.map((segment) => segment.entryIndex))].slice(-3).reverse();
  for (const entryIndex of recentEntryIndexes) {
    const entrySegments = segments.filter((segment) => segment.entryIndex === entryIndex);
    add(entrySegments[0]);
    add(entrySegments[entrySegments.length - 1]);
  }

  const relevant = segments
    .filter((segment) => segment.relevance > 0)
    .sort((left, right) => right.relevance - left.relevance || right.entryIndex - left.entryIndex || right.segmentIndex - left.segmentIndex);
  for (const segment of relevant) add(segment);

  const recentFirst = [...segments].sort(
    (left, right) => right.entryIndex - left.entryIndex || right.segmentIndex - left.segmentIndex
  );
  for (const segment of recentFirst) add(segment);

  const text = [...selected.values()]
    .sort((left, right) => left.globalIndex - right.globalIndex)
    .map((segment) => segment.text)
    .join("\n\n")
    .trim();
  return {
    text,
    totalChars: completeText.length,
    selectedChars: text.length,
    totalSegments: segments.length,
    selectedSegments: selected.size,
    truncated: true
  };
}

function validateEditableText(value, maxChars, label, sanitizer = null) {
  if (typeof value !== "string") return { ok: false, error: `${label} 必须是纯文本。` };
  if (value.includes("\0")) return { ok: false, error: `${label} 不能包含 NUL 字符。` };
  if (value.length > maxChars) return { ok: false, error: `${label} 不能超过 ${maxChars} 个字符。` };
  const text = typeof sanitizer === "function" ? sanitizer(value) : value;
  if (!text.trim()) return { ok: false, error: `${label} 不能为空。` };
  if (text.length > maxChars) return { ok: false, error: `${label} 不能超过 ${maxChars} 个字符。` };
  return { ok: true, text };
}

function splitKeywords(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 24);
  return String(value || "")
    .split(/[,，;；\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 24);
}

function estimateTokens(text) {
  return Math.ceil(String(text || "").length / tokenCharRatio);
}

function dateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function compactDateKey(value) {
  return String(value ?? "").replaceAll("-", "");
}

function countLines(text) {
  if (!text) return 0;
  return String(text).split(/\r?\n/).length;
}

function normalizeChatUrl(baseUrl) {
  const clean = String(baseUrl ?? "").trim().replace(/\/$/, "");
  if (!clean) return "https://api.openai.com/v1/chat/completions";
  if (clean.endsWith("/v1")) return `${clean}/chat/completions`;
  return `${clean}/v1/chat/completions`;
}

function normalizeApiUrl(baseUrl, endpoint) {
  const clean = String(baseUrl ?? "").trim().replace(/\/$/, "");
  const pathPart = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  if (!clean) return `https://api.openai.com/v1${pathPart}`;
  if (clean.endsWith("/v1")) return `${clean}${pathPart}`;
  return `${clean}/v1${pathPart}`;
}

function readJson(filePath, fallback) {
  try {
    if (!existsSync(filePath)) return fallback;
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tempPath, filePath);
}

function summarizeText(text, maxChars = 1200) {
  const clean = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (clean.length <= maxChars) return clean;

  const lines = clean.split("\n").filter(Boolean);
  const head = lines.slice(0, 16).join("\n");
  const tail = lines.length > 24 ? lines.slice(-6).join("\n") : "";
  const summary = tail ? `${head}\n\n...\n\n${tail}` : head;
  return summary.length > maxChars ? `${summary.slice(0, maxChars - 80)}\n\n...内容已外导到 toolmemory。` : summary;
}

function aidebugMarkersInText(text = "") {
  return Array.from(new Set(String(text || "").match(/\bAIDEBUG_[A-Z0-9_]+_\d+\b/g) || []));
}

function summarizeTextPreservingAidebugMarkers(text, maxChars = 1200) {
  const summary = summarizeText(text, maxChars);
  const missingMarkers = aidebugMarkersInText(text).filter((marker) => !summary.includes(marker));
  if (!missingMarkers.length) return summary;
  const markerBlock = ["AIDebug preserved markers:", ...missingMarkers.map((marker) => `- ${marker}`)].join("\n");
  const baseBudget = Math.max(0, maxChars - markerBlock.length - 6);
  const base = summary.length > baseBudget ? `${summary.slice(0, Math.max(0, baseBudget - 18))}\n...` : summary;
  return [base, markerBlock].filter(Boolean).join("\n\n");
}

function shortTitle(text, maxChars = 22) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "生图任务";
  return clean.length > maxChars ? `${clean.slice(0, maxChars)}...` : clean;
}

function cleanOneLine(text, maxChars = 140) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > maxChars ? `${clean.slice(0, maxChars)}...` : clean;
}

function cleanFilesystemPath(value, maximum = 32767) {
  const clean = typeof value === "string" ? value.trim() : "";
  if (!clean || clean.length > maximum || clean.includes("\u0000")) return "";
  return clean;
}

function cleanOpaqueLocator(value, maximum = 4000) {
  const clean = typeof value === "string" ? value.trim() : "";
  if (!clean || clean.length > maximum || clean.includes("\u0000")) return "";
  return clean;
}

function safeImageSourceRelativePath(value, maximum = 1000) {
  const source = typeof value === "string" ? value.trim().replace(/\\/g, "/") : "";
  if (!source || source.startsWith("/") || /^[a-z]:/i.test(source) || /[\u0000-\u001f\u007f]/.test(source)) return "";
  if (source.split("/").some((segment) => !segment || segment === "." || segment === "..")) return "";
  return source.slice(0, maximum);
}

function toolDisplayName(name = "") {
  const map = {
    [primaryImageToolName]: "Image Gen",
    experience: "Experience",
    context_manage: "Context Manage",
    memory: "Memory",
    workflow: "Canvas",
    view_image: "View Image",
    ask_user: "Ask User",
    web_search: "Web Search",
    shell_command: "Command",
    command: "Command"
  };
  return map[name] || name || "工具";
}

function toolSchemaName(tool = {}) {
  const functionName = String(tool?.function?.name || tool?.name || "").trim();
  if (functionName) return functionName;
  return String(tool?.type || "").trim() === "web_search" ? "web_search" : "";
}

function toolBriefFromArgs(name, args = {}) {
  const brief = cleanOneLine(args.brief || args.BRIEF || args.reason || "");
  if (brief) return brief;
  if (isImageToolName(name)) {
    if (args.operation === "compose") return "整理生图提示词和参数。";
    if (args.operation === "layer_merge") {
      const count = Array.isArray(args.layers) ? args.layers.length : 0;
      return count ? `合成 ${count} 个图层。` : "合成图层。";
    }
    const count = Number(args.count || 1);
    return `生成 ${Number.isFinite(count) && count > 1 ? `${count} 张` : "1 张"}独立图片。`;
  }
  if (name === "workflow") return workbenchBrief(args);
  if (name === "memory") return `Memory ${args.operation || "check"}。`;
  if (name === "experience") return "管理绘画经验。";
  if (name === "context_manage") return "整理外置上下文。";
  if (name === "ask_user") return "向用户请求必要信息。";
  if (name === "web_search") return "执行原生联网搜索。";
  return `执行 ${toolDisplayName(name)}。`;
}

function workbenchOperationLabel(operation = "") {
  const map = {
    generate: "绘图",
    compose: "整理提示词",
    edit: "图像编辑",
    redraw: "区域重绘",
    cutout: "AI 抠图",
    layer_merge: "图层合成",
    list_nodes: "成果列表",
    describe_node: "成果详情",
    focus_node: "定位成果",
    connect_nodes: "关联成果",
    disconnect_node: "移除关系",
    delete_node: "删除成果",
    clear_canvas: "清理画布",
    update_node: "更新成果",
    continue_node: "继续生图",
    redraw_node: "基于节点重绘",
    cutout_node: "基于节点抠图"
  };
  return map[operation] || operation || "画布操作";
}

function workbenchBrief(args = {}) {
  const operation = String(args.operation || "list_nodes");
  if (operation === "clear_canvas") return "清理当前画布。";
  if (operation === "connect_nodes") return `关联 ${args.sourceId || "source"} -> ${args.targetId || "target"}（${args.relationType || "derived-from"}）。`;
  if (operation === "delete_node") return `删除成果 ${args.nodeId || args.id || "未指定"}。`;
  if (operation === "continue_node") return `基于成果 ${args.nodeId || args.id || "未指定"} 继续生图。`;
  if (operation === "redraw_node") return `基于成果 ${args.nodeId || args.id || "未指定"} 打开重绘。`;
  if (operation === "cutout_node") return `基于成果 ${args.nodeId || args.id || "未指定"} 打开抠图。`;
  if (operation === "describe_node" || operation === "focus_node") return `${workbenchOperationLabel(operation)} ${args.nodeId || args.id || "未指定"}。`;
  return workbenchOperationLabel(operation);
}

function toolOperationFromArgs(name, args = {}) {
  if (name === "workflow") return workbenchOperationLabel(String(args.operation || "list_nodes"));
  if (isImageToolName(name)) {
    const mode = String(args.operation || args.mode || "generate");
    return workbenchOperationLabel(mode) || mode;
  }
  if (name === "memory") {
    const map = { add: "写入记忆", check: "检索记忆", read: "读取记忆" };
    return map[String(args.operation || "check")] || "记忆";
  }
  if (name === "experience") {
    const map = { add: "写入绘画经验", read: "读取绘画经验", replace: "更新绘画经验", compact: "整理绘画经验" };
    return map[String(args.action || "read")] || "绘画经验";
  }
  return toolDisplayName(name);
}

function toolParamsFromArgs(name, args = {}) {
  const parts = [];
  if (args.nodeId || args.id) parts.push(`node=${args.nodeId || args.id}`);
  if (args.sourceId || args.targetId) parts.push(`${args.sourceId || "source"} -> ${args.targetId || "target"}`);
  if (args.parentId) parts.push(`parent=${args.parentId}`);
  if (args.mode) parts.push(`mode=${args.mode}`);
  if (args.operation) parts.push(`operation=${args.operation}`);
  if (args.count) parts.push(`count=${args.count}`);
  if (args.generationMode) parts.push(`generationMode=${args.generationMode}`);
  if (args.ratio) parts.push(`ratio=${args.ratio}`);
  if (args.resolution) parts.push(`resolution=${args.resolution}`);
  if (args.model) parts.push(`model=${cleanOneLine(args.model, 36)}`);
  if (args.prompt) parts.push(`prompt=${cleanOneLine(args.prompt, 44)}`);
  if (args.assetIndex !== undefined) parts.push(`assetIndex=${args.assetIndex}`);
  if (args.operation === "layer_merge" && Array.isArray(args.layers)) parts.push(`layers=${args.layers.length}`);
  return cleanOneLine(parts.join(" · ") || "参数已记录", 150);
}

function nodeAssetSummary(node = {}) {
  return (node.assets || [])
    .slice(0, 9)
    .map((asset, index) => {
      const label = asset.path || asset.url || asset.assetUrl || "";
      return `${asset.displayCode || asset.index || index + 1}:${cleanOneLine(label, 180)}`;
    })
    .join(" | ");
}

function workflowNodeSummary(node = {}, options = {}) {
  const params = node.imageParams || {};
  const layerRecovery = node.layerGroup?.recovery;
  const selectedNodeId = String(options.selectedNodeId || "").trim();
  const selectedNodeIds = new Set((Array.isArray(options.selectedNodeIds) ? options.selectedNodeIds : [selectedNodeId]).map(String).filter(Boolean));
  const isSelected = selectedNodeIds.has(String(node.id || ""));
  return [
    `${node.displayCode || node.id} ${node.title || "未命名"} ${node.type || "node"} ${node.status || "review"}`,
    node.displayCode && node.displayCode !== node.id ? `nodeId=${node.id}` : "",
    isSelected ? "selected=current" : "",
    `parent=${node.parentId || "-"}`,
    node.parentId ? `relation=${node.relationType || "derived-from"}` : "",
    `state=${node.imageState || "-"}`,
    node.imageContainerRole ? `containerRole=${node.imageContainerRole}` : "",
    node.requirement?.text ? `requirement=${cleanOneLine(node.requirement.text, 180)}` : "",
    node.requirement?.revision ? `requirementRevision=${node.requirement.revision}` : "",
    `outputs=${node.outputs ?? 0}`,
    params.prompt ? `prompt=${cleanOneLine(params.prompt, 120)}` : node.prompt ? `prompt=${cleanOneLine(node.prompt, 120)}` : "",
    params.size ? `size=${params.size}` : "",
    params.ratio ? `ratio=${params.ratio}` : "",
    params.count ? `count=${params.count}` : "",
    node.layerGroup ? `layerGroup=${node.layerGroup.id}:${node.layerGroup.layerId}:${node.layerGroup.order}/${node.layerGroup.total}` : "",
    layerRecovery ? `layerRecovery=${layerRecovery.status}:${layerRecovery.stage}:failed=${(layerRecovery.failedLayerIds || []).join(",") || "none"}:successful=${(layerRecovery.successfulLayerIds || []).join(",") || "none"}` : "",
    node.assets?.length ? `assets=${nodeAssetSummary(node)}` : ""
  ].filter(Boolean).join(" · ");
}

function findWorkflowNode(nodes = [], id = "") {
  const clean = String(id || "").trim().toLowerCase();
  if (!clean) return null;
  return nodes.find((node) => String(node.id || "").toLowerCase() === clean) || null;
}

function requirementSourceForNode(nodes = [], node = null) {
  if (!node || node.type !== "requirement" || !node.parentId) return null;
  const source = findWorkflowNode(nodes, node.parentId);
  return source?.type === "image" ? source : null;
}

function canvasArtifacts(payload = {}) {
  const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
  return nodes.filter((node) => node?.type !== "agent");
}

function recentCanvasArtifacts(payload = {}) {
  return [...canvasArtifacts(payload)].reverse();
}

function selectedCanvasArtifactIds(payload = {}) {
  return [...new Set([
    ...(Array.isArray(payload.selectedNodeIds) ? payload.selectedNodeIds : []),
    payload.selectedNodeId
  ].map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function workbenchSnapshotForPrompt(payload = {}, options = {}) {
  const nodes = canvasArtifacts(payload);
  const selectedIds = selectedCanvasArtifactIds(payload);
  const selectedSet = new Set(selectedIds);
  const nodeById = new Map(nodes.map((node) => [String(node.id || "").toLowerCase(), node]));
  const selectedNodes = selectedIds.map((id) => nodeById.get(id.toLowerCase())).filter(Boolean);
  const typeCounts = new Map();
  const relationCounts = new Map();
  for (const node of nodes) {
    const type = String(node.type || "unknown");
    typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
    const relation = node.parentId ? String(node.relationType || "derived-from") : "root";
    relationCounts.set(relation, (relationCounts.get(relation) || 0) + 1);
  }
  const maxChars = Math.max(2000, Number(options.maxChars || mainWorkbenchSnapshotMaxChars));
  const recentLimit = Math.max(1, Math.min(100, Number(options.recentLimit || mainWorkbenchRecentArtifacts)));
  const header = [
    `snapshotBudgetChars=${maxChars}`,
    "selectedExempt=true",
    `total=${nodes.length}`,
    `selected=${selectedNodes.length}`,
    `types=${[...typeCounts.entries()].map(([name, count]) => `${name}:${count}`).join(",") || "none"}`,
    `relations=${[...relationCounts.entries()].map(([name, count]) => `${name}:${count}`).join(",") || "none"}`
  ].join(" · ");
  const selectedBlock = [
    "Selected Artifacts (always included):",
    selectedNodes.length
      ? selectedNodes.map((node) => workflowNodeSummary(node, { selectedNodeIds: selectedIds })).join("\n")
      : "暂无选中成果。"
  ].join("\n");
  const fixed = `${header}\n${selectedBlock}\nRecent Artifacts (bounded):`;
  const recentLines = [];
  let usedChars = fixed.length;
  for (const node of recentCanvasArtifacts(payload).filter((item) => !selectedSet.has(String(item.id || ""))).slice(0, recentLimit)) {
    const line = workflowNodeSummary(node, { selectedNodeIds: selectedIds });
    if (usedChars + line.length + 1 > maxChars) break;
    recentLines.push(line);
    usedChars += line.length + 1;
  }
  return {
    text: `${fixed}\n${recentLines.join("\n") || "暂无其他最近成果。"}`,
    total: nodes.length,
    selectedCount: selectedNodes.length,
    recentCount: recentLines.length,
    budgetChars: maxChars
  };
}

function normalizeWorkflowTitle(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function stableTaskScopeIdentityHash(value = "") {
  const hashes = [2166136261, 2246822507, 3266489909, 668265263];
  const input = String(value || "");
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    hashes[0] = Math.imul(hashes[0] ^ code, 16777619);
    hashes[1] = Math.imul(hashes[1] ^ (code + index), 2246822519);
    hashes[2] = Math.imul(hashes[2] ^ (code + hashes[0]), 3266489917);
    hashes[3] = Math.imul(hashes[3] ^ (code + hashes[1]), 668265263);
  }
  return hashes.map((hash) => (hash >>> 0).toString(16).padStart(8, "0")).join("");
}

function taskScopeSnapshotHash(scope = {}) {
  const materialAsset = (item = {}) => ({
    bindingId: item.bindingId || "",
    assetId: item.assetId || "",
    occurrenceId: item.occurrenceId || "",
    contentHash: item.contentHash || "",
    role: item.role || "",
    nodeId: item.nodeId || "",
    containerId: item.containerId || "",
    assetIndex: Number.isInteger(item.assetIndex) ? item.assetIndex : null,
    containerSlot: Number.isInteger(item.containerSlot) ? item.containerSlot : null,
    ownerNodeId: item.ownerNodeId || "",
    ownerAssetIndex: Number.isInteger(item.ownerAssetIndex) ? item.ownerAssetIndex : null,
    relativePath: String(item.relativePath || "").replace(/\\/g, "/"),
    sourceRelativePath: String(item.sourceRelativePath || "").replace(/\\/g, "/"),
    referenceRole: item.referenceRole || "",
    purpose: item.purpose || ""
  });
  const material = {
    version: 2,
    origin: scope.origin,
    scopeType: scope.scopeType,
    canvasRevision: Math.max(0, Math.floor(Number(scope.canvasRevision) || 0)),
    sourceNodeIds: [...(scope.sourceNodeIds || [])],
    sourceContainerIds: [...(scope.sourceContainerIds || [])],
    referenceContainerIds: [...(scope.referenceContainerIds || [])],
    sourceBindingIds: [...(scope.sourceBindingIds || [])],
    referenceBindingIds: [...(scope.referenceBindingIds || [])],
    sourceAssets: (scope.sourceAssets || []).map(materialAsset),
    referenceAssets: (scope.referenceAssets || []).map(materialAsset),
    resultPolicy: scope.resultPolicy,
    confirmationPolicy: scope.confirmationPolicy,
    requirement: scope.requirement
      ? {
          nodeId: scope.requirement.nodeId,
          revision: Math.max(1, Math.floor(Number(scope.requirement.revision) || 1)),
          sourceSignature: scope.requirement.sourceSignature || ""
        }
      : null
  };
  return `scope-${stableTaskScopeIdentityHash(`task-scope:v2:${JSON.stringify(material)}`)}`;
}

function normalizedTaskScope(payload = {}) {
  const raw = payload.taskScope && typeof payload.taskScope === "object" ? payload.taskScope : {};
  const normalizeItems = (items, role) => (Array.isArray(items) ? items : [])
    .filter((item) => item && typeof item === "object")
    .map((item, index) => ({
      bindingId: cleanOneLine(item.bindingId || "", 520),
      assetId: cleanOneLine(item.assetId || `${role}-${index + 1}`, 160),
      occurrenceId: /^occ-[a-f0-9]{16,64}$/i.test(String(item.occurrenceId || "").trim()) ? String(item.occurrenceId).trim().toLowerCase() : "",
      importBatchId: cleanOneLine(item.importBatchId || "", 160),
      importRootId: cleanOneLine(item.importRootId || "", 80),
      sourceRelativePath: safeImageSourceRelativePath(item.sourceRelativePath),
      sourceRootLabel: cleanOneLine(item.sourceRootLabel || "", 260),
      sourceRootKind: item.sourceRootKind === "directory" ? "directory" : item.sourceRootKind === "file" ? "file" : "",
      displayCode: cleanOneLine(item.displayCode || `${role === "source" ? "SRC" : "REF"}${index + 1}`, 40),
      contentHash: /^[a-f0-9]{32,128}$/i.test(String(item.contentHash || "").trim()) ? String(item.contentHash).trim().toLowerCase() : "",
      role,
      name: cleanOneLine(item.name || `${role === "source" ? "原图" : "参考图"} ${index + 1}`, 220),
      assetIndex: Number.isInteger(Number(item.assetIndex)) && Number(item.assetIndex) >= 0
        ? Math.floor(Number(item.assetIndex))
        : Number.isInteger(Number(item.containerSlot)) && Number(item.containerSlot) >= 0
          ? Math.floor(Number(item.containerSlot))
          : undefined,
      containerSlot: Number.isInteger(Number(item.containerSlot)) && Number(item.containerSlot) >= 0
        ? Math.floor(Number(item.containerSlot))
        : Number.isInteger(Number(item.assetIndex)) && Number(item.assetIndex) >= 0
          ? Math.floor(Number(item.assetIndex))
        : undefined,
      ownerAssetIndex: Number.isInteger(Number(item.ownerAssetIndex)) && Number(item.ownerAssetIndex) >= 0
        ? Math.floor(Number(item.ownerAssetIndex))
        : undefined,
      ownerNodeId: cleanOneLine(item.ownerNodeId || "", 160),
      nodeId: cleanOneLine(item.nodeId || "", 160),
      containerId: cleanOneLine(item.containerId || "", 160),
      path: cleanFilesystemPath(item.path),
      relativePath: cleanFilesystemPath(item.relativePath).replace(/\\/g, "/"),
      assetUrl: cleanOpaqueLocator(item.assetUrl),
      mimeType: cleanOneLine(item.mimeType || "", 100),
      purpose: cleanOneLine(item.purpose || "", 400),
      referenceRole: role === "reference"
        ? cleanOneLine(item.referenceRole || (!["source", "reference"].includes(String(item.role || "").toLowerCase()) ? item.role : ""), 80)
        : ""
    }))
    .slice(0, role === "source" ? 200 : 40);
  const sourceNodeIds = [...new Set((Array.isArray(raw.sourceNodeIds) ? raw.sourceNodeIds : selectedCanvasArtifactIds(payload)).map((value) => cleanOneLine(value, 160)).filter(Boolean))];
  const sourceAssets = normalizeItems(raw.sourceAssets, "source");
  const referenceAssets = normalizeItems(Array.isArray(raw.referenceAssets) ? raw.referenceAssets : payload.referenceImages, "reference");
  const sourceAssetCount = Math.max(sourceAssets.length, Math.floor(Number(raw.sourceAssetCount ?? sourceAssets.length) || sourceAssets.length));
  const referenceAssetCount = Math.max(referenceAssets.length, Math.floor(Number(raw.referenceAssetCount ?? referenceAssets.length) || referenceAssets.length));
  const cleanIds = (items, maximum) => [...new Set((Array.isArray(items) ? items : [])
    .map((value) => cleanOneLine(value, 520))
    .filter(Boolean))].slice(0, maximum);
  const origins = new Set(["chat", "canvas", "node", "container", "layer", "requirement"]);
  const scopeTypes = new Set(["none", "single", "multi-source", "container", "container-group", "layer", "layer-group", "mixed"]);
  const resultPolicies = new Set(["single", "grouped-by-source", "grouped-by-container", "layer-variants"]);
  const confirmationPolicies = new Set(["auto", "preview-3", "staged", "direct"]);
  const origin = origins.has(raw.origin) ? raw.origin : "chat";
  const sourceContainerIds = cleanIds(raw.sourceContainerIds, 200);
  const referenceContainerIds = cleanIds(raw.referenceContainerIds, 40);
  const sourceBindingIds = cleanIds(
    Array.isArray(raw.sourceBindingIds) && raw.sourceBindingIds.length
      ? raw.sourceBindingIds
      : sourceAssets.map((item) => item.bindingId),
    200
  );
  const referenceBindingIds = cleanIds(
    Array.isArray(raw.referenceBindingIds) && raw.referenceBindingIds.length
      ? raw.referenceBindingIds
      : referenceAssets.map((item) => item.bindingId),
    40
  );
  const derivedScopeType = sourceAssets.length > 1 || sourceNodeIds.length > 1
    ? "multi-source"
    : sourceAssets.length === 1
      ? "single"
      : "none";
  const scopeType = scopeTypes.has(raw.scopeType) ? raw.scopeType : derivedScopeType;
  const resultPolicy = resultPolicies.has(raw.resultPolicy)
    ? raw.resultPolicy
    : scopeType === "layer" || scopeType === "layer-group"
      ? "layer-variants"
      : scopeType === "container-group"
        ? "grouped-by-container"
        : sourceAssets.length > 1 || sourceNodeIds.length > 1
          ? "grouped-by-source"
          : "single";
  const confirmationPolicy = confirmationPolicies.has(raw.confirmationPolicy) ? raw.confirmationPolicy : "auto";
  const requirementNodeId = cleanOneLine(raw.requirement?.nodeId || "", 160);
  const requirementRevisionValue = Number(raw.requirement?.revision);
  const requirement = requirementNodeId && Number.isInteger(requirementRevisionValue) && requirementRevisionValue >= 1
    ? {
        nodeId: requirementNodeId,
        revision: Math.floor(requirementRevisionValue),
        sourceSignature: cleanOneLine(raw.requirement?.sourceSignature || "", 240)
      }
    : undefined;
  const scope = {
    version: 2,
    origin,
    scopeType,
    canvasRevision: Math.max(0, Math.floor(Number(raw.canvasRevision) || 0)),
    sourceNodeIds,
    sourceContainerIds,
    referenceContainerIds,
    sourceBindingIds,
    referenceBindingIds,
    sourceAssets,
    referenceAssets,
    resultPolicy,
    confirmationPolicy,
    requirement,
    sourceAssetCount,
    referenceAssetCount,
    truncated: raw.truncated === true || sourceAssetCount > sourceAssets.length || referenceAssetCount > referenceAssets.length
  };
  return { ...scope, snapshotHash: taskScopeSnapshotHash(scope) };
}

function imageTaskProvenance(taskScope, sourceAsset = null) {
  if (!taskScope || typeof taskScope !== "object") return undefined;
  const snapshotHash = cleanOneLine(taskScope.snapshotHash || "", 96);
  if (!/^scope-[a-f0-9]{32}$/i.test(snapshotHash)) return undefined;
  const source = sourceAsset && typeof sourceAsset === "object" ? sourceAsset : {};
  const result = {
    version: 1,
    taskScopeSnapshotHash: snapshotHash,
    resultPolicy: taskScope.resultPolicy,
    sourceBindingId: cleanOneLine(source.bindingId || "", 520) || undefined,
    sourceAssetId: cleanOneLine(source.assetId || "", 160) || undefined,
    sourceOccurrenceId: cleanOneLine(source.occurrenceId || "", 80) || undefined,
    sourceNodeId: cleanOneLine(source.nodeId || "", 160) || undefined,
    sourceContainerId: cleanOneLine(source.containerId || "", 160) || undefined,
    sourceDisplayCode: cleanOneLine(source.displayCode || "", 40) || undefined,
    requirementNodeId: cleanOneLine(taskScope.requirement?.nodeId || "", 160) || undefined,
    requirementRevision: Number.isInteger(Number(taskScope.requirement?.revision))
      ? Math.max(1, Math.floor(Number(taskScope.requirement.revision)))
      : undefined
  };
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined));
}

function taskAssetIdentityKey(item, index = 0) {
  const bindingId = cleanOneLine(item?.bindingId || "", 520);
  if (bindingId) return `binding-id:${bindingId}`;
  const occurrenceId = cleanOneLine(item?.occurrenceId || "", 80).toLowerCase();
  if (occurrenceId) return `occurrence:${occurrenceId}`;
  const containerSlot = Number.isInteger(Number(item?.containerSlot)) && Number(item.containerSlot) >= 0
    ? Number(item.containerSlot)
    : Number(item?.assetIndex);
  if (item?.nodeId && Number.isInteger(containerSlot) && containerSlot >= 0) {
    return `binding:${item.role || "asset"}:${item.nodeId}:${containerSlot}`;
  }
  const contentHash = String(item?.contentHash || "").trim().toLowerCase();
  if (/^[a-f0-9]{32,128}$/.test(contentHash)) return `content:${contentHash}`;
  const relativePath = String(item?.relativePath || "").trim().replace(/\\/g, "/").toLowerCase();
  if (relativePath) return `relative:${relativePath}`;
  const localPath = String(item?.path || "").trim();
  if (localPath) {
    try {
      return `path:${path.resolve(localPath).replace(/\\/g, "/").toLowerCase()}`;
    } catch {
      return `path:${localPath.replace(/\\/g, "/").toLowerCase()}`;
    }
  }
  const assetId = cleanOneLine(item?.assetId || "", 160);
  if (assetId) return `id:${assetId}`;
  const assetUrl = String(item?.assetUrl || "").trim();
  return assetUrl ? `url:${assetUrl}` : `slot:${item?.nodeId || item?.containerId || "asset"}:${item?.assetIndex ?? index}`;
}

function uniqueTaskAssets(items = []) {
  const seen = new Set();
  return items.filter((item, index) => {
    const key = taskAssetIdentityKey(item, index);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function validateImageOperationSourcePolicy(toolName, operation, sourceCount, resultPolicy = "single") {
  const normalizedOperation = String(operation || "generate").trim().toLowerCase();
  const count = Math.max(0, Math.floor(Number(sourceCount) || 0));
  const multiSourceResultTask = count > 1 && (resultPolicy === "grouped-by-source" || resultPolicy === "grouped-by-container");
  if (count > 0 && normalizedOperation === "generate") {
    throw new Error(`${toolName} 当前任务包含 SOURCE，generate 不会读取原图；请改用 edit、replace、variants、layers、cutout 或 redraw${multiSourceResultTask ? "，并逐项填写 sourceBindingId" : ""}。`);
  }
  return { operation: normalizedOperation, sourceCount: count, multiSourceResultTask };
}

function taskScopeForPrompt(payload = {}, maxChars = 9000) {
  const scope = normalizedTaskScope(payload);
  const lines = [
    `origin=${scope.origin}`,
    `scopeType=${scope.scopeType}`,
    `canvasRevision=${scope.canvasRevision}`,
    `resultPolicy=${scope.resultPolicy}`,
    `confirmationPolicy=${scope.confirmationPolicy}`,
    `snapshotHash=${scope.snapshotHash}`,
    `sourceNodes=${scope.sourceNodeIds.join(", ") || "none"}`,
    `sourceContainers=${scope.sourceContainerIds.join(", ") || "none"}`,
    `referenceContainers=${scope.referenceContainerIds.join(", ") || "none"}`,
    ...(scope.requirement
      ? [`requirement=${scope.requirement.nodeId}@${scope.requirement.revision}${scope.requirement.sourceSignature ? ` sourceSignature=${scope.requirement.sourceSignature}` : ""}`]
      : []),
    `sourceAssets=${scope.sourceAssetCount}${scope.sourceAssetCount > scope.sourceAssets.length ? `（当前列出 ${scope.sourceAssets.length}）` : ""}`,
    `referenceAssets=${scope.referenceAssetCount}${scope.referenceAssetCount > scope.referenceAssets.length ? `（当前列出 ${scope.referenceAssets.length}）` : ""}`,
    "SOURCE（需要处理）:"
  ];
  for (const item of scope.sourceAssets) {
    lines.push(`- ${item.displayCode} | bindingId=${item.bindingId || "-"} | assetId=${item.assetId} | ${item.name} | node=${item.nodeId || "-"}${item.containerSlot === undefined ? "" : ` | containerSlot=${item.containerSlot}`}${item.ownerNodeId ? ` | owner=${item.ownerNodeId}:${item.ownerAssetIndex ?? 0}` : ""}${item.sourceRelativePath ? ` | source=${item.sourceRelativePath}` : ""} | ${item.path || item.assetUrl || "no-path"}`);
    if (lines.join("\n").length >= maxChars * 0.62) break;
  }
  lines.push("REFERENCE（仅作参考，不决定输出数量）:");
  for (const item of scope.referenceAssets) {
    lines.push(`- ${item.displayCode} | bindingId=${item.bindingId || "-"} | assetId=${item.assetId} | ${item.name}${item.sourceRelativePath ? ` | source=${item.sourceRelativePath}` : ""} | ${item.path || item.assetUrl || "no-path"}${item.referenceRole ? ` | role=${item.referenceRole}` : ""}${item.purpose ? ` | purpose=${item.purpose}` : ""}`);
    if (lines.join("\n").length >= maxChars) break;
  }
  return { scope, text: lines.join("\n").slice(0, maxChars) };
}

function normalizedAskUserOptions(value) {
  if (!Array.isArray(value)) return [];
  const usedIds = new Set();
  let recommendedClaimed = false;
  const options = value.slice(0, 3).flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const label = cleanOneLine(item.label || "", 80);
    if (!label) return [];
    const fallbackId = `option-${index + 1}`;
    let id = cleanOneLine(item.id || fallbackId, 80).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || fallbackId;
    let suffix = 2;
    const baseId = id;
    while (usedIds.has(id)) id = `${baseId}-${suffix++}`.slice(0, 80);
    usedIds.add(id);
    const recommended = item.recommended === true && !recommendedClaimed;
    if (recommended) recommendedClaimed = true;
    return [{
      id,
      label,
      description: String(item.description || "").trim().slice(0, 260),
      answer: String(item.answer || label).trim().slice(0, 4000) || label,
      recommended
    }];
  });
  return options.length >= 2 ? options : [];
}

function taskScopeSourceAt(scope, parentId, assetIndex, toolName) {
  const index = Number(assetIndex);
  if (!Number.isInteger(index) || index < 0) throw new Error(`${toolName} assetIndex 必须是有效的零基整数。`);
  if (!parentId) throw new Error(`${toolName} 使用 assetIndex 时需要明确 parentId。`);
  const source = scope.sourceAssets.find((item) => item.nodeId === parentId && Number(item.containerSlot ?? item.assetIndex) === index) || null;
  if (!source) throw new Error(`${toolName} parentId=${parentId} 中不存在 assetIndex=${index} 的 SOURCE。`);
  return source;
}

function taskSourceIndexInNode(source, node) {
  if (!source || !node || !Array.isArray(node.assets)) return -1;
  const requestedSlot = Number.isInteger(Number(source.containerSlot)) && Number(source.containerSlot) >= 0
    ? Number(source.containerSlot)
    : Number(source.assetIndex);
  if (Number.isInteger(requestedSlot) && requestedSlot >= 0) {
    const index = requestedSlot;
    return index < node.assets.length ? index : -1;
  }
  const occurrenceId = cleanOneLine(source.occurrenceId || "", 80).toLowerCase();
  const contentHash = String(source.contentHash || "").trim().toLowerCase();
  const relativePath = String(source.relativePath || "").replace(/\\/g, "/").toLowerCase();
  const assetId = cleanOneLine(source.assetId || "", 160);
  const sourcePath = String(source.path || "").replace(/\\/g, "/").toLowerCase();
  return node.assets.findIndex((asset) =>
    (occurrenceId && cleanOneLine(asset?.occurrenceId || "", 80).toLowerCase() === occurrenceId) ||
    (contentHash && String(asset?.contentHash || "").trim().toLowerCase() === contentHash) ||
    (relativePath && String(asset?.relativePath || "").replace(/\\/g, "/").toLowerCase() === relativePath) ||
    (assetId && cleanOneLine(asset?.assetId || "", 160) === assetId) ||
    (sourcePath && String(asset?.path || "").replace(/\\/g, "/").toLowerCase() === sourcePath)
  );
}

function findWorkflowNodeByTitle(nodes = [], title = "") {
  const clean = normalizeWorkflowTitle(title);
  if (!clean) return null;
  const normalized = (node) => normalizeWorkflowTitle(node?.title || "");
  return (
    nodes.find((node) => normalized(node) === clean) ||
    nodes.find((node) => {
      const nodeTitle = normalized(node);
      return nodeTitle && (nodeTitle.includes(clean) || clean.includes(nodeTitle));
    }) ||
    null
  );
}

function resolveWorkflowNodeReference(nodes = [], options = {}) {
  const byId = findWorkflowNode(nodes, options.id);
  if (byId) return byId;
  return findWorkflowNodeByTitle(nodes, options.title);
}

function splitCommandLine(command = "") {
  const parts = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match = null;
  while ((match = pattern.exec(String(command || "")))) {
    parts.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return parts;
}

function resolveCommandCwd(root, cwd) {
  const base = path.resolve(root || process.cwd());
  const requested = cwd ? path.resolve(base, String(cwd)) : base;
  const baseLower = base.toLowerCase();
  const requestedLower = requested.toLowerCase();
  if (requestedLower !== baseLower && !requestedLower.startsWith(`${baseLower}${path.sep}`)) {
    return { ok: false, error: "cwd 必须位于当前 IIimage 项目目录内。", cwd: base };
  }
  if (!existsSync(requested)) return { ok: false, error: "cwd 不存在。", cwd: requested };
  return { ok: true, cwd: requested };
}

const commandAllowedList =
  "Get-Location, node --version, npm --version, pnpm --version, git status --short --branch, git branch --show-current, rg --version, rg --files [path], rg -n <pattern> <path>, Get-Content <path> -TotalCount <n>";

function isInsidePath(root, target) {
  const base = path.resolve(root || process.cwd());
  const resolved = path.resolve(target);
  const baseLower = base.toLowerCase();
  const resolvedLower = resolved.toLowerCase();
  return resolvedLower === baseLower || resolvedLower.startsWith(`${baseLower}${path.sep}`);
}

function resolveCommandPath(root, cwd, rawPath = ".") {
  const value = String(rawPath || ".").trim();
  if (!value || /[*?<>|"\n\r]/.test(value)) return { ok: false, error: "路径为空或包含不受控字符。" };
  const resolved = path.resolve(cwd, value);
  if (!isInsidePath(root, resolved)) return { ok: false, error: "路径必须位于当前 IIimage 项目目录内。" };
  if (!existsSync(resolved)) return { ok: false, error: "路径不存在。" };
  return {
    ok: true,
    absolutePath: resolved,
    relativePath: path.relative(cwd, resolved) || "."
  };
}

function controlledCommandPlan(command = "", cwd = process.cwd(), root = cwd) {
  const clean = String(command || "").replace(/\s+/g, " ").trim();
  if (!clean) return { ok: false, error: "缺少 command。" };
  if (/[;&|><`\n\r]/.test(clean) || /\$\(|\${/.test(clean)) {
    return { ok: false, error: "命令包含 shell 操作符或动态展开，已拒绝。" };
  }
  if (/\b(Remove-Item|rm|del|erase|rmdir|rd|Move-Item|mv|copy|cp|Set-Content|Add-Content|Out-File|New-Item|Invoke-WebRequest|curl|wget|Start-Process|Stop-Process|kill|shutdown|format|reg)\b/i.test(clean)) {
    return { ok: false, error: "当前 command 工具只允许只读诊断命令。" };
  }

  const parts = splitCommandLine(clean);
  const executable = String(parts[0] || "").toLowerCase();
  const args = parts.slice(1);
  const argText = args.join(" ").toLowerCase();

  if (["get-location", "pwd"].includes(executable) && args.length === 0) {
    return { ok: true, clean, kind: "cwd" };
  }
  if (executable === "node" && args.length === 1 && ["-v", "--version"].includes(argText)) {
    return { ok: true, clean, kind: "spawn", command: "node", args };
  }
  if (executable === "npm" && args.length === 1 && ["-v", "--version"].includes(argText)) {
    return { ok: true, clean, kind: "spawn", command: process.platform === "win32" ? "npm.cmd" : "npm", args };
  }
  if (executable === "pnpm" && args.length === 1 && ["-v", "--version"].includes(argText)) {
    return { ok: true, clean, kind: "spawn", command: process.platform === "win32" ? "pnpm.cmd" : "pnpm", args };
  }
  if (executable === "git" && (argText === "status --short --branch" || argText === "branch --show-current")) {
    return { ok: true, clean, kind: "spawn", command: "git", args };
  }
  if ((executable === "rg" || executable === "ripgrep") && argText === "--version") {
    return { ok: true, clean, kind: "spawn", command: executable, args };
  }
  if ((executable === "rg" || executable === "ripgrep") && args[0] === "--files" && args.length <= 2) {
    const target = args[1] || ".";
    const resolved = resolveCommandPath(root, cwd, target);
    if (!resolved.ok) return resolved;
    return { ok: true, clean, kind: "spawn", command: executable, args: ["--files", resolved.relativePath] };
  }
  if ((executable === "rg" || executable === "ripgrep") && args[0] === "-n" && args.length === 3) {
    const pattern = String(args[1] || "");
    if (!pattern || pattern.length > 160 || pattern.startsWith("-")) return { ok: false, error: "rg pattern 缺失或不受控。" };
    const resolved = resolveCommandPath(root, cwd, args[2]);
    if (!resolved.ok) return resolved;
    return { ok: true, clean, kind: "spawn", command: executable, args: ["-n", pattern, resolved.relativePath] };
  }
  if (executable === "get-content") {
    const totalCountIndex = args.findIndex((item) => item.toLowerCase() === "-totalcount");
    if (totalCountIndex < 0 || totalCountIndex >= args.length - 1) return { ok: false, error: "Get-Content 必须带 -TotalCount <n>。" };
    const count = Math.max(1, Math.min(Number(args[totalCountIndex + 1]) || 0, 240));
    if (!count) return { ok: false, error: "Get-Content -TotalCount 必须是 1-240 的数字。" };
    const pathArg = args.find((item, index) => index !== totalCountIndex && index !== totalCountIndex + 1 && !item.startsWith("-"));
    const resolved = resolveCommandPath(root, cwd, pathArg || "");
    if (!resolved.ok) return resolved;
    let stat = null;
    try {
      stat = statSync(resolved.absolutePath);
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
    if (!stat.isFile()) return { ok: false, error: "Get-Content 只允许读取文件。" };
    if (stat.size > 1024 * 1024) return { ok: false, error: "文件超过 1MB，请先用 rg 定位更小范围。" };
    return { ok: true, clean, kind: "read-file", path: resolved.absolutePath, count };
  }

  return {
    ok: false,
    error: `命令不在 allowlist 中。允许：${commandAllowedList}。`
  };
}

function clipCommandOutput(text, maxChars = 12000) {
  const value = String(text || "");
  return value.length > maxChars ? `${value.slice(0, maxChars)}\n... command output truncated ...` : value;
}

function spawnControlledCommand(plan, cwd, timeoutMs = 12000) {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const startedAt = Date.now();
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      resolve({ ...payload, durationMs: Date.now() - startedAt });
    };
    const child = spawn(plan.command, plan.args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        CI: "1",
        NO_COLOR: "1"
      }
    });
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // Process may already have exited.
      }
    }, Math.max(250, Math.min(Number(timeoutMs) || 12000, 12000)));
    child.stdout?.on("data", (chunk) => {
      stdout = clipCommandOutput(`${stdout}${chunk}`);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = clipCommandOutput(`${stderr}${chunk}`);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      finish({ ok: false, exitCode: null, signal: null, stdout, stderr, error: errorMessage(error), timedOut: false });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      finish({ ok: !timedOut && code === 0, exitCode: code, signal, stdout, stderr, timedOut });
    });
  });
}

async function executeControlledCommand(args = {}, root = "") {
  const command = String(args.command || "").replace(/\s+/g, " ").trim();
  const cwdResult = resolveCommandCwd(root, args.workdir ?? args.cwd);
  if (!cwdResult.ok) {
    const text = `COMMAND 已拒绝。\ncommand: ${command}\nreason: ${cwdResult.error}\nallowed: ${commandAllowedList}`;
    return { ok: false, summary: "Command rejected · cwd policy", text, error: cwdResult.error, errorCategory: "policy", retriable: false, advice: "把 cwd 限制在当前 IIimage 项目目录内，或省略 cwd。" };
  }
  const plan = controlledCommandPlan(args.command, cwdResult.cwd, root);
  if (!plan.ok) {
    const text = `COMMAND 已拒绝。\ncommand: ${command}\nreason: ${plan.error}\nallowed: ${commandAllowedList}`;
    return { ok: false, summary: "Command rejected · allowlist", text, error: plan.error, errorCategory: "policy", retriable: false, advice: "改用 allowlist 中的只读诊断命令。" };
  }
  if (plan.kind === "cwd") {
    const text = `COMMAND 执行完成。\ncommand: ${command}\ncwd: ${cwdResult.cwd}\nexitCode: 0\nstdout:\n${cwdResult.cwd}`;
    return { ok: true, summary: `Command executed · ${command}`, text };
  }
  if (plan.kind === "read-file") {
    const lines = readFileSync(plan.path, "utf8").split(/\r?\n/).slice(0, plan.count).join("\n");
    const text = `COMMAND 执行完成。\ncommand: ${command}\ncwd: ${cwdResult.cwd}\nexitCode: 0\nstdout:\n${lines}`;
    return { ok: true, summary: `Command executed · ${command}`, text };
  }
  const result = await spawnControlledCommand(plan, cwdResult.cwd, args.timeout_ms ?? args.timeoutMs);
  const stdout = String(result.stdout || "").trim();
  const stderr = String(result.stderr || "").trim();
  const text = [
    result.timedOut ? "COMMAND 执行超时。" : result.ok ? "COMMAND 执行完成。" : "COMMAND 执行失败。",
    `command: ${command}`,
    `cwd: ${cwdResult.cwd}`,
    `exitCode: ${result.exitCode ?? "null"}`,
    result.signal ? `signal: ${result.signal}` : "",
    `durationMs: ${result.durationMs}`,
    "stdout:",
    stdout || "(empty)",
    stderr ? "stderr:" : "",
    stderr
  ].filter((line) => line !== "").join("\n");
  return {
    ok: Boolean(result.ok),
    summary: result.ok ? `Command executed · ${command}` : `Command failed · ${command}`,
    text,
    error: result.ok ? undefined : (result.timedOut ? "command timed out" : result.error || stderr || `exit code ${result.exitCode}`),
    errorCategory: result.timedOut ? "timeout" : result.ok ? undefined : "command_failed",
    retriable: Boolean(result.timedOut),
    advice: result.ok ? undefined : "读取 stdout/stderr 后调整命令；不要使用写入、删除或 shell 组合命令。"
  };
}

function isExploreCommand(command) {
  return /^(rg|cat|type|ls|dir|find|grep|Get-Content|Get-ChildItem|Select-String)\b/i.test(String(command ?? "").trim());
}

function toolSummary(toolName, callInput, fullText, externalized) {
  if (["shell_command", "command"].includes(toolName) && isExploreCommand(callInput?.command)) {
    const command = String(callInput.command ?? "").replace(/\s+/g, " ").trim();
    const reason = String(callInput.reason ?? "").replace(/\s+/g, " ").trim();
    return `Explored · ${shortTitle(reason || command, 88)}`;
  }
  return externalized ? `${toolName} 输出 ${fullText.length} 字符，已外导到 toolmemory。` : `${toolName} 输出已记录。`;
}

function safeJson(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return JSON.stringify({ error: "json stringify failed" });
  }
}

function canonicalJsonValue(value) {
  if (Array.isArray(value)) return value.map((item) => canonicalJsonValue(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, canonicalJsonValue(value[key])])
  );
}

function normalizedToolCallSignature(name = "", rawArguments = {}) {
  const normalizedName = String(name || "unknown").trim().toLowerCase();
  const normalizedArguments = canonicalJsonValue(parseJsonObject(rawArguments));
  return `${normalizedName}:${textSha256(safeJson(normalizedArguments))}`;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

function classifyToolError(toolName, error) {
  if (error && typeof error === "object" && typeof error.errorCategory === "string" && error.errorCategory.trim()) {
    return error.errorCategory.trim();
  }
  const message = errorMessage(error);
  const value = `${toolName || ""}\n${message}`.toLowerCase();
  if (/余额不足|额度不足|insufficient|balance|quota|credit|deficit/.test(value)) return "quota";
  if (/unauthorized|forbidden|invalid api key|api[_ -]?key|认证|授权|登录|token|401|403/.test(value)) return "auth";
  if (/timeout|timed out|abort|超时|etimedout/.test(value)) return "timeout";
  if (/rate limit|too many requests|429|限流|频率/.test(value)) return "rate_limit";
  if (/(?:\b402\b.*openai_error|openai_error.*\b402\b)/.test(value)) return "upstream_402";
  if (/5\d\d|bad gateway|gateway|upstream|service unavailable|econnreset|und_err_socket|terminated|premature close|other side closed|socket|network|tls|连接|ECONN/i.test(message)) return "upstream_5xx";
  if (/需要|缺少|required|invalid|schema|参数|mask|source|reference|参考图|尺寸|size|ratio/.test(value)) {
    return /reference|参考图/.test(value) ? "missing_reference" : "invalid_input";
  }
  if (/policy|moderation|safety|安全|违规|拒绝/.test(value)) return "policy";
  return "unknown";
}

function isRetriableToolError(category) {
  return ["timeout", "rate_limit", "upstream_402", "upstream_5xx", "unknown", "invalid_tool_arguments"].includes(String(category || ""));
}

function toolErrorAdvice(category) {
  const map = {
    quota: "余额或额度问题，不要原样重试；请提示用户补充额度或换可用账号。",
    auth: "认证或密钥问题，不要原样重试；请提示用户登录或检查配置。",
    timeout: "超时问题，可以减少 count、降低分辨率或稍后重试一次。",
    rate_limit: "限流问题，可以等待、减少并发或降低 count 后重试。",
    upstream_402: "上游图片渠道返回泛化 402 错误，可以稍后重试；只有明确提示余额或配额不足时才停止。",
    upstream_5xx: "上游或网络问题，可以稍后重试，或降低请求复杂度。",
    invalid_tool_arguments: "这是模型工具参数的内部契约问题。请静默修正 schema 参数并重新调用，不要向用户复述校验错误。",
    invalid_input: "参数问题，应修正参数后重试，不要原样重复。",
    missing_reference: "缺少参考图或源图，应调用 ask_user 请求补充。",
    policy: "策略/安全拒绝，应改写 prompt 或向用户说明限制。",
    unknown: "未知错误，可尝试一次保守重试；若重复失败则说明原因。"
  };
  return map[category] || map.unknown;
}

function makeToolErrorEnvelope(toolName, callInput, error) {
  const message = cleanOneLine(errorMessage(error), 500);
  const category = classifyToolError(toolName, error);
  const retriable = isRetriableToolError(category);
  const resultText = [
    "TOOL ERROR",
    `ok: false`,
    `tool: ${toolName || "unknown"}`,
    `errorCategory: ${category}`,
    `retriable: ${retriable}`,
    `message: ${message}`,
    `advice: ${toolErrorAdvice(category)}`,
    "",
    "call_json:",
    safeJson(callInput)
  ].join("\n");
  return {
    errorMessage: message,
    errorCategory: category,
    retriable,
    resultText
  };
}

function sanitizeModelVisibleToolText(value) {
  return String(value ?? "")
    .replace(/\b(?:fmem|ent|pmt|mctx)-[a-z0-9_-]+\b/gi, "[内部引用已隐藏]")
    .replace(/\b(?:selectedEntryIds|sourceEntryIds|entry[_ ]?ids?|entryId|memoryRef|toolmemoryEntryId|selector|keywords)\b/gi, "internalReference");
}

function toolEnvelopeForModel(envelope = {}, fallbackTool = "", round = 0) {
  const ok = envelope.ok !== false;
  const visibleOutput = envelope.visibleOutput
    ? sanitizeModelVisibleToolText(summarizeTextPreservingAidebugMarkers(envelope.visibleOutput, ok ? 1800 : 2400))
    : "";
  const payload = {
    ok,
    tool: envelope.tool || fallbackTool || "unknown",
    summary: sanitizeModelVisibleToolText(envelope.summary),
    externalized: Boolean(envelope.externalized),
    round
  };
  if (!ok) {
    payload.error = sanitizeModelVisibleToolText(envelope.error);
    payload.errorCategory = envelope.errorCategory;
    payload.retriable = Boolean(envelope.retriable);
    payload.advice = sanitizeModelVisibleToolText(envelope.advice || toolErrorAdvice(envelope.errorCategory));
  }
  if (visibleOutput) payload.visibleOutput = visibleOutput;
  return payload;
}

function compactRuntimeMessagesForModel(messages, maxChars = 64000) {
  const latestAssistantIndex = messages.reduce(
    (latest, message, index) => message?.role === "assistant" ? index : latest,
    -1
  );
  const prepared = messages.map((message, index) => {
    if (message?.role !== "tool" || index > latestAssistantIndex || !Array.isArray(message.content)) return message;
    let imageRemoved = false;
    const content = message.content.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      if (String(item.type || "") === "input_image") {
        imageRemoved = true;
        return [];
      }
      return [item];
    });
    if (!imageRemoved) return message;
    return {
      ...message,
      content: [
        ...content,
        {
          type: "input_text",
          text: "Local image pixels were already consumed in an earlier model round. Call view_image again only when fresh visual inspection is needed."
        }
      ]
    };
  });
  const messageCost = (message) => JSON.stringify(message ?? {}, (key, value) =>
    key === "image_url" && typeof value === "string" && value.startsWith("data:image/")
      ? "[current input_image payload]"
      : value
  ).length;
  const totalChars = prepared.reduce((sum, message) => sum + messageCost(message), 0);
  if (totalChars <= maxChars) return prepared;
  let budget = maxChars;
  return prepared.map((message) => {
    const next = { ...message };
    const keep = Math.max(600, Math.min(2400, Math.floor(budget / Math.max(1, prepared.length))));
    if (typeof next.content === "string" && next.content.length > keep && (next.role === "tool" || next.role === "assistant")) {
      next.content = summarizeTextPreservingAidebugMarkers(next.content, keep);
    } else if (Array.isArray(next.content) && (next.role === "tool" || next.role === "assistant")) {
      next.content = next.content.map((item) => {
        if (!item || typeof item !== "object" || String(item.type || "") !== "input_text") return item;
        const text = String(item.text || "");
        return text.length > keep ? { ...item, text: summarizeTextPreservingAidebugMarkers(text, keep) } : item;
      });
    }
    budget -= messageCost(next);
    return next;
  });
}

function startToolPolling(progress, name, brief, runId, meta = {}) {
  if (typeof progress !== "function") return () => {};
  const startedAt = Date.now();
  const intervalMs = 15000;
  const timer = setInterval(() => {
    const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    const displayName = toolDisplayName(name);
    const summary = name === "image_gen"
      ? `Image Gen 正在绘图，已等待 ${seconds} 秒。`
      : `${displayName} 执行中，已等待 ${seconds} 秒。`;
    progress({
      phase: "tool-poll",
      tool: name,
      runId,
      toolRunId: meta.toolRunId,
      operationId: meta.operationId || meta.toolRunId,
      summary,
      detail: brief,
      brief,
      operation: meta.operation,
      params: meta.params,
      input: meta.input
    });
  }, intervalMs);
  return () => clearInterval(timer);
}

function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function providerSettings(settings = {}, provider = "agent") {
  if (provider === "image") {
    return {
      baseUrl: settings.imageBaseUrl ?? settings.agentBaseUrl ?? settings.baseUrl,
      apiKey: settings.imageApiKey ?? settings.agentApiKey ?? settings.apiKey,
      model: settings.imageModel ?? "gpt-image-2",
      modelPool: imageModelPoolFromSettings(settings)
    };
  }

  return {
    baseUrl: settings.agentBaseUrl ?? settings.baseUrl,
    apiKey: settings.agentApiKey ?? settings.apiKey,
    model: settings.agentModel ?? settings.model ?? "gpt-5.6-sol"
  };
}

function normalizeReferenceImage(value, fallbackName = "image.png") {
  if (!value) return null;
  if (typeof value === "string") {
    const imagePath = value.trim();
    if (!imagePath || !existsSync(imagePath)) return null;
    return {
      path: imagePath,
      mimeType: mimeTypeForPath(imagePath),
      name: path.basename(imagePath) || fallbackName
    };
  }
  if (typeof value !== "object") return null;
  const imagePath = String(value.path || value.imagePath || value.file || "").trim();
  if (!imagePath || !existsSync(imagePath)) return null;
  return {
    assetId: value.assetId ? cleanOneLine(value.assetId, 160) : undefined,
    occurrenceId: /^occ-[a-f0-9]{16,64}$/i.test(String(value.occurrenceId || "").trim()) ? String(value.occurrenceId).trim().toLowerCase() : undefined,
    importBatchId: value.importBatchId ? cleanOneLine(value.importBatchId, 160) : undefined,
    importRootId: value.importRootId ? cleanOneLine(value.importRootId, 80) : undefined,
    sourceRelativePath: safeImageSourceRelativePath(value.sourceRelativePath) || undefined,
    sourceRootLabel: value.sourceRootLabel ? cleanOneLine(value.sourceRootLabel, 260) : undefined,
    sourceRootKind: value.sourceRootKind === "directory" ? "directory" : value.sourceRootKind === "file" ? "file" : undefined,
    displayCode: value.displayCode ? cleanOneLine(value.displayCode, 40) : undefined,
    contentHash: /^[a-f0-9]{32,128}$/i.test(String(value.contentHash || "").trim()) ? String(value.contentHash).trim().toLowerCase() : undefined,
    path: imagePath,
    relativePath: cleanFilesystemPath(value.relativePath)?.replace(/\\/g, "/") || undefined,
    mimeType: String(value.mimeType || mimeTypeForPath(imagePath)),
    name: String(value.name || value.originalName || path.basename(imagePath) || fallbackName),
    assetUrl: value.assetUrl ? String(value.assetUrl) : undefined,
    role: value.role ? cleanOneLine(value.role, 80) : undefined,
    purpose: value.purpose ? cleanOneLine(value.purpose, 320) : undefined
  };
}

function normalizeReferenceImages(value, limit = 9) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list
    .map((item, index) => normalizeReferenceImage(item, `reference-${index + 1}.png`))
    .filter(Boolean)
    .slice(0, limit);
}

function referenceImageDescriptors(value) {
  return (Array.isArray(value) ? value : [])
    .map((image) => ({
      name: cleanOneLine(image?.name || "reference.png", 160),
      role: image?.role ? cleanOneLine(image.role, 80) : undefined,
      purpose: image?.purpose ? cleanOneLine(image.purpose, 320) : undefined
    }));
}

function referenceImageFromNode(node, assetIndex = 0) {
  if (!node || !Array.isArray(node.assets)) return null;
  const index = Math.max(0, Math.min(Number(assetIndex || 0), node.assets.length - 1));
  const asset = node.assets[index] || node.assets[0];
  if (!asset) return null;
  return normalizeReferenceImage(
    {
      path: asset.path,
      relativePath: asset.relativePath,
      mimeType: asset.mimeType,
      name: asset.name || asset.originalName || path.basename(String(asset.path || "")) || `${node.id || "source"}.png`,
      assetUrl: asset.assetUrl || asset.url,
      assetId: asset.assetId,
      occurrenceId: asset.occurrenceId,
      importBatchId: asset.importBatchId,
      importRootId: asset.importRootId,
      sourceRelativePath: asset.sourceRelativePath,
      sourceRootLabel: asset.sourceRootLabel,
      sourceRootKind: asset.sourceRootKind,
      displayCode: asset.displayCode,
      contentHash: asset.contentHash,
      role: asset.role,
      purpose: asset.purpose
    },
    `${node.id || "source"}.png`
  );
}

function writeDataUrlTemp(projectRoot, dataUrl, stem = "mask") {
  const match = String(dataUrl || "").match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
  if (!match) return null;
  const outputDir = path.join(projectRoot, "output", "imagegen", "_agent-temp");
  mkdirSync(outputDir, { recursive: true });
  const ext = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
  const filePath = path.join(outputDir, `${stem.replace(/[^a-z0-9_-]/gi, "-").slice(0, 80) || "mask"}.${ext}`);
  writeFileSync(filePath, Buffer.from(match[2], "base64"));
  return {
    path: filePath,
    mimeType: ext === "jpg" ? "image/jpeg" : `image/${ext}`,
    name: path.basename(filePath)
  };
}

function referenceImageFromNodeExact(node, assetIndex = 0) {
  const index = Number(assetIndex);
  if (!node || !Array.isArray(node.assets) || !Number.isInteger(index) || index < 0 || index >= node.assets.length) return null;
  return referenceImageFromNode(node, index);
}

function isGptImageModel(model) {
  return /^gpt-image-/i.test(String(model || "")) || /^chatgpt-image-latest$/i.test(String(model || ""));
}

function imageModelsWithPreferredFallback(models = [], preferred = "") {
  return [preferred, ...models, ...knownImageModelFallbacks]
    .map((model) => String(model || "").trim())
    .filter(Boolean)
    .filter((model, index, list) => list.findIndex((item) => item.toLowerCase() === model.toLowerCase()) === index);
}

function normalizeImageEnum(value, allowed) {
  const raw = String(value ?? "").trim().toLowerCase();
  return allowed.includes(raw) ? raw : undefined;
}

function normalizeImageOutputFormat(value) {
  return normalizeImageEnum(value, ["png", "jpeg", "webp"]);
}

function outputExtensionForFormat(format) {
  const normalized = normalizeImageOutputFormat(format);
  return normalized === "jpeg" ? "jpg" : normalized || "png";
}

function toolRunId(context, prefix = "tool") {
  const runId = String(context?.runId || "").trim();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${runId || "agent"}-${prefix}-${suffix}`.replace(/[^a-z0-9_-]/gi, "-");
}

function normalizeImageOutputCompression(value) {
  if (value === undefined || value === null || value === "") return undefined;
  return clampNumber(value, 0, 100, undefined);
}

function stripPastedBlockMarkers(prompt) {
  return String(prompt || "")
    .replace(/^\s*\[Pasted Block \d+:\s*\d+\s+lines?,\s*\d+\s+chars?\]\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeOptionalImageControls(args = {}) {
  const outputFormat = normalizeImageOutputFormat(args.outputFormat ?? args.output_format);
  const outputCompression = normalizeImageOutputCompression(args.outputCompression ?? args.output_compression);
  return {
    outputFormat,
    outputCompression: outputCompression === undefined || outputFormat === "png" ? undefined : outputCompression,
    background: normalizeImageEnum(args.background, ["auto", "transparent", "opaque"]),
    moderation: normalizeImageEnum(args.moderation, ["auto", "low"]),
    inputFidelity: normalizeImageEnum(args.inputFidelity ?? args.input_fidelity, ["low", "high"])
  };
}

function normalizeLayerHint(args = {}) {
  const layerId = String(args.layerId || args.layer_id || "").trim().slice(0, 80);
  const layerRole = String(args.layerRole || args.layer_role || "").trim().slice(0, 80);
  const layerGroupId = String(args.layerGroupId || args.layer_group_id || "").trim().slice(0, 80);
  const transparentPreferred = args.transparentPreferred === true || args.transparent_preferred === true;
  return {
    layerId: layerId || undefined,
    layerRole: layerRole || undefined,
    layerGroupId: layerGroupId || undefined,
    transparentPreferred
  };
}

function applyLayerPreferredImageControls(imageControls, layerHint) {
  if (!layerHint.transparentPreferred) return imageControls;
  return {
    ...imageControls,
    outputFormat: imageControls.outputFormat || "png",
    background: imageControls.background || "transparent"
  };
}

function imageModelForTaskPreference(args = {}, settings = {}, layerHint = {}) {
  const pool = imageModelPoolFromSettings(settings);
  const primary = String(settings.imageModel || pool[0] || "").trim();
  const explicitModel = String(args.model || "").trim();
  const pooledExplicitModel = pool.find((model) => model.toLowerCase() === explicitModel.toLowerCase());
  const image2Model = pool.find((model) => /(?:^|[/_.:-])gpt-image-2(?:$|[/_.:-])/i.test(model)) ||
    pool.find((model) => /gpt-image-2/i.test(model));
  if (image2Model) return image2Model;
  if (pooledExplicitModel) return pooledExplicitModel;
  return primary || pool[0] || explicitModel || undefined;
}

function normalizeLayerBlendMode(value) {
  const raw = String(value || "normal").trim().toLowerCase();
  return ["normal", "multiply", "screen", "overlay", "source-over"].includes(raw) ? raw : "normal";
}

function normalizeLayerSpec(value, index = 0) {
  if (!value || typeof value !== "object") return null;
  const sourceNodeId = String(value.sourceNodeId || value.nodeId || value.node_id || "").trim();
  const assetIndex = clampNumber(value.assetIndex ?? value.asset_index ?? value.index, 0, 999, index + 1);
  const asset = value.asset && typeof value.asset === "object" ? value.asset : undefined;
  if (!sourceNodeId && !asset) return null;
  return {
    id: String(value.id || value.layerId || `layer-${index + 1}`).trim().slice(0, 80) || `layer-${index + 1}`,
    title: String(value.title || value.name || `图层 ${index + 1}`).trim().slice(0, 80),
    prompt: value.prompt ? String(value.prompt).slice(0, 1000) : undefined,
    sourceNodeId: sourceNodeId || undefined,
    assetIndex,
    asset,
    x: Number.isFinite(Number(value.x)) ? Number(value.x) : 0,
    y: Number.isFinite(Number(value.y)) ? Number(value.y) : 0,
    width: Number.isFinite(Number(value.width)) && Number(value.width) > 0 ? Number(value.width) : undefined,
    height: Number.isFinite(Number(value.height)) && Number(value.height) > 0 ? Number(value.height) : undefined,
    scale: Number.isFinite(Number(value.scale)) && Number(value.scale) > 0 ? Number(value.scale) : 1,
    opacity: Math.min(1, Math.max(0, Number.isFinite(Number(value.opacity)) ? Number(value.opacity) : 1)),
    visible: value.visible !== false,
    blendMode: normalizeLayerBlendMode(value.blendMode || value.blend_mode)
  };
}

function normalizeLayerComposition(args = {}) {
  const layers = (Array.isArray(args.layers) ? args.layers : [])
    .map((layer, index) => normalizeLayerSpec(layer, index))
    .filter(Boolean)
    .slice(0, 32);
  if (!layers.length) throw new Error("image_gen operation=layer_merge 需要至少 1 个有效图层。");
  return {
    id: String(args.compositionId || args.id || `composition-${Date.now()}`).trim().slice(0, 80) || `composition-${Date.now()}`,
    title: String(args.title || "图层合成").trim().slice(0, 80),
    mode: "layer-stack",
    width: clampNumber(args.width, 64, 8192, 1024),
    height: clampNumber(args.height, 64, 8192, 1024),
    background: String(args.background || "transparent").trim().slice(0, 80) || "transparent",
    layers,
    createdAt: new Date().toISOString(),
    summary: String(args.summary || "").trim().slice(0, 240)
  };
}

function extractGeneratedImages(response) {
  const images = [];
  const data = Array.isArray(response?.data) ? response.data : [];

  for (const item of data) {
    const b64 = item?.b64_json ?? item?.image_base64 ?? item?.base64;
    const url = item?.url ?? item?.image_url?.url;
    if (b64) images.push({ type: "base64", value: String(b64), revisedPrompt: item?.revised_prompt });
    if (url) images.push({ type: "url", value: String(url), revisedPrompt: item?.revised_prompt });
  }

  const output = Array.isArray(response?.output) ? response.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      const b64 = part?.image_base64 ?? part?.b64_json;
      const url = part?.image_url ?? part?.url;
      if (b64) images.push({ type: "base64", value: String(b64), revisedPrompt: part?.revised_prompt });
      if (url) images.push({ type: "url", value: String(url), revisedPrompt: part?.revised_prompt });
    }
  }

  return images;
}

function writeImageOutputs(projectRoot, images, stem, outputFormat = "png") {
  const outputDir = path.join(projectRoot, "output", "imagegen");
  mkdirSync(outputDir, { recursive: true });
  const ext = outputExtensionForFormat(outputFormat);

  return images.map((image, index) => {
    if (image.type === "url") {
      return { index: index + 1, type: "url", url: image.value, revisedPrompt: image.revisedPrompt ?? "" };
    }

    const clean = image.value.replace(/^data:image\/\w+;base64,/, "");
    const filePath = path.join(outputDir, `${stem}-${String(index + 1).padStart(2, "0")}.${ext}`);
    writeFileSync(filePath, Buffer.from(clean, "base64"));
    const relativePath = path.relative(projectRoot, filePath).split(path.sep).map(encodeURIComponent).join("/");
    return {
      index: index + 1,
      type: "file",
      path: filePath,
      assetUrl: `iiimage-asset://local/${relativePath}`,
      revisedPrompt: image.revisedPrompt ?? ""
    };
  });
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function normalizeImageCount(value, fallback = 1, label = "image_gen count") {
  if (value === undefined || value === null || value === "") return fallback;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 10) {
    throw new Error(`${label} 必须是 1-10 的整数。`);
  }
  return count;
}

function normalizeImagePromptDraft(args, current = {}) {
  const source = args && typeof args === "object" ? args : {};
  const prompt = String(source.prompt ?? source.optimizedPrompt ?? source.finalPrompt ?? "").trim();
  if (!prompt) return null;

  const fallbackRatio = imagePromptRatios.has(current.ratio) ? current.ratio : "1:1";
  const fallbackResolution = normalizeImagePromptResolution(current.resolution, "1080P");
  const fallbackQuality = imagePromptQualities.has(current.quality) ? current.quality : "auto";
  const fallbackCount = clampNumber(current.count, 1, 10, 1);
  const ratio = imagePromptRatios.has(String(source.ratio ?? "").trim()) ? String(source.ratio).trim() : fallbackRatio;
  const resolution = normalizeImagePromptResolution(source.resolution, fallbackResolution);
  const quality = imagePromptQualities.has(String(source.quality ?? "").trim()) ? String(source.quality).trim() : fallbackQuality;
  const count = clampNumber(source.count, 1, 10, fallbackCount);

  return {
    prompt,
    ratio,
    resolution,
    count,
    quality
  };
}

function imageAssetWithDimensions(asset = {}) {
  if (!asset || typeof asset !== "object") return asset;
  const existingWidth = Number(asset.width);
  const existingHeight = Number(asset.height);
  if (existingWidth > 0 && existingHeight > 0) return { ...asset, width: existingWidth, height: existingHeight };
  const assetPath = String(asset.path || "").trim();
  if (!assetPath) return { ...asset };
  const info = imageInfo(assetPath);
  return info.exists && Number(info.width) > 0 && Number(info.height) > 0
    ? { ...asset, width: Number(info.width), height: Number(info.height) }
    : { ...asset };
}

function actualImageSizeFromAssets(assets = [], fallback = "") {
  const asset = (Array.isArray(assets) ? assets : []).find((item) => Number(item?.width) > 0 && Number(item?.height) > 0);
  return asset ? `${Number(asset.width)}x${Number(asset.height)}` : fallback;
}

async function normalizeGeneratedAssetsToDeliveryFrame(assets = [], deliverySize = "") {
  const target = parseImageSizeValue(deliverySize);
  const source = Array.isArray(assets) ? assets : [];
  if (!target || !sharpImage) return source.map(imageAssetWithDimensions);
  return Promise.all(source.map(async (input) => {
    const asset = imageAssetWithDimensions(input);
    const assetPath = String(asset?.path || "").trim();
    if (!assetPath || !existsSync(assetPath)) return asset;
    try {
      const metadata = await sharpImage(assetPath, { failOn: "none", limitInputPixels: 268402689 }).metadata();
      const sourceWidth = Number(metadata.width || asset.width || 0);
      const sourceHeight = Number(metadata.height || asset.height || 0);
      if (!sourceWidth || !sourceHeight) return asset;
      if (sourceWidth === target.width && sourceHeight === target.height) {
        return { ...asset, width: target.width, height: target.height, sourceWidth, sourceHeight, deliveryNormalized: false };
      }
      let pipeline = sharpImage(assetPath, { failOn: "none", limitInputPixels: 268402689 })
        .rotate()
        .resize(target.width, target.height, {
          fit: "cover",
          position: "centre",
          kernel: sharpImage.kernel.lanczos3,
          withoutEnlargement: false
        });
      const extension = path.extname(assetPath).toLowerCase();
      if (extension === ".jpg" || extension === ".jpeg") {
        pipeline = pipeline.jpeg({ quality: 95, chromaSubsampling: "4:4:4", mozjpeg: true });
      } else if (extension === ".webp") {
        pipeline = pipeline.webp({ quality: 95, smartSubsample: true });
      } else {
        pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
      }
      const buffer = await pipeline.toBuffer();
      writeFileSync(assetPath, buffer);
      return {
        ...asset,
        width: target.width,
        height: target.height,
        sourceWidth,
        sourceHeight,
        deliveryNormalized: true,
        deliveryFit: "cover-centre"
      };
    } catch {
      return asset;
    }
  }));
}

function normalizeLayerPlan(args = {}) {
  const allowedRoles = new Set(["background", "subject", "foreground", "decoration", "text", "shadow", "other"]);
  const source = Array.isArray(args.layerPlan) ? args.layerPlan : Array.isArray(args.layer_plan) ? args.layer_plan : [];
  const entries = source
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const role = allowedRoles.has(String(item.role || "")) ? String(item.role) : index === 0 ? "background" : "other";
      const id = String(item.id || item.layerId || `${role}-${index + 1}`)
        .trim()
        .replace(/[^a-z0-9_-]/gi, "-")
        .replace(/-+/g, "-")
        .slice(0, 48) || `layer-${index + 1}`;
      const title = String(item.title || item.name || `图层 ${index + 1}`).trim().slice(0, 80);
      const prompt = String(item.prompt || item.description || title).trim().slice(0, 1200);
      const text = role === "text" ? String(item.text || item.copy || item.content || "").trim().slice(0, 500) : "";
      const transparent = role === "background" ? false : item.transparent !== false;
      return { id, title, role, prompt, text: text || undefined, transparent };
    })
    .filter(Boolean)
    .slice(0, 8);
  if (entries.length < 2) throw new Error("image_gen operation=layers 需要至少 2 个图层。");
  if (entries[0].role !== "background") {
    throw new Error("layerPlan 必须按从底到顶排序，第一层应为不透明 background 背景层。");
  }
  return entries;
}

function compactModelForSettings(settings = {}) {
  return String(settings.compactModel || settings.agentCompactModel || settings.agentModel || settings.model || "").trim();
}

function createAgentRuntime(options) {
  const runtimeOptions = options || {};
  const projectRoot = runtimeOptions.projectRoot;
  const log = typeof runtimeOptions.log === "function" ? runtimeOptions.log : () => {};
  const diagnosticModelIO = runtimeOptions.diagnosticModelIO === true || process.env.IIIMAGE_AGENT_DIAGNOSTICS === "1";
  const configRoot = runtimeOptions.configDir || path.join(projectRoot, "config");
  const memoryDir = path.join(configRoot, "memory");
  const dbPath = path.join(memoryDir, "iiimage-memory.db");
  const dateMemoryPath = path.join(memoryDir, "datememorycontext.json");
  const promptMemoryPath = path.join(memoryDir, "promptcontext.json");
  const fastMemoryPath = path.join(memoryDir, "fastmemory.json");
  const memoryContextPath = path.join(memoryDir, "memorycontext.json");
  let db = null;
  let maintenanceRunning = false;

  function ensureMemory() {
    mkdirSync(memoryDir, { recursive: true });

    if (!existsSync(dateMemoryPath)) {
      writeJson(dateMemoryPath, {
        version: 1,
        next_entry_id: 1,
        needs_compaction: false,
        entries: []
      });
    }
    if (!existsSync(promptMemoryPath)) {
      writeJson(promptMemoryPath, {
        version: 2,
        format: "plain-text",
        contractRevision: promptTextContractRevision,
        mainPrompt: defaultMainAgentPrompt,
        memoryPrompt: defaultMemoryAgentPrompt,
        baseDefaultPromptRevision: defaultMainAgentPromptRevision,
        baseDefaultPromptHash: defaultMainAgentPromptHash,
        updatedAt: new Date().toISOString()
      });
    } else {
      const migrated = promptTextStoreFromRaw(readJson(promptMemoryPath, { version: 1, entries: [] }));
      if (migrated.changed) writeJson(promptMemoryPath, migrated.store);
    }
    if (!existsSync(fastMemoryPath)) {
      writeJson(fastMemoryPath, {
        version: 1,
        entries: []
      });
    }
    if (!existsSync(memoryContextPath)) {
      writeJson(memoryContextPath, {
        version: 1,
        entries: []
      });
    }

    if (!DatabaseSync) {
      throw new Error(`node:sqlite unavailable: ${sqliteLoadError?.message ?? "unknown error"}`);
    }

    if (!db) {
      db = new DatabaseSync(dbPath);
      db.exec(`
        CREATE TABLE IF NOT EXISTS runtime_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS memory_entries (
          entry_id TEXT PRIMARY KEY,
          order_index INTEGER NOT NULL,
          role TEXT NOT NULL,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          text TEXT NOT NULL,
          date_key TEXT NOT NULL,
          created_at TEXT NOT NULL,
          chars INTEGER NOT NULL,
          lines INTEGER NOT NULL,
          status TEXT NOT NULL,
          compact_of TEXT,
          tool_ref TEXT
        );
        CREATE TABLE IF NOT EXISTS context_entries (
          entry_id TEXT PRIMARY KEY,
          order_index INTEGER NOT NULL,
          role TEXT NOT NULL,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          text TEXT NOT NULL,
          date_key TEXT NOT NULL,
          created_at TEXT NOT NULL,
          chars INTEGER NOT NULL,
          lines INTEGER NOT NULL,
          status TEXT NOT NULL,
          compact_of TEXT,
          tool_ref TEXT
        );
        CREATE TABLE IF NOT EXISTS date_memory (
          date_key TEXT PRIMARY KEY,
          summary TEXT NOT NULL,
          chars INTEGER NOT NULL,
          status TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          keywords TEXT,
          entry_ids TEXT
        );
        CREATE TABLE IF NOT EXISTS tool_memory (
          entry_id TEXT PRIMARY KEY,
          tool_name TEXT NOT NULL,
          call_json TEXT NOT NULL,
          result_text TEXT NOT NULL,
          visible_output TEXT NOT NULL,
          summary TEXT NOT NULL,
          created_at TEXT NOT NULL,
          chars INTEGER NOT NULL,
          lines INTEGER NOT NULL,
          externalized INTEGER NOT NULL
        );
      `);
      for (const sql of [
        "ALTER TABLE date_memory ADD COLUMN keywords TEXT",
        "ALTER TABLE date_memory ADD COLUMN entry_ids TEXT"
      ]) {
        try {
          db.exec(sql);
        } catch {
          // Column already exists in newer stores.
        }
      }
    }
  }

  function getNextSequence() {
    ensureMemory();
    const row = db.prepare("SELECT value FROM runtime_meta WHERE key = 'next_entry_sequence'").get();
    const next = Number(row?.value ?? "1");
    db.prepare(
      "INSERT INTO runtime_meta(key, value) VALUES('next_entry_sequence', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run(String(next + 1));
    return next;
  }

  function runtimeMetaJson(key, fallback = null) {
    ensureMemory();
    const row = db.prepare("SELECT value FROM runtime_meta WHERE key = ?").get(String(key));
    if (!row?.value) return fallback;
    try {
      const parsed = JSON.parse(String(row.value));
      return parsed && typeof parsed === "object" ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function writeRuntimeMetaJson(key, value) {
    ensureMemory();
    db.prepare("INSERT INTO runtime_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(key), safeJson(value));
  }

  function compactScopeId(value = "default") {
    return String(value || "default").replace(/[^a-z0-9_-]+/gi, "-").slice(0, 96) || "default";
  }

  function externalScopeValue(value = "") {
    return String(value || "").trim().slice(0, 160);
  }

  function externalScopeFromInput(input = {}) {
    return {
      projectId: externalScopeValue(input.projectId),
      conversationId: externalScopeValue(input.conversationId)
    };
  }

  function externalEntryMatchesScope(target, entry = {}, input = {}) {
    if (target !== "fastmemory") return true;
    const scope = externalScopeFromInput(input);
    if (!scope.projectId && !scope.conversationId) return true;
    if (scope.projectId && externalScopeValue(entry.projectId) !== scope.projectId) return false;
    if (scope.conversationId && externalScopeValue(entry.conversationId) !== scope.conversationId) return false;
    return true;
  }

  function conversationSummaryKey(payload = {}) {
    return `conversation_summary:${compactScopeId(payload.projectId)}:${compactScopeId(payload.conversationId)}`;
  }

  function conversationProtocolKey(payload = {}) {
    return `conversation_protocol:${compactScopeId(payload.projectId)}:${compactScopeId(payload.conversationId)}`;
  }

  function makeEntryId(prefix = "ent") {
    const sequence = getNextSequence();
    return `${prefix}-${compactDateKey(dateKey())}-${String(sequence).padStart(6, "0")}`;
  }

  function nextOrderIndex() {
    ensureMemory();
    const row = db.prepare("SELECT COALESCE(MAX(order_index), 0) AS max_order FROM context_entries").get();
    return Number(row?.max_order ?? 0) + 1;
  }

  function externalStorePath(target) {
    if (target === "memorycontext") return memoryContextPath;
    return fastMemoryPath;
  }

  function readPromptTextStore() {
    ensureMemory();
    const migrated = promptTextStoreFromRaw(readJson(promptMemoryPath, {}));
    if (migrated.changed) writeJson(promptMemoryPath, migrated.store);
    return migrated.store;
  }

  function writePromptTextStore(store) {
    const normalized = promptTextStoreFromRaw({
      version: 2,
      format: "plain-text",
      contractRevision: promptTextContractRevision,
      mainPrompt: store?.mainPrompt,
      memoryPrompt: store?.memoryPrompt,
      baseDefaultPromptRevision: store?.baseDefaultPromptRevision,
      baseDefaultPromptHash: store?.baseDefaultPromptHash,
      updatedAt: store?.updatedAt || new Date().toISOString()
    }).store;
    writeJson(promptMemoryPath, normalized);
    return normalized;
  }

  function readExternalStore(target) {
    const filePath = externalStorePath(target);
    const fallback = { version: 1, entries: [] };
    const rawStore = readJson(filePath, fallback);
    const store = rawStore;
    return {
      version: 1,
      entries: Array.isArray(store.entries)
        ? store.entries
            .filter((entry) => entry && typeof entry === "object")
            .map((entry, index) => ({
              entry_id: String(entry.entry_id || `${target}-${index + 1}`),
              order_index: Number(entry.order_index || index + 1),
              section: String(entry.section || (target === "memorycontext" ? "private" : "surface")),
              title: String(entry.title || "entry"),
              text: String(entry.text || ""),
              status: String(entry.status || "active"),
              keywords: splitKeywords(entry.keywords),
              created_at: String(entry.created_at || new Date().toISOString()),
              updated_at: String(entry.updated_at || entry.created_at || new Date().toISOString()),
              compact_of: Array.isArray(entry.compact_of) ? entry.compact_of.map(String) : [],
              projectId: externalScopeValue(entry.projectId),
              conversationId: externalScopeValue(entry.conversationId)
            }))
        : fallback.entries
    };
  }

  function writeExternalStore(target, store) {
    const entries = Array.isArray(store.entries) ? store.entries : [];
    writeJson(externalStorePath(target), {
      version: 1,
      entries: entries.map((entry, index) => ({
        ...entry,
        order_index: Number(entry.order_index || index + 1)
      }))
    });
  }

  function nextExternalOrder(store) {
    return Math.max(0, ...store.entries.map((entry) => Number(entry.order_index || 0))) + 1;
  }

  function resolveExternalSelector(target, selector, section = "", input = {}) {
    const store = readExternalStore(target);
    const activeEntries = store.entries.filter((entry) => entry.status === "active" && (!section || entry.section === section) && externalEntryMatchesScope(target, entry, input));
    const raw = String(selector || "").trim();
    if (!raw) return { store, entries: [] };
    if (raw.toLowerCase() === "all") return { store, entries: activeEntries };

    const byOrder = new Map(activeEntries.map((entry) => [Number(entry.order_index), entry]));
    const byId = new Map(activeEntries.map((entry) => [entry.entry_id, entry]));
    const idRange = raw.match(/^([a-z]+-[a-z0-9_-]+)\s*-\s*([a-z]+-[a-z0-9_-]+)$/i);
    if (idRange) {
      const start = activeEntries.findIndex((entry) => entry.entry_id === idRange[1]);
      const end = activeEntries.findIndex((entry) => entry.entry_id === idRange[2]);
      if (start >= 0 && end >= 0) {
        const from = Math.min(start, end);
        const to = Math.max(start, end);
        return { store, entries: activeEntries.slice(from, to + 1) };
      }
    }

    const selected = [];
    for (const part of raw.split(",").map((item) => item.trim()).filter(Boolean)) {
      const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
      if (range) {
        const start = Math.min(Number(range[1]), Number(range[2]));
        const end = Math.max(Number(range[1]), Number(range[2]));
        for (let index = start; index <= end; index += 1) {
          const entry = byOrder.get(index);
          if (entry) selected.push(entry);
        }
        continue;
      }
      if (/^\d+$/.test(part)) {
        const entry = byOrder.get(Number(part));
        if (entry) selected.push(entry);
        continue;
      }
      const entry = byId.get(part);
      if (entry) selected.push(entry);
    }
    const seen = new Set();
    return {
      store,
      entries: selected.filter((entry) => {
        if (seen.has(entry.entry_id)) return false;
        seen.add(entry.entry_id);
        return true;
      })
    };
  }

  function appendDateMemory(entry) {
    const json = readJson(dateMemoryPath, { version: 1, next_entry_id: 1, needs_compaction: false, entries: [] });
    const entries = Array.isArray(json.entries) ? json.entries : [];
    entries.push({
      id: entry.entry_id,
      order_index: entry.order_index,
      role: entry.role,
      title: entry.title,
      text: entry.text,
      date: entry.date_key,
      created_at: entry.created_at,
      chars: entry.chars,
      lines: entry.lines,
      status: entry.status,
      compact_of: entry.compact_of
    });
    const totalChars = entries.reduce((sum, item) => sum + Number(item.chars ?? 0), 0);
    writeJson(dateMemoryPath, {
      version: 1,
      next_entry_id: Number(json.next_entry_id ?? 1) + 1,
      needs_compaction: totalChars >= dateMemoryCompactChars,
      entries
    });
  }

  function recordContextEntry(input) {
    ensureMemory();
    const createdAt = new Date().toISOString();
    const text = String(input.text ?? "");
    const entry = {
      entry_id: input.entryId ?? makeEntryId("ent"),
      order_index: input.orderIndex ?? nextOrderIndex(),
      role: input.role ?? "system",
      kind: input.kind ?? "chat",
      title: input.title ?? "记录",
      text,
      date_key: dateKey(),
      created_at: createdAt,
      chars: text.length,
      lines: countLines(text),
      status: input.status ?? "active",
      compact_of: input.compactOf ? safeJson(input.compactOf) : null,
      tool_ref: input.toolRef ?? null
    };

    const params = [
      entry.entry_id,
      entry.order_index,
      entry.role,
      entry.kind,
      entry.title,
      entry.text,
      entry.date_key,
      entry.created_at,
      entry.chars,
      entry.lines,
      entry.status,
      entry.compact_of,
      entry.tool_ref
    ];

    const insertSql = `
      INSERT INTO __TABLE__(entry_id, order_index, role, kind, title, text, date_key, created_at, chars, lines, status, compact_of, tool_ref)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entry_id) DO UPDATE SET
        order_index = excluded.order_index,
        role = excluded.role,
        kind = excluded.kind,
        title = excluded.title,
        text = excluded.text,
        date_key = excluded.date_key,
        created_at = excluded.created_at,
        chars = excluded.chars,
        lines = excluded.lines,
        status = excluded.status,
        compact_of = excluded.compact_of,
        tool_ref = excluded.tool_ref
    `;

    db.prepare(insertSql.replace("__TABLE__", "context_entries")).run(...params);
    db.prepare(insertSql.replace("__TABLE__", "memory_entries")).run(...params);
    appendDateMemory(entry);
    return entry;
  }

  function setEntryStatus(entryIds, status) {
    ensureMemory();
    const update = db.prepare("UPDATE context_entries SET status = ? WHERE entry_id = ?");
    const updateMemory = db.prepare("UPDATE memory_entries SET status = ? WHERE entry_id = ?");
    for (const entryId of entryIds) {
      update.run(status, entryId);
      updateMemory.run(status, entryId);
    }
  }

  function replaceContextEntry(entryId, patch) {
    ensureMemory();
    const row = db.prepare("SELECT * FROM context_entries WHERE entry_id = ?").get(entryId);
    if (!row) return null;
    const next = {
      ...row,
      title: patch.title ?? row.title,
      text: patch.text ?? row.text,
      kind: patch.kind ?? row.kind,
      role: patch.role ?? row.role,
      chars: String(patch.text ?? row.text).length,
      lines: countLines(patch.text ?? row.text),
      compact_of: patch.compactOf ? safeJson(patch.compactOf) : row.compact_of,
      status: patch.status ?? "active"
    };
    const params = [
      next.role,
      next.kind,
      next.title,
      next.text,
      next.chars,
      next.lines,
      next.status,
      next.compact_of,
      entryId
    ];
    const sql =
      "UPDATE __TABLE__ SET role = ?, kind = ?, title = ?, text = ?, chars = ?, lines = ?, status = ?, compact_of = ? WHERE entry_id = ?";
    db.prepare(sql.replace("__TABLE__", "context_entries")).run(...params);
    db.prepare(sql.replace("__TABLE__", "memory_entries")).run(...params);
    return next;
  }

  function getActiveEntries() {
    ensureMemory();
    return db.prepare("SELECT * FROM context_entries WHERE status = 'active' ORDER BY order_index ASC").all();
  }

  function resolveEntrySelector(selector) {
    const entries = getActiveEntries();
    const raw = String(selector ?? "").trim();
    if (!raw) return [];
    if (raw.toLowerCase() === "all") return entries;

    const byOrder = new Map(entries.map((entry) => [Number(entry.order_index), entry]));
    const byId = new Map(entries.map((entry) => [entry.entry_id, entry]));
    const idRange = raw.match(/^(ent-[a-z0-9_-]+)\s*-\s*(ent-[a-z0-9_-]+)$/i);
    if (idRange) {
      const start = entries.findIndex((entry) => entry.entry_id === idRange[1]);
      const end = entries.findIndex((entry) => entry.entry_id === idRange[2]);
      if (start >= 0 && end >= 0) {
        const from = Math.min(start, end);
        const to = Math.max(start, end);
        return entries.slice(from, to + 1);
      }
    }
    const selected = [];

    for (const part of raw.split(",").map((item) => item.trim()).filter(Boolean)) {
      const normalized = part.replace(/^id/i, "").replace(/^#/, "");
      const range = normalized.match(/^(\d+)\s*-\s*(\d+)$/);
      if (range) {
        const start = Math.min(Number(range[1]), Number(range[2]));
        const end = Math.max(Number(range[1]), Number(range[2]));
        for (let index = start; index <= end; index += 1) {
          const entry = byOrder.get(index);
          if (entry) selected.push(entry);
        }
        continue;
      }

      if (/^\d+$/.test(normalized)) {
        const entry = byOrder.get(Number(normalized));
        if (entry) selected.push(entry);
        continue;
      }

      const entry = byId.get(part);
      if (entry) selected.push(entry);
    }

    const seen = new Set();
    return selected.filter((entry) => {
      if (seen.has(entry.entry_id)) return false;
      seen.add(entry.entry_id);
      return true;
    });
  }

  function storeToolResult(toolName, callInput, resultText, options = {}) {
    ensureMemory();
    const fullText = String(resultText ?? "");
    const entry = recordContextEntry({
      role: "tool",
      kind: "tool_result",
      title: toolName,
      text: summarizeText(fullText, 1800),
      toolRef: toolName
    });
    const visibleOutput = summarizeText(fullText, Math.min(visibleToolChars, 1800));
    const externalized = fullText.length > visibleToolChars;
    const summary = options.summary || toolSummary(toolName, callInput, fullText, externalized);

    db.prepare(
      `INSERT INTO tool_memory(entry_id, tool_name, call_json, result_text, visible_output, summary, created_at, chars, lines, externalized)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      entry.entry_id,
      toolName,
      safeJson(callInput),
      fullText,
      visibleOutput,
      summary,
      entry.created_at,
      fullText.length,
      countLines(fullText),
      externalized ? 1 : 0
    );

    return {
      ok: options.ok !== false,
      entryId: entry.entry_id,
      tool: toolName,
      summary,
      visibleOutput,
      externalized,
      error: options.error,
      errorCategory: options.errorCategory,
      retriable: options.retriable,
      advice: options.advice,
      ...(typeof options.modelOutput === "string" || Array.isArray(options.modelOutput) ? { modelOutput: options.modelOutput } : {}),
      memoryRef: {
        type: "toolmemory",
        entryId: entry.entry_id,
        chars: fullText.length,
        lines: countLines(fullText),
        hint: "使用 memory(operation=check/read, entryId, keyword, lineStart, lineEnd) 精确读取"
      }
    };
  }

  async function listModels(input = {}) {
    ensureMemory();
    const provider = input.provider === "image" ? "image" : "agent";
    const config = providerSettings(input.settings ?? {}, provider);
    const apiKey = String(config.apiKey ?? "").trim();

    if (!apiKey) {
      return {
        ok: false,
        provider,
        models: [],
        error: `${provider === "image" ? "Image" : "Agent"} API key 未配置。`
      };
    }

    const response = await fetch(normalizeApiUrl(config.baseUrl, "/models"), {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` }
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        ok: false,
        provider,
        models: [],
        error: `models ${response.status}: ${text.slice(0, 360)}`
      };
    }

    const data = await response.json();
    const rawModels = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
    let models = rawModels
      .map((item) => (typeof item === "string" ? item : item?.id ?? item?.name))
      .filter(Boolean)
      .map(String)
      .sort((a, b) => a.localeCompare(b));
    if (provider === "image") models = imageModelsWithPreferredFallback(models, config.model);

    return { ok: true, provider, models, count: models.length };
  }

  async function callImageEditUpstreamDirect(config, payload) {
    if (typeof FormData === "undefined" || typeof Blob === "undefined") {
      throw new Error("当前运行时不支持图片编辑上传。");
    }

    const form = new FormData();
    form.set("model", payload.model);
    form.set("prompt", payload.prompt);
    form.set("size", payload.size);
    form.set("quality", payload.quality);
    form.set("n", String(payload.count));
    if (!isGptImageModel(payload.model)) form.set("response_format", "b64_json");
    if (payload.outputFormat) form.set("output_format", payload.outputFormat);
    if (payload.outputCompression !== undefined) form.set("output_compression", String(payload.outputCompression));
    if (payload.background) form.set("background", payload.background);
    if (payload.moderation) form.set("moderation", payload.moderation);
    if (payload.inputFidelity) form.set("input_fidelity", payload.inputFidelity);
    const imageField = isGptImageModel(payload.model) ? "image[]" : "image";

    const imageInputs = [payload.editImage, ...(payload.referenceImages || [])].filter(Boolean);
    for (const image of imageInputs) {
      const buffer = readRuntimeImageFile(image.path, 32 * 1024 * 1024, `图片 ${image.name || path.basename(image.path) || "image.png"}`);
      const blob = new Blob([buffer], { type: image.mimeType || "image/png" });
      form.append(imageField, blob, image.name || path.basename(image.path) || "image.png");
    }

    if (payload.maskImage) {
      const buffer = readRuntimeImageFile(payload.maskImage.path, 20 * 1024 * 1024, `蒙版 ${payload.maskImage.name || path.basename(payload.maskImage.path) || "mask.png"}`);
      const blob = new Blob([buffer], { type: payload.maskImage.mimeType || "image/png" });
      form.set("mask", blob, payload.maskImage.name || path.basename(payload.maskImage.path) || "mask.png");
    }

    const response = await fetch(normalizeApiUrl(config.baseUrl, "/images/edits"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${String(config.apiKey ?? "").trim()}`
      },
      body: form
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`image_gen edit ${response.status}: ${text.slice(0, 480)}`);
    }

    return response.json();
  }

  const imageBatchPlaceholderPattern = /^(?:temp(?:orary)?(?:\s+(?:item|image|prompt))?|placeholder\d*|unused|not\s*used|n\/?a|none|todo|tbd|string|prompt|example|sample|test(?:\s+item)?|待填写|未使用|不使用|无需|无|空|占位(?:符|项|图片|提示词)?|临时(?:项|图片|提示词)?|测试项)$/i;

  function isImageBatchPlaceholder(value = "") {
    return imageBatchPlaceholderPattern.test(String(value || "").trim());
  }

  function comparableSingleItemField(name, value) {
    if (value === undefined || value === null || value === "") return "";
    if (name === "ratio") return parseImageRatioValue(value)?.ratio || String(value).trim();
    if (name === "resolution") return String(value).trim().toUpperCase();
    if (name === "quality") return String(value).trim().toLowerCase();
    if (name === "size") {
      const parsed = parseImageSizeValue(value);
      return parsed ? `${parsed.width}x${parsed.height}` : String(value).trim().toLowerCase();
    }
    return String(value).trim();
  }

  function normalizedVisualPrompt(value = "") {
    return stripPastedBlockMarkers(value)
      .toLowerCase()
      .replace(/[\s\p{P}\p{S}]+/gu, "")
      .trim();
  }

  function resolveCompatibleSinglePrompt(topPrompt = "", itemPrompt = "") {
    if (!topPrompt) return itemPrompt;
    if (!itemPrompt) return topPrompt;
    const normalizedTop = normalizedVisualPrompt(topPrompt);
    const normalizedItem = normalizedVisualPrompt(itemPrompt);
    if (normalizedTop === normalizedItem) return topPrompt.length >= itemPrompt.length ? topPrompt : itemPrompt;
    if (normalizedTop.includes(normalizedItem) || normalizedItem.includes(normalizedTop)) {
      return normalizedTop.length >= normalizedItem.length ? topPrompt : itemPrompt;
    }
    throw new Error("image_gen 的顶层 prompt 与唯一有效 items.prompt 表达了不同画面，无法无损确定应使用哪一个。");
  }

  function normalizeSingleImageItemCompatibility(args = {}) {
    if (args.items === undefined) return { ...args };
    if (args.items === null || args.items === "") return { ...args, items: undefined };
    const sourceItems = Array.isArray(args.items)
      ? args.items
      : args.items && typeof args.items === "object"
        ? [args.items]
        : [args.items];
    const usableItems = sourceItems.filter((item, index) => {
      if (typeof item === "string" && isImageBatchPlaceholder(item)) return false;
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error(`image_gen items[${index}] 必须是对象。`);
      }
      const itemPrompt = stripPastedBlockMarkers(item.prompt ?? "");
      return Boolean(itemPrompt && !isImageBatchPlaceholder(itemPrompt));
    });
    if (usableItems.length === 0) {
      return { ...args, items: undefined };
    }
    if (usableItems.length > 1) {
      if (usableItems.length > 10) throw new Error("image_gen items 最多包含 10 个有效项。");
      return { ...args, count: usableItems.length, items: usableItems };
    }

    const item = usableItems[0];

    const topPrompt = stripPastedBlockMarkers(args.prompt ?? "");
    const itemPrompt = stripPastedBlockMarkers(item.prompt ?? "");
    if (!topPrompt && !itemPrompt) throw new Error("image_gen 缺少可用的单图 prompt。");
    const prompt = resolveCompatibleSinglePrompt(topPrompt, itemPrompt);
    const requestedCount = Number(args.count);
    const preserveRepeatedCount = sourceItems.length === 1 && Number.isSafeInteger(requestedCount) && requestedCount >= 2 && requestedCount <= 10;

    const normalized = {
      ...args,
      prompt,
      count: preserveRepeatedCount ? requestedCount : 1,
      items: undefined
    };
    for (const field of ["ratio", "resolution", "quality", "size"]) {
      const topValue = args[field];
      const itemValue = item[field];
      if ((topValue === undefined || topValue === null || topValue === "") && itemValue !== undefined && itemValue !== null && itemValue !== "") {
        normalized[field] = itemValue;
        continue;
      }
      if (
        topValue !== undefined && topValue !== null && topValue !== "" &&
        itemValue !== undefined && itemValue !== null && itemValue !== "" &&
        comparableSingleItemField(field, topValue) !== comparableSingleItemField(field, itemValue)
      ) {
        throw new Error(`image_gen count=1 的顶层 ${field} 与 items[0].${field} 不一致；请只保留顶层参数。`);
      }
    }
    return normalized;
  }

  function normalizeImageBatchItems(args = {}, settings = {}) {
    const source = Array.isArray(args.items) ? args.items : [];
    return source
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const prompt = stripPastedBlockMarkers(item.prompt || "");
        if (!prompt || isImageBatchPlaceholder(prompt)) return null;
        const frame = normalizeImageToolFrame({
          ...args,
          ...item,
          prompt,
          model: item.model || args.model
        }, settings);
        const rawTitle = cleanOneLine(item.title || "", 100);
        return {
          title: rawTitle && !isImageBatchPlaceholder(rawTitle) ? rawTitle : "",
          prompt,
          ratio: frame.ratio,
          resolution: frame.resolution,
          size: frame.size,
          quality: imagePromptQualities.has(String(item.quality || "").trim()) ? String(item.quality).trim() : args.quality ?? settings.imageQuality ?? "auto"
        };
      })
      .filter(Boolean)
      .map((item, index) => ({ ...item, title: item.title || `方案 ${index + 1}` }));
  }

  function clearConversationState(input = {}) {
    ensureMemory();
    const scope = requiredFastMemoryScope(input);
    if (!scope.ok) {
      return { ok: false, error: "清理会话需要 projectId 和 conversationId。", clearedFastMemory: 0, clearedSummary: false };
    }
    const { projectId, conversationId } = scope;

    const store = readExternalStore("fastmemory");
    const before = store.entries.length;
    store.entries = store.entries.filter((entry) => !(
      externalScopeValue(entry.projectId) === projectId &&
      externalScopeValue(entry.conversationId) === conversationId
    ));
    const clearedFastMemory = before - store.entries.length;
    if (clearedFastMemory > 0) writeExternalStore("fastmemory", store);

    const summaryKey = conversationSummaryKey({ projectId, conversationId });
    const summaryResult = db.prepare("DELETE FROM runtime_meta WHERE key = ?").run(summaryKey);
    const protocolKey = conversationProtocolKey({ projectId, conversationId });
    const protocolResult = db.prepare("DELETE FROM runtime_meta WHERE key = ?").run(protocolKey);
    return {
      ok: true,
      projectId,
      conversationId,
      clearedFastMemory,
      clearedSummary: Number(summaryResult?.changes || 0) > 0,
      clearedProtocol: Number(protocolResult?.changes || 0) > 0,
      summary: "当前聊天上下文和绘画经验已清理。"
    };
  }

  function cancelPendingExecutionState(input = {}) {
    const scope = requiredFastMemoryScope(input);
    const requestId = cleanOneLine(input.requestId || "", 180);
    if (!scope.ok || !requestId) {
      return { ok: false, error: "取消挂起任务需要 projectId、conversationId 和 requestId。" };
    }
    appendConversationProtocolTurn(scope, [{
      type: "message",
      role: "user",
      content: [{
        type: "input_text",
        text: `用户已取消补充请求 ${requestId}，不再继续该挂起任务。后续消息必须作为新的独立请求处理，除非用户明确重新提起原任务。`
      }]
    }]);
    return {
      ok: true,
      projectId: scope.projectId,
      conversationId: scope.conversationId,
      requestId,
      summary: "挂起任务已取消。"
    };
  }

  function getMainPrompt() {
    const store = readPromptTextStore();
    const status = promptStoreStatus(store);
    return {
      ok: true,
      text: store.mainPrompt,
      ...status,
      defaultText: defaultMainAgentPrompt,
      maxChars: mainAgentPromptMaxChars,
      updatedAt: store.updatedAt
    };
  }

  function saveMainPrompt(input = {}) {
    const validated = validateEditableText(input?.text, mainAgentPromptMaxChars, "Main Agent Prompt");
    if (!validated.ok) return { ok: false, error: validated.error, maxChars: mainAgentPromptMaxChars };
    const current = readPromptTextStore();
    const currentStatus = promptStoreStatus(current);
    const nextIsDefault = validated.text === defaultMainAgentPrompt;
    const store = writePromptTextStore({
      ...current,
      mainPrompt: validated.text,
      baseDefaultPromptRevision: nextIsDefault ? defaultMainAgentPromptRevision : currentStatus.baseDefaultPromptRevision,
      baseDefaultPromptHash: nextIsDefault ? defaultMainAgentPromptHash : currentStatus.baseDefaultPromptHash,
      updatedAt: new Date().toISOString()
    });
    return {
      ok: true,
      text: store.mainPrompt,
      ...promptStoreStatus(store),
      defaultText: defaultMainAgentPrompt,
      maxChars: mainAgentPromptMaxChars,
      updatedAt: store.updatedAt
    };
  }

  function resetMainPrompt() {
    const current = readPromptTextStore();
    const store = writePromptTextStore({
      ...current,
      mainPrompt: defaultMainAgentPrompt,
      baseDefaultPromptRevision: defaultMainAgentPromptRevision,
      baseDefaultPromptHash: defaultMainAgentPromptHash,
      updatedAt: new Date().toISOString()
    });
    return {
      ok: true,
      text: store.mainPrompt,
      ...promptStoreStatus(store),
      defaultText: defaultMainAgentPrompt,
      maxChars: mainAgentPromptMaxChars,
      updatedAt: store.updatedAt
    };
  }

  function requiredFastMemoryScope(input = {}) {
    const rawProjectId = String(input.projectId || "").trim();
    const rawConversationId = String(input.conversationId || "").trim();
    if (rawProjectId.includes("\0") || rawConversationId.includes("\0") || rawProjectId.length > 160 || rawConversationId.length > 160) {
      return { ok: false, error: "projectId 或 conversationId 无效。" };
    }
    const scope = externalScopeFromInput(input);
    if (!scope.projectId || !scope.conversationId) {
      return { ok: false, error: "绘画经验配置需要 projectId 和 conversationId。" };
    }
    return { ok: true, ...scope };
  }

  function exactScopedFastMemoryEntries(store, scope) {
    return store.entries.filter(
      (entry) =>
        entry.status === "active" &&
        externalScopeValue(entry.projectId) === scope.projectId &&
        externalScopeValue(entry.conversationId) === scope.conversationId
    );
  }

  function scopedFastMemoryText(store, scope) {
    return exactScopedFastMemoryEntries(store, scope)
      .sort((a, b) => Number(a.order_index || 0) - Number(b.order_index || 0))
      .map((entry) => sanitizeFastMemoryText(entry.text))
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }

  function scopedFastMemoryUpdatedAt(store, scope) {
    return exactScopedFastMemoryEntries(store, scope)
      .map((entry) => String(entry.updated_at || entry.created_at || "").trim())
      .filter(Boolean)
      .sort()
      .at(-1) || "";
  }

  function getFastMemory(input = {}) {
    const scope = requiredFastMemoryScope(input);
    if (!scope.ok) return { ok: false, error: scope.error, text: "", isEmpty: true, maxChars: scopedFastMemoryMaxChars };
    const store = readExternalStore("fastmemory");
    const text = scopedFastMemoryText(store, scope);
    return {
      ok: true,
      text,
      isEmpty: !text,
      isOversized: text.length > scopedFastMemoryMaxChars,
      maxChars: scopedFastMemoryMaxChars,
      contextMaxChars: fastMemoryPromptMaxChars,
      updatedAt: scopedFastMemoryUpdatedAt(store, scope)
    };
  }

  function saveFastMemory(input = {}) {
    const scope = requiredFastMemoryScope(input);
    if (!scope.ok) return { ok: false, error: scope.error, text: "", isEmpty: true, maxChars: scopedFastMemoryMaxChars };
    const validated = validateEditableText(input?.text, scopedFastMemoryMaxChars, "绘画经验", sanitizeFastMemoryText);
    if (!validated.ok) return { ok: false, error: validated.error, text: "", isEmpty: true, maxChars: scopedFastMemoryMaxChars };

    const store = readExternalStore("fastmemory");
    const currentText = scopedFastMemoryText(store, scope);
    const currentUpdatedAt = scopedFastMemoryUpdatedAt(store, scope);
    if (Object.prototype.hasOwnProperty.call(input, "expectedUpdatedAt") && String(input.expectedUpdatedAt || "") !== currentUpdatedAt) {
      return {
        ok: false,
        conflict: true,
        error: "Agent 记忆在编辑期间已更新，请先合并最新内容。",
        text: currentText,
        isEmpty: !currentText,
        maxChars: scopedFastMemoryMaxChars,
        updatedAt: currentUpdatedAt
      };
    }
    store.entries = store.entries.filter(
      (entry) =>
        !(
          externalScopeValue(entry.projectId) === scope.projectId &&
          externalScopeValue(entry.conversationId) === scope.conversationId
        )
    );
    const now = new Date().toISOString();
    store.entries.push({
      entry_id: makeEntryId("fmem"),
      order_index: nextExternalOrder(store),
      section: "experience",
      title: "绘画经验",
      text: validated.text,
      status: "active",
      keywords: [],
      created_at: now,
      updated_at: now,
      compact_of: [],
      projectId: scope.projectId,
      conversationId: scope.conversationId
    });
    writeExternalStore("fastmemory", store);
    return { ok: true, text: validated.text, isEmpty: false, maxChars: scopedFastMemoryMaxChars, updatedAt: now };
  }

  function resetFastMemory(input = {}) {
    const scope = requiredFastMemoryScope(input);
    if (!scope.ok) return { ok: false, error: scope.error, text: "", isEmpty: true, maxChars: scopedFastMemoryMaxChars };
    const store = readExternalStore("fastmemory");
    const currentText = scopedFastMemoryText(store, scope);
    const currentUpdatedAt = scopedFastMemoryUpdatedAt(store, scope);
    if (Object.prototype.hasOwnProperty.call(input, "expectedUpdatedAt") && String(input.expectedUpdatedAt || "") !== currentUpdatedAt) {
      return {
        ok: false,
        conflict: true,
        error: "Agent 记忆在编辑期间已更新，请先合并最新内容。",
        text: currentText,
        isEmpty: !currentText,
        maxChars: scopedFastMemoryMaxChars,
        updatedAt: currentUpdatedAt
      };
    }
    const before = store.entries.length;
    store.entries = store.entries.filter(
      (entry) =>
        !(
          externalScopeValue(entry.projectId) === scope.projectId &&
          externalScopeValue(entry.conversationId) === scope.conversationId
        )
    );
    const cleared = before - store.entries.length;
    if (cleared > 0) writeExternalStore("fastmemory", store);
    return { ok: true, text: "", isEmpty: true, maxChars: scopedFastMemoryMaxChars, cleared, updatedAt: "" };
  }

  function normalizeLayeredImageToolArgs(toolName, args, settings, context = {}) {
    args = normalizeSingleImageItemCompatibility(args);
    const operation = String(args.operation ?? args.mode ?? "").trim().toLowerCase();
    if (operation !== "layers") {
      throw new Error(`${toolName} operation=${operation || "<missing>"} 不是分层 PNG 请求。`);
    }
    const prompt = stripPastedBlockMarkers(args.prompt ?? "");
    if (!prompt) throw new Error(`${toolName} operation=layers 缺少完整画面要求。`);
    validateImageFrameFields(args, `${toolName} operation=layers`);
    if (args.items !== undefined) {
      if (!Array.isArray(args.items)) throw new Error(`${toolName} items 必须是数组。`);
      if (args.items.length > 0) throw new Error(`${toolName} operation=layers 不支持 items；请使用顶层 prompt 和 layerPlan。`);
    }
    const count = normalizeImageCount(args.count, 1, `${toolName} operation=layers count`);
    if (count !== 1) throw new Error(`${toolName} operation=layers 只支持 count=1。`);
    const rawPlan = Array.isArray(args.layerPlan) ? args.layerPlan : Array.isArray(args.layer_plan) ? args.layer_plan : [];
    if (rawPlan.length > 8) throw new Error(`${toolName} operation=layers 最多支持 8 个图层。`);
    const layerPlan = normalizeLayerPlan(args);
    const layerIds = layerPlan.map((item) => item.id);
    if (new Set(layerIds).size !== layerIds.length) {
      throw new Error(`${toolName} operation=layers 的 layerPlan.id 必须唯一。`);
    }
    const resumeLayerGroupId = cleanOneLine(args.resumeLayerGroupId || args.resume_layer_group_id || "", 120);
    const requestedRetryLayerIds = [...new Set((Array.isArray(args.retryLayerIds ?? args.retry_layer_ids) ? (args.retryLayerIds ?? args.retry_layer_ids) : [])
      .map((value) => cleanOneLine(value, 120))
      .filter(Boolean))];
    const resumeLayerNodes = resumeLayerGroupId
      ? (Array.isArray(context.nodes) ? context.nodes : []).filter((node) => node?.layerGroup?.id === resumeLayerGroupId)
      : [];
    const recovery = resumeLayerNodes.find((node) => node?.layerGroup?.recovery)?.layerGroup?.recovery || null;
    if (requestedRetryLayerIds.length && !resumeLayerGroupId) {
      throw new Error(`${toolName} retryLayerIds 必须与 resumeLayerGroupId 同时使用。`);
    }
    if (resumeLayerGroupId) {
      if (!resumeLayerNodes.length || !recovery?.recoverable) throw new Error(`${toolName} resumeLayerGroupId=${resumeLayerGroupId} 不是可恢复的分层组。`);
      const groupLayerIds = resumeLayerNodes.map((node) => String(node.layerGroup?.layerId || "")).filter(Boolean);
      if (layerIds.length !== groupLayerIds.length || layerIds.some((id) => !groupLayerIds.includes(id))) {
        throw new Error(`${toolName} 恢复分层时 layerPlan 必须完整保留原组全部图层 ID。`);
      }
    }
    const retryLayerIds = resumeLayerGroupId
      ? (requestedRetryLayerIds.length ? requestedRetryLayerIds : [...(recovery.failedLayerIds || [])])
      : [];
    if (resumeLayerGroupId && (!retryLayerIds.length || retryLayerIds.some((id) => !(recovery.failedLayerIds || []).includes(id)))) {
      throw new Error(`${toolName} retryLayerIds 只能来自 layerRecovery failed 列表。`);
    }
    if (resumeLayerGroupId && retryLayerIds.length !== (recovery.failedLayerIds || []).length) {
      throw new Error(`${toolName} retryLayerIds 必须完整覆盖 layerRecovery failed 列表，不能把仍失败的图层当作成功层复用。`);
    }
    const resumeSourceParentId = cleanOneLine(resumeLayerNodes.find((node) => node?.layerGroup?.sourceParentId)?.layerGroup?.sourceParentId || "", 160);
    const taskScopePresent = Boolean(context.taskScope && typeof context.taskScope === "object");
    const taskScope = normalizedTaskScope({ taskScope: context.taskScope, selectedNodeId: context.selectedNodeId, selectedNodeIds: context.selectedNodeIds });
    const pathKey = (value) => {
      const raw = String(value || "").trim();
      if (!raw) return "";
      try { return path.resolve(raw).replace(/\\/g, "/").toLowerCase(); } catch { return raw.replace(/\\/g, "/").toLowerCase(); }
    };
    const findScoped = (items, selector) => {
      const bindingId = cleanOneLine(selector?.bindingId || "", 520);
      if (bindingId) return items.find((item) => item.bindingId === bindingId) || null;
      const assetId = cleanOneLine(selector?.assetId || "", 160);
      if (assetId) {
        const matches = items.filter((item) => item.assetId === assetId);
        if (matches.length > 1) throw new Error(`${toolName} assetId=${assetId} 对应多个槽位，请改用 sourceBindingId。`);
        return matches[0] || null;
      }
      const requestedPath = pathKey(typeof selector === "string" ? selector : selector?.path || selector?.imagePath || selector?.file);
      return requestedPath ? items.find((item) => pathKey(item.path) === requestedPath) || null : null;
    };
    const requestedParentId = String(args.parentId ?? resumeSourceParentId ?? "").trim();
    let parentId = requestedParentId || (!resumeLayerGroupId ? String(context.selectedNodeId ?? "").trim() : "") || undefined;
    let logicalParentNode = parentId ? findWorkflowNode(context.nodes || [], parentId) : null;
    let sourceNode = requirementSourceForNode(context.nodes || [], logicalParentNode) || logicalParentNode;
    if (requestedParentId && !logicalParentNode) {
      throw new Error(`${toolName} parentId=${requestedParentId} 不存在于当前画布。`);
    }
    if (parentId && !logicalParentNode) {
      throw new Error(`${toolName} 当前选中的来源成果 ${parentId} 不存在于画布。`);
    }
    const sourceSelector = args.sourceImage ?? args.sourcePath ?? (args.sourceBindingId
      ? { bindingId: args.sourceBindingId }
      : args.sourceAssetId
        ? { assetId: args.sourceAssetId }
        : null);
    const explicitSource = taskScopePresent && sourceSelector ? findScoped(taskScope.sourceAssets, sourceSelector) : null;
    if (taskScopePresent && sourceSelector && !explicitSource) throw new Error(`${toolName} 指定的 SOURCE 不属于 Current Task Scope。`);
    if (!parentId && explicitSource?.nodeId) {
      parentId = explicitSource.nodeId;
      logicalParentNode = findWorkflowNode(context.nodes || [], parentId);
      sourceNode = requirementSourceForNode(context.nodes || [], logicalParentNode) || logicalParentNode;
    }
    if (!parentId && taskScope.sourceNodeIds.length === 1) {
      parentId = taskScope.sourceNodeIds[0];
      logicalParentNode = findWorkflowNode(context.nodes || [], parentId);
      sourceNode = requirementSourceForNode(context.nodes || [], logicalParentNode) || logicalParentNode;
    }
    const uniqueSources = uniqueTaskAssets(taskScope.sourceAssets);
    const hasAssetIndex = Object.prototype.hasOwnProperty.call(args, "assetIndex");
    const indexedSource = hasAssetIndex && taskScopePresent
      ? taskScopeSourceAt(taskScope, sourceNode?.id || parentId, args.assetIndex, toolName)
      : null;
    if (explicitSource && indexedSource && explicitSource.assetId !== indexedSource.assetId) {
      throw new Error(`${toolName} sourceAssetId 与 parentId + assetIndex 指向不同 SOURCE。`);
    }
    const selectedSource = resumeLayerGroupId ? null : explicitSource || indexedSource || (uniqueSources.length === 1 ? uniqueSources[0] : null);
    if (!resumeLayerGroupId && taskScopePresent && uniqueSources.length > 1 && !selectedSource) {
      throw new Error(`${toolName} 当前有 ${uniqueSources.length} 个 SOURCE；分层前请明确 sourceAssetId 或 parentId + assetIndex。`);
    }
    if (sourceNode?.id && selectedSource?.nodeId && selectedSource.nodeId !== sourceNode.id) {
      throw new Error(`${toolName} SOURCE ${selectedSource.displayCode || selectedSource.assetId} 不属于 parentId=${parentId}。`);
    }
    if (!parentId && selectedSource?.nodeId) parentId = selectedSource.nodeId;
    if (!resumeLayerGroupId && taskScopePresent && parentId && !taskScope.sourceNodeIds.includes(parentId)) {
      throw new Error(`${toolName} parentId=${parentId} 不属于本轮 SOURCE。`);
    }
    const requestedReferences = Array.isArray(args.referenceImages ?? args.references)
      ? (args.referenceImages ?? args.references)
      : (args.referenceImages ?? args.references) ? [args.referenceImages ?? args.references] : [];
    const resolvedReferences = taskScopePresent
      ? (requestedReferences.length ? requestedReferences : taskScope.referenceAssets).map((requested) => {
          const scoped = findScoped(taskScope.referenceAssets, requested);
          if (!scoped) throw new Error(`${toolName} 指定的 REFERENCE 不属于 Current Task Scope。`);
          const requestedStructuralRole = String(requested?.role || "").toLowerCase();
          const role = cleanOneLine(
            requested?.referenceRole || (!["source", "reference"].includes(requestedStructuralRole) ? requested?.role : "") || scoped.referenceRole || "",
            80
          ).toLowerCase();
          if (["source", "edit_target"].includes(role)) throw new Error(`${toolName} REFERENCE 不能替代 SOURCE。`);
          return { ...scoped, role: role || undefined, purpose: cleanOneLine(requested?.purpose || scoped.purpose || "", 320) || undefined };
        })
      : requestedReferences;
    const frame = normalizeImageToolFrame({ ...args, prompt }, settings);
    return {
      ...args,
      operation: "layers",
      prompt,
      count: 1,
      items: undefined,
      layerPlan,
      resumeLayerGroupId: resumeLayerGroupId || undefined,
      retryLayerIds: retryLayerIds.length ? retryLayerIds : undefined,
      parentId,
      sourceImage: taskScopePresent && selectedSource ? { ...selectedSource, role: "source" } : args.sourceImage,
      referenceImages: resolvedReferences,
      ratio: frame.ratio,
      resolution: frame.resolution,
      size: frame.size,
      quality: args.quality ?? settings?.imageQuality ?? "auto",
      taskProvenance: imageTaskProvenance(taskScopePresent ? taskScope : null, selectedSource)
    };
  }

  function normalizeRegionEditorOpenArgs(toolName, args, settings, context = {}) {
    args = normalizeSingleImageItemCompatibility(args);
    const operation = String(args.operation ?? args.mode ?? "").trim().toLowerCase();
    if (!["redraw", "cutout"].includes(operation)) {
      throw new Error(`${toolName} operation=${operation || "<missing>"} 不是区域编辑请求。`);
    }
    validateImageFrameFields(args, `${toolName} operation=${operation}`);
    if (args.items !== undefined) {
      if (!Array.isArray(args.items)) throw new Error(`${toolName} items 必须是数组。`);
      if (args.items.length > 0) throw new Error(`${toolName} operation=${operation} 不支持 items。`);
    }
    const count = normalizeImageCount(args.count, 1, `${toolName} operation=${operation} count`);
    if (count !== 1) throw new Error(`${toolName} operation=${operation} 只支持 count=1。`);
    const taskScopePresent = Boolean(context.taskScope && typeof context.taskScope === "object");
    const taskScope = normalizedTaskScope({ taskScope: context.taskScope, selectedNodeId: context.selectedNodeId, selectedNodeIds: context.selectedNodeIds });
    const requestedSourceBindingId = cleanOneLine(args.sourceBindingId || args.sourceImage?.bindingId || "", 520);
    const requestedSourceAssetId = cleanOneLine(args.sourceAssetId || args.sourceImage?.assetId || "", 160);
    const assetIdMatches = requestedSourceAssetId
      ? taskScope.sourceAssets.filter((item) => item.assetId === requestedSourceAssetId)
      : [];
    if (!requestedSourceBindingId && assetIdMatches.length > 1) {
      throw new Error(`${toolName} assetId=${requestedSourceAssetId} 对应多个槽位，请改用 sourceBindingId。`);
    }
    const explicitSource = requestedSourceBindingId
      ? taskScope.sourceAssets.find((item) => item.bindingId === requestedSourceBindingId) || null
      : assetIdMatches[0] || null;
    if (taskScopePresent && (requestedSourceBindingId || requestedSourceAssetId) && !explicitSource) {
      throw new Error(`${toolName} 指定的 SOURCE 不属于 Current Task Scope。`);
    }
    const uniqueSources = uniqueTaskAssets(taskScope.sourceAssets);
    if (taskScopePresent && uniqueSources.length > 1 && !explicitSource && !Object.prototype.hasOwnProperty.call(args, "assetIndex")) {
      throw new Error(`${toolName} 当前有 ${uniqueSources.length} 个 SOURCE；打开区域编辑器前请明确 sourceBindingId、sourceAssetId 或 assetIndex。`);
    }
    const requestedParentId = String(args.parentId ?? "").trim();
    const parentId = requestedParentId || explicitSource?.nodeId || String(context.selectedNodeId ?? "").trim();
    const logicalParentNode = findWorkflowNode(context.nodes || [], parentId);
    const sourceNode = requirementSourceForNode(context.nodes || [], logicalParentNode) || logicalParentNode;
    if (taskScopePresent && parentId && !taskScope.sourceNodeIds.includes(parentId)) {
      throw new Error(`${toolName} parentId=${parentId} 不属于本轮 SOURCE。`);
    }
    if (explicitSource?.nodeId && sourceNode?.id && explicitSource.nodeId !== sourceNode.id) {
      throw new Error(`${toolName} SOURCE ${explicitSource.displayCode || explicitSource.assetId} 不属于 parentId=${parentId}。`);
    }
    const indexedSource = taskScopePresent && Object.prototype.hasOwnProperty.call(args, "assetIndex")
      ? taskScopeSourceAt(taskScope, sourceNode?.id || parentId, args.assetIndex, toolName)
      : null;
    if (explicitSource && indexedSource && explicitSource.assetId !== indexedSource.assetId) {
      throw new Error(`${toolName} sourceAssetId 与 parentId + assetIndex 指向不同 SOURCE。`);
    }
    const selectedSource = explicitSource || indexedSource;
    const assetIndex = selectedSource ? taskSourceIndexInNode(selectedSource, sourceNode) : Math.max(0, Math.floor(Number(args.assetIndex ?? 0) || 0));
    if (!parentId || !sourceNode || assetIndex < 0 || !referenceImageFromNodeExact(sourceNode, assetIndex)) {
      throw new Error(`${toolName} operation=${operation} 需要当前选中图片或有效 parentId，再由用户涂抹${operation === "cutout" ? "要保留的主体" : "需要修改的区域"}。`);
    }
    const frame = normalizeImageToolFrame(args, settings);
    return {
      ...args,
      operation,
      prompt: stripPastedBlockMarkers(args.prompt ?? ""),
      count: 1,
      items: undefined,
      parentId: sourceNode.id,
      assetIndex,
      ratio: frame.ratio,
      resolution: frame.resolution,
      size: frame.size,
      quality: args.quality ?? settings?.imageQuality ?? "auto"
    };
  }

  function normalizeImageToolArgs(toolName, args, settings, context = {}) {
    args = normalizeSingleImageItemCompatibility(args);
    const requestedOperation = String(args.operation ?? args.mode ?? "").trim().toLowerCase();
    const supportedOperations = new Set(["generate", "edit", "replace", "variants", "redraw", "cutout"]);
    if (!supportedOperations.has(requestedOperation)) {
      throw new Error(`${toolName} operation=${requestedOperation || "<missing>"} 无效。请使用公开 schema 中列出的 operation。`);
    }
    const mode = requestedOperation === "replace" || requestedOperation === "variants"
      ? "edit"
      : ["generate", "edit", "redraw", "cutout"].includes(requestedOperation)
        ? requestedOperation
        : "generate";
    const prompt = stripPastedBlockMarkers(args.prompt ?? "");
    if (!prompt) throw new Error(`${toolName} operation=${requestedOperation} 缺少完整 prompt。`);

    validateImageFrameFields(args, toolName);
    if (args.items !== undefined && !Array.isArray(args.items)) {
      throw new Error(`${toolName} items 必须是数组。`);
    }
    if (Array.isArray(args.items) && args.items.length > 10) {
      throw new Error(`${toolName} items 最多 10 项。`);
    }
    if (Array.isArray(args.items)) {
      args.items.forEach((item, index) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          throw new Error(`${toolName} items[${index}] 必须是对象。`);
        }
        validateImageFrameFields(item, `${toolName} items[${index}]`);
      });
    }
    const normalizedBatchItems = normalizeImageBatchItems(args, settings);
    if (normalizedBatchItems.length > 1 && !["generate", "variants"].includes(requestedOperation)) {
      throw new Error(`${toolName} operation=${requestedOperation} 不支持 items；不同 prompt 批量仅用于 generate/variants。`);
    }
    const count = normalizeImageCount(args.count, normalizedBatchItems.length > 1 ? normalizedBatchItems.length : 1, `${toolName} count`);
    if (["cutout", "redraw"].includes(mode) && count !== 1) {
      throw new Error(`${toolName} operation=${requestedOperation} 只支持 count=1。`);
    }
    const rawGenerationMode = args.generationMode === undefined || args.generationMode === null
      ? ""
      : String(args.generationMode).trim().toLowerCase();
    if (rawGenerationMode && !["parallel", "sequential"].includes(rawGenerationMode)) {
      throw new Error(`${toolName} generationMode=${String(args.generationMode)} 无效。请使用 parallel 或 sequential。`);
    }
    const generationMode = rawGenerationMode || (count > 1 ? "parallel" : undefined);
    const taskScopePresent = Boolean(context.taskScope && typeof context.taskScope === "object");
    const taskScope = normalizedTaskScope({
      taskScope: context.taskScope,
      selectedNodeId: context.selectedNodeId,
      selectedNodeIds: context.selectedNodeIds
    });
    const scopedPathKey = (value) => {
      const raw = String(value || "").trim();
      if (!raw) return "";
      try {
        return path.resolve(raw).replace(/\\/g, "/").toLowerCase();
      } catch {
        return raw.replace(/\\/g, "/").toLowerCase();
      }
    };
    const scopedAssetFor = (items, selector = {}) => {
      const requestedBindingId = cleanOneLine(selector?.bindingId || "", 520);
      if (requestedBindingId) return items.find((item) => item.bindingId === requestedBindingId) || null;
      const requestedAssetId = cleanOneLine(selector?.assetId || "", 160);
      if (requestedAssetId) {
        const matches = items.filter((item) => item.assetId === requestedAssetId);
        if (matches.length > 1) throw new Error(`${toolName} assetId=${requestedAssetId} 对应多个槽位，请改用 sourceBindingId。`);
        return matches[0] || null;
      }
      const requestedPath = scopedPathKey(typeof selector === "string" ? selector : selector?.path || selector?.imagePath || selector?.file);
      if (requestedPath) return items.find((item) => scopedPathKey(item.path) === requestedPath) || null;
      return null;
    };
    const requestedParentId = String(args.parentId ?? "").trim();
    let parentId = requestedParentId || String(context.selectedNodeId ?? "").trim() || undefined;
    let logicalParentNode = parentId ? findWorkflowNode(context.nodes || [], parentId) : null;
    let sourceNode = requirementSourceForNode(context.nodes || [], logicalParentNode) || logicalParentNode;
    if (requestedParentId && !logicalParentNode) {
      throw new Error(`${toolName} parentId=${requestedParentId} 不存在于当前画布。`);
    }
    if (!requestedParentId && parentId && !logicalParentNode) {
      throw new Error(`${toolName} 当前选中的来源成果 ${parentId} 不存在于画布。`);
    }
    const sourceOperations = ["edit", "replace", "variants", "cutout", "redraw"];
    const requiresTaskSource = sourceOperations.includes(requestedOperation);
    if (taskScopePresent && requiresTaskSource && parentId && !taskScope.sourceNodeIds.includes(parentId)) {
      throw new Error(`${toolName} parentId=${parentId} 不属于本轮 SOURCE。`);
    }
    const hasMeaningfulSourceSelector = (value) => {
      if (typeof value === "string") return Boolean(value.trim());
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      return Boolean(cleanOneLine(
        value.bindingId || value.assetId || value.path || value.imagePath || value.file || "",
        520
      ));
    };
    // OpenAI-compatible strict tool bridges can materialize every optional
    // schema property. A text-only generate call may therefore contain an
    // empty sourceImage object with bindingId="". That is schema padding, not
    // a SOURCE request, and must not turn a valid generate into a scope error.
    const rawSourceSelector = requiresTaskSource
      ? [
          args.editImage,
          args.sourceImage,
          args.sourcePath,
          args.sourceBindingId ? { bindingId: args.sourceBindingId } : null,
          args.sourceAssetId ? { assetId: args.sourceAssetId } : null
        ].find(hasMeaningfulSourceSelector) || null
      : null;
    const explicitSourceAsset = taskScopePresent && rawSourceSelector ? scopedAssetFor(taskScope.sourceAssets, rawSourceSelector) : null;
    if (taskScopePresent && rawSourceSelector && !explicitSourceAsset) {
      throw new Error(`${toolName} 指定的 SOURCE 不属于 Current Task Scope，不能读取或上传任意本地路径。`);
    }
    if (!parentId && explicitSourceAsset?.nodeId) {
      parentId = explicitSourceAsset.nodeId;
      logicalParentNode = findWorkflowNode(context.nodes || [], parentId);
      sourceNode = requirementSourceForNode(context.nodes || [], logicalParentNode) || logicalParentNode;
    }
    if (!parentId && taskScope.sourceNodeIds.length === 1) {
      parentId = taskScope.sourceNodeIds[0];
      logicalParentNode = findWorkflowNode(context.nodes || [], parentId);
      sourceNode = requirementSourceForNode(context.nodes || [], logicalParentNode) || logicalParentNode;
    }
    const uniqueTaskSources = uniqueTaskAssets(taskScope.sourceAssets);
    const hasExplicitAssetIndex = requiresTaskSource && Object.prototype.hasOwnProperty.call(args, "assetIndex");
    const indexedSourceAsset = hasExplicitAssetIndex && taskScopePresent
      ? taskScopeSourceAt(taskScope, sourceNode?.id || parentId, args.assetIndex, toolName)
      : null;
    if (explicitSourceAsset && indexedSourceAsset && explicitSourceAsset.assetId !== indexedSourceAsset.assetId) {
      throw new Error(`${toolName} sourceAssetId 与 parentId + assetIndex 指向不同 SOURCE。`);
    }
    const resolvedSourceAsset = explicitSourceAsset || indexedSourceAsset;
    validateImageOperationSourcePolicy(
      toolName,
      requestedOperation,
      taskScopePresent ? uniqueTaskSources.length : 0,
      taskScope.resultPolicy
    );
    if (taskScopePresent && requiresTaskSource && uniqueTaskSources.length > 1 && !resolvedSourceAsset) {
      throw new Error(`${toolName} 当前有 ${uniqueTaskSources.length} 个 SOURCE；请先明确选择一张原图，批量 SOURCE 任务需要逐项绑定后再执行。`);
    }
    const scopedSourceAsset = resolvedSourceAsset || uniqueTaskSources[0] || null;
    if (sourceNode?.id && scopedSourceAsset?.nodeId && scopedSourceAsset.nodeId !== sourceNode.id) {
      throw new Error(`${toolName} SOURCE ${scopedSourceAsset.displayCode || scopedSourceAsset.assetId} 不属于 parentId=${parentId}。`);
    }
    if (!parentId && scopedSourceAsset?.nodeId) {
      parentId = scopedSourceAsset.nodeId;
      logicalParentNode = findWorkflowNode(context.nodes || [], parentId);
      sourceNode = requirementSourceForNode(context.nodes || [], logicalParentNode) || logicalParentNode;
    }
    const scopedSourceIndex = scopedSourceAsset ? taskSourceIndexInNode(scopedSourceAsset, sourceNode) : -1;
    if (taskScopePresent && requiresTaskSource && scopedSourceAsset?.nodeId && scopedSourceIndex < 0) {
      throw new Error(`${toolName} SOURCE ${scopedSourceAsset.displayCode || scopedSourceAsset.assetId} 已不在 parentId=${parentId} 的原始槽位中。`);
    }
    const layerHint = normalizeLayerHint(args);
    const preferredModel = imageModelForTaskPreference({ ...args, mode, prompt }, settings, layerHint);
    const frame = normalizeImageToolFrame({ ...args, parentId, model: preferredModel || args.model, prompt }, settings);
    const size = frame.size;
    const quality = args.quality ?? settings?.imageQuality ?? "auto";
    const requestedReferenceValues = Array.isArray(args.referenceImages ?? args.references)
      ? (args.referenceImages ?? args.references)
      : (args.referenceImages ?? args.references) ? [args.referenceImages ?? args.references] : [];
    let scopedReferenceValues = requestedReferenceValues;
    if (taskScopePresent) {
      scopedReferenceValues = requestedReferenceValues.length
        ? requestedReferenceValues.map((requested) => {
            const scoped = scopedAssetFor(taskScope.referenceAssets, requested);
            if (!scoped) throw new Error(`${toolName} 指定的 REFERENCE 不属于 Current Task Scope。`);
            const requestedRole = cleanOneLine(requested?.role || scoped.referenceRole || "", 80).toLowerCase();
            if (["source", "edit_target"].includes(requestedRole)) {
              throw new Error(`${toolName} REFERENCE 不能使用 ${requestedRole} 角色，也不能替代 SOURCE。`);
            }
            return {
              ...scoped,
              role: requestedRole || undefined,
              purpose: cleanOneLine(requested?.purpose || scoped.purpose || "", 320) || undefined
            };
          })
        : taskScope.referenceAssets.map((item) => ({ ...item, role: item.referenceRole || undefined }));
    }
    let referenceImages = normalizeReferenceImages(scopedReferenceValues, 9);
    if (!referenceImages.length && !taskScopePresent) referenceImages = normalizeReferenceImages(context.referenceImages, 9);
    const selectedSourceImage = referenceImageFromNodeExact(sourceNode, scopedSourceIndex >= 0 ? scopedSourceIndex : args.assetIndex ?? 0);
    const scopedSourceImage = normalizeReferenceImage(scopedSourceAsset, "source.png");
    const explicitLegacySourceImage = taskScopePresent ? null : normalizeReferenceImage(rawSourceSelector, "source.png");
    const editImage = explicitLegacySourceImage ||
      (["edit", "replace", "variants", "cutout", "redraw"].includes(requestedOperation)
        ? taskScopePresent ? scopedSourceImage : selectedSourceImage || scopedSourceImage
        : null);
    const editPathKey = scopedPathKey(editImage?.path);
    if (editPathKey) referenceImages = referenceImages.filter((image) => scopedPathKey(image.path) !== editPathKey);
    const maskImage = normalizeReferenceImage(args.maskImage ?? args.maskPath, "mask.png");
    const maskDataUrl = /^data:image\//i.test(String(args.maskDataUrl ?? "")) ? String(args.maskDataUrl) : "";
    const imageControls = requestedOperation === "cutout"
      ? { ...applyLayerPreferredImageControls(normalizeOptionalImageControls(args), layerHint), outputFormat: "png", background: "transparent" }
      : applyLayerPreferredImageControls(normalizeOptionalImageControls(args), layerHint);
    const needsSource = Boolean(maskImage || maskDataUrl || mode === "cutout" || mode === "redraw");
    if (needsSource && !editImage) {
      throw new Error(`${toolName} 需要有效的源图路径 sourceImage/sourcePath/editImage。`);
    }
    if (mode === "redraw" && !maskImage && !maskDataUrl) {
      throw new Error(`${toolName} 需要 maskImage/maskPath/maskDataUrl。`);
    }
    if (["edit", "replace", "variants"].includes(requestedOperation) && taskScopePresent && !editImage) {
      throw new Error(`${toolName} operation=${requestedOperation} 缺少需要处理的原图；REFERENCE 只能作为参考，不能替代 SOURCE。`);
    }
    if (["edit", "replace", "variants"].includes(requestedOperation) && !editImage && referenceImages.length === 0) {
      throw new Error(`${toolName} operation=${requestedOperation} 缺少来源图片。请先选择画布图片或添加参考图。`);
    }
    const {
      layerPlan: _discardedLayerPlan,
      layer_plan: _discardedSnakeLayerPlan,
      ...nonLayerArgs
    } = args;
    return {
      ...nonLayerArgs,
      // Keep the model's raw schema field out of downstream progress and execution.
      // batchItems is the single sanitized source of truth from this point onward.
      items: undefined,
      operation: requestedOperation,
      parentId,
      assetIndex: scopedSourceIndex >= 0 ? scopedSourceIndex : nonLayerArgs.assetIndex,
      model: preferredModel || args.model,
      mode,
      prompt,
      count,
      generationMode,
      collectionKind: count > 1 ? (generationMode === "sequential" ? "series" : "batch") : undefined,
      batchItems: normalizedBatchItems,
      size,
      ratio: frame.ratio,
      resolution: frame.resolution,
      quality,
      referenceImages,
      editImage,
      maskImage,
      maskDataUrl,
      relationType: requestedOperation === "variants" ? "variant" : "derived-from",
      taskProvenance: imageTaskProvenance(taskScopePresent ? taskScope : null, scopedSourceAsset),
      ...imageControls,
      ...layerHint,
      ...(requestedOperation === "cutout" ? {
        layerId: layerHint.layerId || "cutout",
        layerRole: layerHint.layerRole || "cutout",
        transparentPreferred: true
      } : {})
    };
  }

  async function callImageGeneration(args, settings, progress) {
    const mode = args.mode || "generate";
    const prompt = stripPastedBlockMarkers(args.prompt ?? "");
    const count = Math.max(1, Math.min(Number(args.count ?? 1), 10));
    const layerHint = normalizeLayerHint(args);
    const preferredModel = imageModelForTaskPreference({ ...args, mode, prompt }, settings, layerHint);
    const frame = normalizeImageToolFrame({ ...args, model: preferredModel || args.model, prompt }, settings);
    const size = frame.size;
    const requestSize = frame.requestSize || size;
    const quality = args.quality ?? settings?.imageQuality ?? "auto";
    const referenceImages = normalizeReferenceImages(args.referenceImages ?? args.references, 9);
    const editImage = normalizeReferenceImage(args.editImage ?? args.sourceImage ?? args.sourcePath, "source.png");
    const maskImage = normalizeReferenceImage(args.maskImage ?? args.maskPath, "mask.png");
    const maskDataUrl = /^data:image\//i.test(String(args.maskDataUrl ?? "")) ? String(args.maskDataUrl) : "";
    const imageControls = applyLayerPreferredImageControls(normalizeOptionalImageControls(args), layerHint);
    const editRequested = Boolean(editImage || referenceImages.length > 0 || maskImage || maskDataUrl || mode === "edit" || mode === "cutout" || mode === "redraw");
    const executionMode = args.generationMode === "sequential" ? "sequential" : "parallel";

    if (Array.isArray(args.batchItems) && args.batchItems.length > 1) {
      const batchItems = args.batchItems.slice(0, 10);
      const settled = await Promise.allSettled(batchItems.map((item, index) => callImageGeneration({
        ...args,
        ...item,
        items: undefined,
        batchItems: undefined,
        collectionKind: undefined,
        count: 1,
        runId: `${args.runId || `agent-${Date.now()}`}-item-${index + 1}`
      }, settings, progress)));
      const outputs = [];
      const items = settled.map((entry, index) => {
        const batchItem = batchItems[index];
        if (entry.status === "fulfilled" && entry.value?.outputs?.length) {
          const asset = {
            ...entry.value.outputs[0],
            index: outputs.length + 1,
            prompt: batchItem.prompt,
            title: batchItem.title || `方案 ${index + 1}`,
            status: "done"
          };
          outputs.push(asset);
          return {
            id: `item-${index + 1}`,
            requestIndex: index + 1,
            assetIndex: outputs.length,
            prompt: batchItem.prompt,
            title: batchItem.title || `方案 ${index + 1}`,
            status: "done"
          };
        }
        const error = cleanOneLine(entry.status === "rejected" ? entry.reason?.message || String(entry.reason) : "没有返回图片。", 260);
        return {
          id: `item-${index + 1}`,
          requestIndex: index + 1,
          assetIndex: undefined,
          prompt: batchItem.prompt,
          title: batchItem.title || `方案 ${index + 1}`,
          status: "error",
          error
        };
      });
      if (!outputs.length) throw new Error(items.find((item) => item.error)?.error || "批量图片生成失败。");
      const firstSuccess = settled.find((entry) => entry.status === "fulfilled")?.value || {};
      return {
        dryRun: settled.every((entry) => entry.status === "fulfilled" && entry.value?.dryRun),
        model: firstSuccess.model || preferredModel || args.model || settings.imageModel || "server-selected-image-model",
        size: firstSuccess.size || size,
        ratio: frame.ratio,
        resolution: frame.resolution,
        quality: firstSuccess.quality || quality,
        count: batchItems.length,
        prompt,
        outputs,
        items,
        executionMode: "parallel",
        returned: outputs.length,
        failed: items.filter((item) => item.status === "error").length,
        errors: items.filter((item) => item.error).map((item, index) => `${item.title || `方案 ${index + 1}`}：${item.error}`),
        referenceImageCount: referenceImages.length,
        referenceImageDescriptors: referenceImageDescriptors(referenceImages),
        editImage: Boolean(editImage),
        maskImage: Boolean(maskImage || maskDataUrl),
        outputFormat: firstSuccess.outputFormat || imageControls.outputFormat || "png",
        outputCompression: firstSuccess.outputCompression ?? imageControls.outputCompression,
        background: firstSuccess.background ?? imageControls.background,
        moderation: firstSuccess.moderation ?? imageControls.moderation,
        inputFidelity: firstSuccess.inputFidelity ?? imageControls.inputFidelity,
        mode: editRequested ? mode : "generate",
        costCents: settled.reduce((total, entry) => total + (entry.status === "fulfilled" ? Number(entry.value?.costCents || 0) : 0), 0),
        summary: items.some((item) => item.status === "error")
          ? `批量任务返回 ${outputs.length}/${batchItems.length} 张图片。`
          : `批量任务已并行返回 ${outputs.length} 张不同提示词图片。`
      };
    }

    if (typeof runtimeOptions.serverGenerateImage === "function") {
      const requestCount = Math.max(1, count);
      const requests = Array.from({ length: requestCount }, (_item, index) => {
        const runId = `${args.runId || `agent-${Date.now()}`}-${index + 1}`;
        const requestPrompt = prompt;
        return {
          index,
          runId,
          prompt: requestPrompt,
          run: () => runtimeOptions.serverGenerateImage({
            prompt: requestPrompt,
            model: preferredModel ?? args.model ?? settings?.imageModel,
            size: requestSize,
            quality,
            count: 1,
            referenceImages,
            editImage,
            maskImage,
            maskDataUrl,
            outputFormat: imageControls.outputFormat,
            outputCompression: imageControls.outputCompression,
            background: imageControls.background,
            moderation: imageControls.moderation,
            inputFidelity: imageControls.inputFidelity,
            layerId: layerHint.layerId,
            layerRole: layerHint.layerRole,
            layerGroupId: layerHint.layerGroupId,
            transparentPreferred: layerHint.transparentPreferred,
            layerOutputMode: String(args.layerOutputMode || "").trim() || undefined,
            mode: editRequested ? mode : "generate",
            projectId: args.projectId,
            runId,
            onRetry: (retry) => progress?.({
              phase: "image-retry",
              tool: primaryImageToolName,
              operationId: String(args.operationId || args.toolRunId || args.runId || runId),
              toolRunId: String(args.operationId || args.toolRunId || args.runId || runId),
              childTaskId: runId,
              summary: retry?.category === "timeout"
                ? `图片请求超时，正在进行唯一一次补试。`
                : `图片服务暂时不稳定，正在重试 ${retry?.retryCount || 1}/${retry?.maxRetries || 5}。`,
              detail: `第 ${Number(retry?.index || 0) + 1}/${retry?.count || requestCount} 张 · ${retry?.category || "transient"}`,
              retryCount: retry?.retryCount,
              maxRetries: retry?.maxRetries,
              errorCategory: retry?.category
            })
          })
        };
      });
      const settled = executionMode === "sequential"
        ? await (async () => {
            const results = [];
            for (const request of requests) {
              try {
                results.push({ status: "fulfilled", value: await request.run() });
              } catch (reason) {
                results.push({ status: "rejected", reason });
              }
            }
            return results;
          })()
        : await Promise.allSettled(requests.map((request) => request.run()));
      const serverResults = settled.map((item, index) =>
        item.status === "fulfilled"
          ? item.value
          : {
              ok: false,
              runId: requests[index]?.runId,
              error: item.reason?.message || String(item.reason || "用户服务生图失败。")
            }
      );
      const successResults = serverResults.filter((item) => item?.ok);
      const failedResults = serverResults
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => !item?.ok);
      const serverResult = successResults[0] ?? serverResults[0];
      const rawAssets = serverResults.flatMap((item, requestIndex) =>
        item?.ok && Array.isArray(item.assets)
          ? item.assets.map((asset) => ({
              ...asset,
              prompt: requests[requestIndex]?.prompt || prompt,
              title: requestCount > 1 ? `方案 ${requestIndex + 1}` : asset.title,
              index: requestIndex + 1,
              status: "done"
            }))
          : []
      ).map(imageAssetWithDimensions);
      const assets = await normalizeGeneratedAssetsToDeliveryFrame(rawAssets, size);
      const items = serverResults.map((item, requestIndex) => {
        const compactIndex = item?.ok ? assets.findIndex((asset) => Number(asset.index) === requestIndex + 1) : -1;
        return {
          id: `item-${requestIndex + 1}`,
          requestIndex: requestIndex + 1,
          assetIndex: compactIndex >= 0 ? compactIndex + 1 : undefined,
          prompt: requests[requestIndex]?.prompt || prompt,
          title: requestCount > 1 ? `方案 ${requestIndex + 1}` : undefined,
          status: item?.ok && compactIndex >= 0 ? "done" : "error",
          error: item?.ok && compactIndex >= 0 ? undefined : cleanOneLine(item?.error || "没有返回图片。", 260)
        };
      });
      if (!successResults.length) throw new Error(failedResults[0]?.item?.error || "用户服务生图失败。");
      if (serverResult && serverResult.ok) {
        return {
          dryRun: Boolean(serverResult.dryRun),
          model: serverResult.model ?? preferredModel ?? args.model ?? settings?.imageModel ?? "server-selected-image-model",
          size: actualImageSizeFromAssets(assets, size),
          sourceRequestSize: serverResult.size ?? requestSize,
          ratio: frame.ratio,
          resolution: frame.resolution,
          quality: serverResult.quality ?? quality,
          count,
          prompt,
          outputs: assets.map((asset, index) => ({ ...asset, index: index + 1 })),
          items,
          executionMode,
          returned: assets.length,
          failed: failedResults.length,
          errors: failedResults.map(({ item, index }) => `第 ${index + 1}/${requestCount} 张：${item?.error || "生图失败。"}`),
          referenceImageCount: Number(serverResult.referenceImageCount ?? referenceImages.length),
          referenceImageDescriptors: referenceImageDescriptors(referenceImages),
          editImage: Boolean(serverResult.editImage ?? editImage),
          maskImage: Boolean(serverResult.maskImage ?? maskImage ?? maskDataUrl),
          outputFormat: serverResult.outputFormat ?? imageControls.outputFormat ?? "png",
          outputCompression: serverResult.outputCompression ?? imageControls.outputCompression,
          background: serverResult.background ?? imageControls.background,
          moderation: serverResult.moderation ?? imageControls.moderation,
          inputFidelity: serverResult.inputFidelity ?? imageControls.inputFidelity,
          ...layerHint,
          mode: editRequested ? mode : "generate",
          costCents: serverResults.reduce((total, item) => total + Number(item.costCents ?? 0), 0),
          summary: serverResult.dryRun
            ? "服务端 dry-run 已记录生图任务。"
            : failedResults.length
              ? `用户服务已返回 ${assets.length} 个结果，${failedResults.length} 张失败。`
              : `用户服务已并行返回 ${assets.length} 个结果。`
        };
      }
      throw new Error(serverResult?.error || "用户服务生图失败。");
    }

    const config = providerSettings(settings, "image");
    const apiKey = String(config.apiKey ?? "").trim();
    const configuredModel = String(config.model ?? "").trim();
    const requestedModel = String(preferredModel ?? args.model ?? "").trim();
    const model = requestedModel || configuredModel || "gpt-image-2";

    if (!apiKey) {
      return {
        dryRun: true,
        model,
        size,
        sourceRequestSize: requestSize,
        ratio: frame.ratio,
        resolution: frame.resolution,
        quality,
        count,
        prompt,
        outputs: [],
        referenceImageCount: referenceImages.length,
        referenceImageDescriptors: referenceImageDescriptors(referenceImages),
        editImage: Boolean(editImage),
        maskImage: Boolean(maskImage || maskDataUrl),
        outputFormat: imageControls.outputFormat ?? "png",
        outputCompression: imageControls.outputCompression,
        background: imageControls.background,
        moderation: imageControls.moderation,
        inputFidelity: imageControls.inputFidelity,
        ...layerHint,
        mode: editRequested ? mode : "generate",
        summary: "Image API key 未配置，已记录生图任务但未发起请求。"
      };
    }

    const resolvedMask =
      editRequested && !maskImage && maskDataUrl
        ? writeDataUrlTemp(projectRoot, maskDataUrl, `mask-${compactDateKey(dateKey())}-${String(Date.now()).slice(-8)}`)
        : maskImage;

    async function requestSingleImage(index) {
      if (editRequested) {
        return callImageEditUpstreamDirect(config, {
          prompt,
          model,
          size: requestSize,
          quality,
          count: 1,
          referenceImages,
          editImage,
          maskImage: resolvedMask,
          outputFormat: imageControls.outputFormat,
          outputCompression: imageControls.outputCompression,
          background: imageControls.background,
          moderation: imageControls.moderation,
          inputFidelity: imageControls.inputFidelity
        });
      }

      const endpoint = normalizeApiUrl(config.baseUrl, "/images/generations");
      const body = {
        model,
        prompt,
        size: requestSize,
        quality,
        n: 1
      };
      if (!isGptImageModel(model)) body.response_format = "b64_json";
      if (imageControls.outputFormat) body.output_format = imageControls.outputFormat;
      if (imageControls.outputCompression !== undefined) body.output_compression = imageControls.outputCompression;
      if (imageControls.background) body.background = imageControls.background;
      if (imageControls.moderation) body.moderation = imageControls.moderation;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`image_gen generate ${response.status} 第 ${index + 1}/${count} 张: ${text.slice(0, 480)}`);
      }

      return response.json();
    }

    const settled = executionMode === "sequential"
      ? await (async () => {
          const results = [];
          for (let index = 0; index < count; index += 1) {
            try {
              results.push({ status: "fulfilled", value: await requestSingleImage(index) });
            } catch (reason) {
              results.push({ status: "rejected", reason });
            }
          }
          return results;
        })()
      : await Promise.allSettled(Array.from({ length: count }, (_item, index) => requestSingleImage(index)));
    const successfulResponses = settled
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.status === "fulfilled")
      .map(({ item, index }) => ({ response: item.value, index }));
    const responses = successfulResponses.map((item) => item.response);
    const failed = settled
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.status === "rejected");
    if (!responses.length) {
      const firstError = failed[0]?.item;
      throw new Error(firstError && firstError.status === "rejected" ? firstError.reason?.message || String(firstError.reason) : "Image API 生图失败。");
    }
    const imageEntries = successfulResponses.flatMap(({ response, index }) =>
      extractGeneratedImages(response).map((image) => ({ image, index, prompt }))
    );
    const images = imageEntries.map((entry) => entry.image);
    const stem = `image-${compactDateKey(dateKey())}-${String(Date.now()).slice(-8)}`;
    const rawOutputs = writeImageOutputs(projectRoot, images, stem, imageControls.outputFormat ?? "png").map((asset, outputIndex) => ({
      ...asset,
      prompt: imageEntries[outputIndex]?.prompt || prompt,
      title: count > 1 ? `方案 ${(imageEntries[outputIndex]?.index ?? outputIndex) + 1}` : asset.title,
      index: (imageEntries[outputIndex]?.index ?? outputIndex) + 1,
      status: "done"
    }));
    const outputs = await normalizeGeneratedAssetsToDeliveryFrame(rawOutputs, size);
    const items = settled.map((item, index) => {
      const compactIndex = item.status === "fulfilled" ? outputs.findIndex((asset) => Number(asset.index) === index + 1) : -1;
      return {
        id: `item-${index + 1}`,
        requestIndex: index + 1,
        assetIndex: compactIndex >= 0 ? compactIndex + 1 : undefined,
        prompt,
        title: count > 1 ? `方案 ${index + 1}` : undefined,
        status: item.status === "fulfilled" && compactIndex >= 0 ? "done" : "error",
        error: item.status === "rejected"
          ? cleanOneLine(item.reason?.message || String(item.reason), 260)
          : compactIndex < 0 ? "没有返回图片。" : undefined
      };
    });
    return {
      dryRun: false,
      model,
      size: actualImageSizeFromAssets(outputs, size),
      sourceRequestSize: requestSize,
      ratio: frame.ratio,
      resolution: frame.resolution,
      quality,
      count,
      prompt,
      outputs,
      items,
      executionMode,
      returned: outputs.length,
      failed: failed.length,
      errors: failed.map(({ item, index }) => `第 ${index + 1}/${count} 张：${item.status === "rejected" ? item.reason?.message || String(item.reason) : "生图失败。"}`),
      referenceImageCount: referenceImages.length,
      referenceImageDescriptors: referenceImageDescriptors(referenceImages),
      editImage: Boolean(editImage),
      maskImage: Boolean(maskImage || maskDataUrl),
      outputFormat: imageControls.outputFormat ?? "png",
      outputCompression: imageControls.outputCompression,
      background: imageControls.background,
      moderation: imageControls.moderation,
      inputFidelity: imageControls.inputFidelity,
      ...layerHint,
      mode: editRequested ? mode : "generate",
      summary: failed.length ? `Image API 已返回 ${outputs.length} 个结果，${failed.length} 张失败。` : `Image API 已返回 ${outputs.length} 个结果。`
    };
  }

  async function runLayeredImageGeneration(args, context = {}) {
    const settings = context.settings || {};
    const prompt = stripPastedBlockMarkers(args.prompt || "");
    if (!prompt) throw new Error("image_gen operation=layers 缺少完整画面要求。");
    validateImageFrameFields(args, "image_gen operation=layers");
    const plan = normalizeLayerPlan(args);
    const resumeLayerGroupId = String(args.resumeLayerGroupId || "").trim();
    const retryLayerIds = [...new Set((Array.isArray(args.retryLayerIds) ? args.retryLayerIds : []).map((value) => String(value || "").trim()).filter(Boolean))];
    const retryLayerSet = new Set(resumeLayerGroupId ? retryLayerIds : plan.map((layer) => layer.id));
    const resumeLayerNodes = resumeLayerGroupId
      ? (Array.isArray(context.nodes) ? context.nodes : []).filter((node) => node?.layerGroup?.id === resumeLayerGroupId)
      : [];
    const recovery = resumeLayerNodes.find((node) => node?.layerGroup?.recovery)?.layerGroup?.recovery || null;
    const resumeNodeByLayerId = new Map(resumeLayerNodes.map((node) => [String(node.layerGroup?.layerId || ""), node]));
    const missingTextLayers = plan.filter((layer) => layer.role === "text" && !String(layer.text || "").trim());
    if (missingTextLayers.length) {
      throw new Error(`image_gen operation=layers 的文字图层必须提供 text 正文：${missingTextLayers.map((layer) => layer.title).join("、")}。`);
    }
    const parentId = String(args.parentId || "").trim();
    if (parentId && !findWorkflowNode(context.nodes || [], parentId)) {
      throw new Error(`image_gen parentId=${parentId} 不存在于当前画布。`);
    }
    const frame = normalizeImageToolFrame(args, settings);
    const groupId = resumeLayerGroupId || `layers-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const groupNumber = resumeLayerNodes[0]?.layerGroup?.groupNumber || Math.max(
      0,
      ...(Array.isArray(context.nodes) ? context.nodes : [])
        .map((node) => Number(node?.layerGroup?.groupNumber ?? node?.layerComposition?.groupNumber ?? 0))
        .filter(Number.isFinite)
    ) + 1;
    if (resumeLayerGroupId) {
      const successfulLayerIds = new Set(recovery?.successfulLayerIds || []);
      const invalidReusable = plan.filter((layer) => !retryLayerSet.has(layer.id) && !successfulLayerIds.has(layer.id));
      if (invalidReusable.length) throw new Error(`分层恢复只能复用 successful 图层：${invalidReusable.map((layer) => layer.title).join("、")}。`);
      const missingReusable = plan.filter((layer) => !retryLayerSet.has(layer.id) && !(resumeNodeByLayerId.get(layer.id)?.assets || []).length);
      if (missingReusable.length) throw new Error(`分层恢复缺少可复用成功层：${missingReusable.map((layer) => layer.title).join("、")}。`);
    }
    const parentNode = findWorkflowNode(context.nodes || [], parentId);
    const parentReference = normalizeReferenceImage(args.sourceImage ?? args.sourcePath, "source.png") || referenceImageFromNode(parentNode, args.assetIndex ?? 0);
    const incomingReferences = normalizeReferenceImages(args.referenceImages ?? args.references ?? context.referenceImages, 9);
    const seenReferencePaths = new Set();
    const userReferences = normalizeReferenceImages([parentReference, ...incomingReferences], 18)
      .filter((item) => {
        const key = String(item.path || "").trim().toLowerCase();
        if (!key || seenReferencePaths.has(key)) return false;
        seenReferencePaths.add(key);
        return true;
      })
      .slice(0, 9);
    const layerManifest = plan.map((layer, index) =>
      `${index + 1}. ${layer.title}（${layer.role}）：${layer.prompt}${layer.text ? `；实际文字「${layer.text}」` : ""}`
    ).join("\n");
    const previewPrompt = [
      prompt,
      `最终交付画幅为 ${frame.ratio}（${frame.size}）。所有主体、文字和关键元素必须完整位于中心安全区，四周保留适度可裁切余量。`,
      "先生成最终完整合成预览。构图必须清楚、主体完整、各元素边界明确，方便随后按同一坐标拆分为 PNG 图层。",
      "完整分层清单如下，合成预览必须同时包含清单中的每一项，不能遗漏、替换或新增互相冲突的主体：",
      layerManifest,
      "只输出一张完整图片，不要拼图、分镜、图层说明文字或软件界面。"
    ].join("\n");
    const placeholderDimensions = parseImageSizeValue(frame.size) || { width: 1024, height: 1024 };
    const layerOperationId = context.operationId || context.toolRunId;

    context.progress?.({
      phase: "image-request",
      tool: primaryImageToolName,
      operationId: layerOperationId,
      toolRunId: layerOperationId,
      operation: "layers",
      brief: args.brief || "生成分层 PNG 和合成预览。",
      summary: resumeLayerGroupId
        ? `正在复用 ${plan.length - retryLayerSet.size} 个成功图层并定向重试 ${retryLayerSet.size} 层。`
        : `正在生成分层作品的合成预览和 ${plan.length} 个 PNG 图层。`,
      input: { ...args, layerPlan: plan },
      workflowAction: {
        type: "workflow.layer.placeholders",
        operationId: layerOperationId,
        toolRunId: layerOperationId,
        resumeLayerGroupId: resumeLayerGroupId || undefined,
        retryLayerIds: resumeLayerGroupId ? [...retryLayerSet] : undefined,
        parentId: parentId || undefined,
        node: {
          title: `分层 PNG：${shortTitle(prompt, 18)}`,
          prompt,
          nodeType: "image",
          ...(parentId ? { parentId, relationType: "derived-from" } : {}),
          status: "working",
          imageState: "generating",
          taskProvenance: args.taskProvenance,
          imageParams: {
            prompt,
            size: frame.size,
            ratio: frame.ratio,
            resolution: frame.resolution,
            count: plan.length,
            quality: args.quality || settings.imageQuality || "auto",
            batchMode: "parallel",
            referenceImages: userReferences,
            outputFormat: "png",
            background: "transparent",
            model: args.model || settings.imageModel,
            layerGroupId: groupId,
            transparentPreferred: true
          }
        },
        composition: {
          id: groupId,
          title: "分层 PNG",
          mode: "layer-stack",
          groupNumber,
          layout: "stacked",
          width: placeholderDimensions.width,
          height: placeholderDimensions.height,
          background: "transparent",
          layers: plan.map((layer, index) => ({
            id: layer.id,
            title: layer.title,
            prompt: layer.prompt,
            role: layer.role,
            groupId,
            order: index + 1,
            x: 0,
            y: 0,
            homeX: 0,
            homeY: 0,
            opacity: 1,
            visible: true,
            blendMode: "normal"
          })),
          createdAt: new Date().toISOString(),
          summary: `正在生成 ${plan.length} 个独立 PNG 图层。`
        }
      }
    });

    const resumedPreviewAsset = resumeLayerNodes.find((node) => node?.layerGroup?.previewAsset)?.layerGroup?.previewAsset || null;
    const preview = resumedPreviewAsset
      ? {
          outputs: [{ ...resumedPreviewAsset }],
          size: frame.size,
          ratio: frame.ratio,
          resolution: frame.resolution,
          quality: args.quality || settings.imageQuality || "auto",
          model: settings.imageModel
        }
      : await callImageGeneration({
          ...args,
          operation: "generate",
          mode: userReferences.length ? "edit" : "generate",
          prompt: previewPrompt,
          count: 1,
          size: frame.size,
          ratio: frame.ratio,
          resolution: frame.resolution,
          outputFormat: "png",
          background: "opaque",
          referenceImages: userReferences,
          operationId: context.operationId || context.toolRunId,
          toolRunId: context.operationId || context.toolRunId,
          runId: `${groupId}-preview`
        }, settings, context.progress);
    const previewAsset = preview.outputs?.[0] || null;
    if (!previewAsset) throw new Error("分层任务没有生成合成预览，已停止创建不完整图层组。");
    const previewReference = previewAsset ? normalizeReferenceImage(previewAsset, `${groupId}-preview.png`) : null;
    const generateLayer = async (layer, index, cleanBackgroundReference = null) => {
      const isBackground = layer.role === "background";
      const isDirectSemanticLayer = layer.role === "subject" || layer.role === "decoration";
      const foregroundSurfaceRequested = layer.role === "foreground" && /台面|桌面|地台|底座|平台|前景地面|地面|舞台|pedestal|tabletop|counter|ground\s*plane|foreground\s*surface|stage\s*floor/i.test(`${layer.title || ""} ${layer.prompt || ""}`);
      const semanticMaskContract = layer.role === "subject"
        ? "人物主体层必须逐像素只包含人物本体：皮肤、头发、发饰、服装以及属于人物自身的配饰。手持商品、独立道具、标题、装饰光效和背景全部保持纯黑。不要把人物外轮廓内部一并填白；头发空隙、手臂与身体之间、手指与商品之间以及衣袖周围能看见背景的孔洞必须保持黑色。"
        : layer.role === "decoration"
          ? "商品或独立道具层必须只包含该商品/道具本体及其明确附属挂件。人物的手指、手掌、皮肤和衣袖即使正在遮挡或握持商品，也必须保持黑色；不要扩大商品轮廓，不要把附近同色背景或光晕并入。"
          : layer.role === "text"
            ? "文字层必须覆盖预览中对应文字的每一笔实际字形及该文字自身明确配套的细线装饰，不得包含字形周围的底色矩形、背景渐变、人物、商品或其他装饰。文字内部真实镂空保持黑色，不能用外接矩形或整块白区代替字形。"
          : layer.role === "foreground"
              ? foregroundSurfaceRequested
                ? "前景层必须覆盖本层要求中明确写出的台面、地台、桌面或前景地面，以及同层薄雾、光轨、粒子等效果在合成预览中的全部可见像素。实体表面允许形成连续白色区域，但只能到其真实轮廓边界；人物、商品、文字、远景地面、天空和背景色块必须保持纯黑。"
                : "前景氛围层必须包含位于纯背景板之前、但不属于人物、商品和文字的可见光轨、粒子、花枝、薄雾、水花等效果；只标记这些效果自身的像素。不要把人物或商品剪影、文字残影、整片地面/天空纹理、背景色块填入蒙版。"
              : "只标记本图层要求中明确列出的可见像素；任何其他语义元素和背景孔洞都保持纯黑。";
      const directLayerContract = layer.role === "subject"
        ? "输出真正透明的完整人物 PNG 图层：只保留人物的皮肤、头发、发饰、服装与人物自身配饰。必须合理补全被商品、前景、文字或其他图层遮挡的身体与服装，使本图层单独查看时仍是完整人物；补全部分延续相邻结构、材质、光照和纹样，不得留下商品形状的透明洞。不要包含商品、独立道具、标题或底部说明文字、花枝、雾、水面、台面、地台、底座或任何背景板。"
        : "输出真正透明的完整商品/独立道具 PNG 图层：只保留该物件及其固有结构、材质、标签和挂件。透明或半透明材质必须重建为可独立移动的物件本体，不得把人物手指、手掌、皮肤、衣服、背景建筑、水面、花枝、台面、文字或其他图层烘焙进透明区域；被手指、人物或前景遮挡的物件边缘与结构需要合理补全。";
      const layerPrompt = [
        isDirectSemanticLayer
          ? "这是同坐标分层重建任务，不是重新设计任务。以提供的完整合成预览为构图、风格、比例和坐标基准，同时生成能独立查看和移动的完整目标图层。"
          : "这是分层提取任务，不是重新设计任务。以提供的完整合成预览为唯一构图、像素内容和坐标参考。",
        !isBackground && cleanBackgroundReference
          ? isDirectSemanticLayer
            ? "你还会收到一张同尺寸、同坐标的干净背景参考。用它识别并排除背景，但不要复制干净背景像素；目标被遮挡的部分应根据目标自身结构合理补全。"
            : "你还会收到一张与合成预览同尺寸、同坐标的干净背景参考。必须逐像素比较合成预览与干净背景，用差异定位真实前景；干净背景只用于排除背景、孔洞和被移除物体留下的区域，绝不能被画进白色目标蒙版。"
          : "",
        `原始设计要求：${prompt}`,
        `完整分层清单：\n${layerManifest}`,
        `本次只提取图层「${layer.title}」：${layer.prompt}${layer.text ? `；文字必须逐字绘制为「${layer.text}」` : ""}`,
        isBackground
          ? "生成完整画布尺寸的纯背景层，移除主体、前景、装饰和文字，并自然补全被遮挡的背景区域。背景必须不透明；不得改变预览的光线、透视、色调和空间结构。"
          : isDirectSemanticLayer
            ? "输出与合成预览完全相同画布尺寸的全彩 PNG，目标保持原坐标、比例、朝向、透视、光照与风格；目标外全部使用真实 alpha 透明，不要棋盘格、纯色底、阴影地台、描边框、图层名称或说明文字。"
            : "输出与合成预览完全相同画布尺寸的二值语义蒙版：目标图层在预览中占据的像素必须为纯白色，其他所有像素必须为纯黑色；边缘只允许少量灰度抗锯齿。不得输出原图颜色，不得重画、扩写、替换或新增主体，不得改变目标的坐标、比例、朝向和轮廓。",
        isBackground ? "" : isDirectSemanticLayer ? directLayerContract : semanticMaskContract,
        isBackground
          ? "不要输出棋盘格、描边框、图层名称、说明文字或多图拼接。"
          : isDirectSemanticLayer
            ? "只输出一个完整目标图层，不要多图拼接，不要把其他图层作为参照物留在画面中。"
            : "整张蒙版只能包含黑、白和边缘灰度，不要透明棋盘格、彩色内容、阴影地台、描边框、图层名称、说明文字或多图拼接。"
      ].join("\n");
      const generation = await callImageGeneration({
        ...args,
        operation: "edit",
        mode: previewReference ? "edit" : "generate",
        prompt: layerPrompt,
        count: 1,
        size: frame.size,
        ratio: frame.ratio,
        resolution: frame.resolution,
        outputFormat: "png",
        background: isDirectSemanticLayer ? "transparent" : "opaque",
        inputFidelity: "high",
        // The composed preview is the authoritative coordinate system for
        // both exact masks and reconstructed semantic layers. Send it through
        // the primary edit-image channel so Image2 preserves placement.
        editImage: previewReference,
        referenceImages: normalizeReferenceImages([cleanBackgroundReference, ...userReferences], 9),
        layerId: layer.id,
        layerRole: layer.role,
        layerGroupId: groupId,
        transparentPreferred: isDirectSemanticLayer,
        layerOutputMode: isBackground || isDirectSemanticLayer ? "direct" : "mask",
        operationId: context.operationId || context.toolRunId,
        toolRunId: context.operationId || context.toolRunId,
        runId: `${groupId}-${index + 1}-${layer.id}`
      }, settings, context.progress);
      const asset = generation.outputs?.[0] || null;
      if (!asset) throw new Error(`图层「${layer.title}」没有返回 PNG 资产。`);
      return { layer, generation, asset, index };
    };
    // The clean background is not just another independent layer. It is the
    // second, same-coordinate observation needed by Image2 to distinguish
    // background from reconstructed semantic layers and exact masks. Generate
    // it first, then keep the remaining layer requests parallel.
    const reuseLayer = (layer, index) => {
      const node = resumeNodeByLayerId.get(layer.id);
      const asset = node?.assets?.[0];
      if (!asset) throw new Error(`分层恢复找不到成功层「${layer.title}」的项目资产。`);
      return {
        layer,
        generation: {
          outputs: [{ ...asset }],
          size: frame.size,
          ratio: frame.ratio,
          resolution: frame.resolution,
          quality: args.quality || settings.imageQuality || "auto",
          model: settings.imageModel,
          layerOutputMode: "prepared"
        },
        asset: { ...asset },
        index,
        reused: true
      };
    };
    const settledLayers = new Array(plan.length);
    let backgroundLayerResult;
    try {
      backgroundLayerResult = retryLayerSet.has(plan[0].id)
        ? await generateLayer(plan[0], 0, null)
        : reuseLayer(plan[0], 0);
      settledLayers[0] = { status: "fulfilled", value: backgroundLayerResult };
    } catch (error) {
      settledLayers[0] = { status: "rejected", reason: error };
      throw new Error(`分层背景生成失败，已停止后续蒙版请求：${cleanOneLine(error instanceof Error ? error.message : String(error), 260)}`);
    }
    const cleanBackgroundReference = normalizeReferenceImage({
      ...backgroundLayerResult.asset,
      role: "clean-background",
      purpose: "与合成预览同尺寸同坐标的干净背景，仅用于逐像素排除背景并定位语义前景。"
    }, `${groupId}-clean-background.png`);
    if (!cleanBackgroundReference) throw new Error("分层背景资产无法作为后续语义蒙版参考。");
    // Layer masks are heavy edit requests that all carry the full preview and
    // clean-background references. Keep useful parallelism without opening
    // five or more long uploads against the same upstream connection at once;
    // overloaded relays commonly terminate one socket and force the Agent to
    // restart the entire layered job.
    for (let index = 1; index < plan.length; index += 1) {
      if (!retryLayerSet.has(plan[index].id)) settledLayers[index] = { status: "fulfilled", value: reuseLayer(plan[index], index) };
    }
    const remainingEntries = plan.map((layer, index) => ({ layer, index })).filter((entry) => entry.index > 0 && retryLayerSet.has(entry.layer.id));
    const layerConcurrency = 3;
    for (let offset = 0; offset < remainingEntries.length; offset += layerConcurrency) {
      const batch = remainingEntries.slice(offset, offset + layerConcurrency);
      const settledBatch = await Promise.allSettled(
        batch.map((entry) => generateLayer(entry.layer, entry.index, cleanBackgroundReference))
      );
      settledBatch.forEach((item, index) => {
        settledLayers[batch[index].index] = item;
      });
    }
    const successfulLayers = settledLayers
      .filter((item) => item.status === "fulfilled")
      .map((item) => item.value);
    const failedLayers = settledLayers
      .map((item, index) => ({ item, layer: plan[index] }))
      .filter(({ item }) => item.status === "rejected")
      .map(({ item, layer }) => ({
        layer,
        error: cleanOneLine(item.status === "rejected" ? item.reason?.message || String(item.reason) : "图层生成失败。", 260)
      }));
    const layerAssets = successfulLayers.filter((item) => item.asset);
    const dimensions = parseImageSizeValue(preview.size || frame.size) || { width: 1024, height: 1024 };
    if (failedLayers.length || layerAssets.length !== plan.length) {
      const detail = failedLayers.map((item) => `${item.layer.title}：${item.error}`).join("；");
      throw new Error(`分层任务未完整生成 ${plan.length} 个 PNG 图层，已停止创建不完整图层组。${detail ? ` ${detail}` : ""}`);
    }
    const actionToolRunId = String(context.operationId || context.toolRunId || `${groupId}-stack-run`);
    const actions = [{
      type: "workflow.layer.group",
      operationId: context.operationId || context.toolRunId,
      toolRunId: actionToolRunId,
      resumeLayerGroupId: resumeLayerGroupId || undefined,
      retryLayerIds: resumeLayerGroupId ? [...retryLayerSet] : undefined,
      node: {
        id: `${groupId}-stack`,
        title: `分层 PNG：${shortTitle(prompt, 18)}`,
        prompt: [
          `prompt: ${prompt}`,
          `tool: ${primaryImageToolName}`,
          "operation: layers",
          `layerGroupId: ${groupId}`,
          `layers: ${layerAssets.length}/${plan.length}`,
          ...failedLayers.map((item) => `error: ${item.layer.title}：${item.error}`)
        ].join("\n"),
        nodeType: "image",
        ...(parentId ? { parentId, relationType: "derived-from" } : {}),
        outputs: 0,
        assets: [],
        imageState: "generating",
        imageError: undefined,
        status: "working",
        taskProvenance: args.taskProvenance,
        imageParams: {
          prompt,
          size: preview.size || frame.size,
          ratio: preview.ratio || frame.ratio,
          resolution: preview.resolution || frame.resolution,
          count: 1,
          quality: preview.quality || args.quality || settings.imageQuality || "auto",
          batchMode: "parallel",
          referenceImages: userReferences,
          outputFormat: "png",
          background: "transparent",
          inputFidelity: userReferences.length ? "high" : undefined,
          model: preview.model,
          layerId: "stack",
          layerRole: "stack",
          layerGroupId: groupId,
          transparentPreferred: true
        },
        imageProgress: {
          total: plan.length,
          completed: 0,
          failed: 0,
          failedSlots: [],
          retryCount: 0,
          maxRetries: 0,
          stopped: false,
          message: `正在组装 ${layerAssets.length} 个 PNG 图层`
        },
        layerComposition: {
          id: `${groupId}-composition`,
          title: "分层 PNG",
          mode: "layer-stack",
          groupNumber,
          layout: "stacked",
          width: dimensions.width,
          height: dimensions.height,
          background: "transparent",
          previewAsset: previewAsset || undefined,
          layers: layerAssets.map(({ layer, asset, generation, index, reused }) => ({
            id: layer.id,
            title: layer.title,
            prompt: layer.prompt,
            role: layer.role,
            groupId,
            order: index + 1,
            asset,
            extractionMode: reused || generation?.layerOutputMode === "prepared"
              ? "prepared"
              : layer.role === "background" || layer.role === "subject" || layer.role === "decoration" ? "direct" : "mask-from-preview",
            x: 0,
            y: 0,
            homeX: 0,
            homeY: 0,
            scale: 1,
            opacity: 1,
            visible: true,
            blendMode: "normal"
          })),
          createdAt: new Date().toISOString(),
          summary: `已生成合成预览和 ${layerAssets.length} 个待客户端透明提取与重组校验的图层素材。`
        }
      }
    }];

    context.progress?.({
      phase: "image-response",
      tool: primaryImageToolName,
      operationId: context.operationId || context.toolRunId,
      toolRunId: context.operationId || context.toolRunId,
      operation: "layers",
      brief: args.brief || "生成分层 PNG 和合成预览。",
      summary: `分层素材已返回，正在进行本地透明提取、重组校验与画布提交。`,
      detail: "",
      workflowAction: actions[0]
    });
    for (const action of actions.slice(1)) {
      context.progress?.({
        phase: "workflow-action",
        tool: primaryImageToolName,
        toolRunId: action.toolRunId || groupId,
        internalOnly: true,
        workflowAction: action
      });
    }
    const layerReviewPaths = [previewAsset?.path, ...layerAssets.map(({ asset }) => asset?.path)]
      .filter(Boolean)
      .map(String)
      .filter((value, index, values) => values.indexOf(value) === index);
    return {
      actions,
      modelOutput: layerReviewPaths.length
        ? [
          "image_gen completed successfully.",
          "operation: layers",
          `returned_layers: ${layerAssets.length}`,
          "project-local output_paths ready for view_image:",
          ...layerReviewPaths.map((value) => `- ${value}`),
          "Use these paths directly. Do not call workflow or shell_command to locate generated files."
        ].join("\n")
        : undefined,
      result: [
        "IMAGE 分层素材已生成，等待客户端质量校验与画布提交。",
        `tool: ${primaryImageToolName}`,
        "operation: layers",
        `layerGroupId: ${groupId}`,
        `preview: ${preview.outputs?.length || 0}`,
        `layers: ${successfulLayers.length}/${plan.length}`,
        `layerNodes: ${layerAssets.length}`,
        "stackNode: no",
        "localCommit: pending",
        "recomposed: pending",
        "canvas: pending",
        failedLayers.length ? `failed: ${failedLayers.map((item) => item.layer.title).join(", ")}` : "",
        `prompt: ${prompt}`
      ].filter(Boolean).join("\n")
    };
  }

  async function runTool(name, input, context) {
    const args = parseJsonObject(input);
    if (!args.projectId && context?.projectId) args.projectId = context.projectId;
    if (!args.conversationId && context?.conversationId) args.conversationId = context.conversationId;
    const operation = String(args.operation || args.action || args.mode || "").trim();
    let result = "";
    let actions = [];
    let modelOutput;

    function directEnvelope(toolName, envelope) {
      const source = envelope && typeof envelope === "object" ? envelope : { ok: false, summary: String(envelope ?? "") };
      return {
        ...source,
        ok: source.ok !== false,
        tool: source.tool || toolName,
        entryId: source.entryId || source.entry_id,
        summary: source.summary || source.message || `${toolName} 已执行。`,
        visibleOutput: source.visibleOutput || safeJson(source)
      };
    }

    if (name === "shell_command" || name === "command") {
      const commandResult = await executeControlledCommand(args, projectRoot);
      return { envelope: storeToolResult(name, args, commandResult.text, commandResult), actions };
    } else if (name === primaryImageToolName && operation === "compose") {
      const draft = normalizeImagePromptDraft(args, {
        ratio: args.currentRatio,
        resolution: args.currentResolution,
        count: args.currentCount,
        quality: args.currentQuality
      });
      if (!draft) {
        throw new Error("image_gen operation=compose 缺少模型优化后的 prompt。");
      }
      result = [
        "IMAGE PROMPT 已由 Agent 模型整理，参数可直接应用到当前生图面板。",
        "",
        "```json",
        safeJson(draft),
        "```",
        "",
        "### 应用结果",
        `- 比例：${draft.ratio}`,
        `- 分辨率：${draft.resolution}`,
        `- 张数：${draft.count}`,
        `- 质量：${draft.quality}`,
        "",
        "### 提示词",
        draft.prompt
      ].join("\n");
    } else if (name === primaryImageToolName && operation === "layers") {
      const layered = await runLayeredImageGeneration(args, context);
      actions = layered.actions;
      result = layered.result;
      modelOutput = layered.modelOutput;
    } else if (name === primaryImageToolName && operation === "layer_merge") {
      const composition = normalizeLayerComposition(args);
      const currentToolRunId = String(args.toolRunId || args.runId || toolRunId(context, "layer-merge"));
      const parentId = String(args.parentId || composition.layers.find((layer) => layer.sourceNodeId)?.sourceNodeId || "").trim() || null;
      actions = [
        {
          type: "workflow.layer.merge",
          operationId: context.operationId || context.toolRunId || currentToolRunId,
          toolRunId: currentToolRunId,
          node: {
            title: composition.title || "图层合成",
            prompt: [
              `tool: ${primaryImageToolName}`,
              "operation: layer_merge",
              `compositionId: ${composition.id}`,
              `size: ${composition.width}x${composition.height}`,
              `background: ${composition.background}`,
              `layers: ${composition.layers.length}`,
              composition.summary ? `summary: ${composition.summary}` : "",
              ...composition.layers.map((layer, index) =>
                `layer ${index + 1}: ${layer.title || layer.id} · source=${layer.sourceNodeId || "asset"} · assetIndex=${layer.assetIndex ?? 1} · x=${layer.x ?? 0} · y=${layer.y ?? 0} · opacity=${layer.opacity ?? 1} · blend=${layer.blendMode ?? "normal"}`
              )
            ].filter(Boolean).join("\n"),
            nodeType: "image",
            parentId,
            outputs: 0,
            assets: [],
            imageState: "generating",
            status: "working",
            imageProgress: {
              total: Math.max(1, composition.layers.length),
              completed: 0,
              retryCount: 0,
              maxRetries: 0,
              stopped: false,
              message: `正在合成 ${composition.layers.length} 个图层`
            },
            layerComposition: composition
          }
        }
      ];
      result = [
        "IMAGE 图层合成任务已创建。",
        `tool: ${primaryImageToolName}`,
        "operation: layer_merge",
        `compositionId: ${composition.id}`,
        `size: ${composition.width}x${composition.height}`,
        `layers: ${composition.layers.length}`,
        `background: ${composition.background}`,
        composition.summary || ""
      ].filter(Boolean).join("\n");
    } else if (
      isImageToolName(name) &&
      ["redraw", "cutout"].includes(operation) &&
      !args.maskImage &&
      !args.maskPath &&
      !/^data:image\//i.test(String(args.maskDataUrl || ""))
    ) {
      const regionArgs = normalizeRegionEditorOpenArgs(name, args, context.settings ?? {}, context);
      const sourceId = String(regionArgs.parentId || context.selectedNodeId || "").trim();
      const sourceNode = findWorkflowNode(context.nodes || [], sourceId);
      const assetIndex = Math.max(0, Math.floor(Number(regionArgs.assetIndex ?? 0) || 0));
      const sourceImage = sourceNode ? referenceImageFromNodeExact(sourceNode, assetIndex) : null;
      if (!sourceNode || !sourceImage) {
        throw new Error(`${name} operation=${operation} 需要当前选中图片或有效 parentId，再由用户涂抹${operation === "cutout" ? "要保留的主体" : "需要修改的区域"}。`);
      }
      const regionPrompt = stripPastedBlockMarkers(regionArgs.prompt || "");
      const isCutout = operation === "cutout";
      actions = [{
        type: isCutout ? "workflow.node.cutout" : "workflow.node.redraw",
        id: sourceNode.id,
        kind: isCutout ? "cutout" : "repaint",
        assetIndex,
        ...(regionPrompt ? { prompt: regionPrompt } : {})
      }];
      result = [
        isCutout ? "IMAGE 已打开 AI 抠图选区。" : "IMAGE 已打开区域重绘蒙版。",
        `sourceNodeId: ${sourceNode.id}`,
        `assetIndex: ${assetIndex + 1}`,
        regionPrompt ? `prompt: ${regionPrompt}` : "",
        "status: waiting-for-mask"
      ].filter(Boolean).join("\n");
    } else if (isImageToolName(name)) {
      const toolArgs = args[normalizedImageToolArgsMarker]
        ? args
        : normalizeImageToolArgs(name, args, context.settings ?? {}, context);
      if (!toolArgs.projectId && context.projectId) toolArgs.projectId = context.projectId;
      const isGenerate = toolArgs.mode === "generate";
      const actionParentId = String(toolArgs.parentId || "").trim();
      const currentToolRunId = String(toolArgs.toolRunId || context.toolRunId || toolArgs.runId || toolRunId(context, "image-gen"));
      const toolLabel =
        toolArgs.operation === "variants"
          ? "多款设计"
          : toolArgs.operation === "replace"
            ? "元素替换"
        : toolArgs.mode === "cutout"
          ? "AI 抠图"
          : toolArgs.mode === "redraw"
            ? "AI 重绘"
            : toolArgs.mode === "edit"
              ? "图像编辑"
              : "生图";
      const layerLines = [
        toolArgs.layerId ? `layerId: ${toolArgs.layerId}` : "",
        toolArgs.layerRole ? `layerRole: ${toolArgs.layerRole}` : "",
        toolArgs.layerGroupId ? `layerGroupId: ${toolArgs.layerGroupId}` : "",
        toolArgs.transparentPreferred ? "transparentPreferred: yes" : ""
      ].filter(Boolean);
      const baseNodeTitlePrefix = toolArgs.mode === "cutout" ? toolLabel : toolArgs.layerRole ? `图层 ${toolArgs.layerRole}` : toolLabel;
      const sourceDisplayCode = cleanOneLine(toolArgs.taskProvenance?.sourceDisplayCode || "", 40);
      const nodeTitlePrefix = sourceDisplayCode ? `${sourceDisplayCode} · ${baseNodeTitlePrefix}` : baseNodeTitlePrefix;
      const collectionSeedItems = toolArgs.count > 1
        ? (Array.isArray(toolArgs.batchItems) && toolArgs.batchItems.length > 1
            ? toolArgs.batchItems.map((item, index) => ({
                id: `item-${index + 1}`,
                requestIndex: index + 1,
                assetIndex: undefined,
                prompt: item.prompt,
                title: item.title || `方案 ${index + 1}`
              }))
            : Array.from({ length: toolArgs.count }, (_item, index) => ({
                id: `item-${index + 1}`,
                requestIndex: index + 1,
                assetIndex: undefined,
                prompt: toolArgs.prompt,
                title: `方案 ${index + 1}`
              })))
        : [];
      context?.progress?.({
        phase: "image-request",
        tool: primaryImageToolName,
        summary: `${toolLabel}请求已发出，等待模型返回图片。`,
        detail: `model=${context?.settings?.imageModel ?? "configured"}`,
        brief: toolBriefFromArgs(primaryImageToolName, toolArgs),
        operation: toolOperationFromArgs(primaryImageToolName, toolArgs),
        params: toolParamsFromArgs(primaryImageToolName, toolArgs),
        input: toolArgs,
        operationId: currentToolRunId,
        toolRunId: currentToolRunId,
        workflowAction: {
          type: "workflow.node.create",
          operationId: currentToolRunId,
          toolRunId: currentToolRunId,
          node: {
            title: `${nodeTitlePrefix}：${shortTitle(toolArgs.prompt, 18)}`,
            prompt: [
              `prompt: ${toolArgs.prompt}`,
              `tool: ${primaryImageToolName}`,
              `operation: ${toolArgs.operation || toolArgs.mode || "generate"}`,
              `mode: ${toolArgs.mode ?? (isGenerate ? "generate" : "edit")}`,
              `model: ${toolArgs.model ?? context?.settings?.imageModel ?? ""}`,
              `ratio: ${toolArgs.ratio}`,
              `resolution: ${toolArgs.resolution}`,
              `size: ${toolArgs.size}`,
              `quality: ${toolArgs.quality}`,
              `count: ${toolArgs.count}`,
              `referenceImages: ${(toolArgs.referenceImages ?? []).length}`,
              `editImage: ${toolArgs.editImage ? "yes" : "no"}`,
              `maskImage: ${toolArgs.maskImage || toolArgs.maskDataUrl ? "yes" : "no"}`,
              ...layerLines
            ].join("\n"),
            nodeType: "image",
            parentId: actionParentId,
            ...(actionParentId ? { relationType: toolArgs.relationType || "derived-from" } : {}),
            outputs: 0,
            assets: [],
            imageState: "generating",
            status: "working",
            taskProvenance: toolArgs.taskProvenance,
            imageParams: {
              prompt: toolArgs.prompt,
              size: toolArgs.size,
              ratio: toolArgs.ratio,
              resolution: toolArgs.resolution,
              count: toolArgs.count,
              quality: toolArgs.quality,
              batchMode: toolArgs.generationMode || "parallel",
              referenceImages: toolArgs.referenceImages ?? [],
              outputFormat: toolArgs.outputFormat,
              outputCompression: toolArgs.outputCompression,
              background: toolArgs.background,
              moderation: toolArgs.moderation,
              inputFidelity: toolArgs.inputFidelity,
              model: toolArgs.model ?? context?.settings?.imageModel ?? "",
              layerId: toolArgs.layerId,
              layerRole: toolArgs.layerRole,
              layerGroupId: toolArgs.layerGroupId,
              transparentPreferred: toolArgs.transparentPreferred
            },
            ...(toolArgs.count > 1 ? {
              imageCollection: {
                id: `collection-${currentToolRunId}`,
                kind: toolArgs.collectionKind === "series" ? "series" : "batch",
                generationMode: toolArgs.generationMode || "parallel",
                sourceNodeId: actionParentId || undefined,
                createdAt: new Date().toISOString(),
                items: collectionSeedItems.map((item) => ({ ...item, status: "pending" }))
              }
            } : {})
          }
        }
      });
      let generation;
      try {
        generation = await callImageGeneration({
          ...toolArgs,
          operationId: context.operationId || currentToolRunId,
          toolRunId: currentToolRunId
        }, context.settings ?? {}, context.progress);
      } catch (error) {
        const message = cleanOneLine(error instanceof Error ? error.message : String(error), 260);
        context?.progress?.({
          phase: "image-error",
          tool: primaryImageToolName,
          summary: message,
          detail: "已停止，不自动重试。",
          brief: toolBriefFromArgs(primaryImageToolName, toolArgs),
          operation: toolOperationFromArgs(primaryImageToolName, toolArgs),
          params: toolParamsFromArgs(primaryImageToolName, toolArgs),
          input: toolArgs,
          operationId: currentToolRunId,
          toolRunId: currentToolRunId,
          workflowAction: {
            type: "workflow.node.create",
            operationId: currentToolRunId,
            toolRunId: currentToolRunId,
            node: {
              title: `${nodeTitlePrefix}失败：${shortTitle(toolArgs.prompt, 16)}`,
              prompt: [
                `prompt: ${toolArgs.prompt}`,
                `tool: ${primaryImageToolName}`,
                `operation: ${toolArgs.operation || toolArgs.mode || "generate"}`,
                `mode: ${toolArgs.mode ?? (isGenerate ? "generate" : "edit")}`,
                `model: ${toolArgs.model ?? context?.settings?.imageModel ?? ""}`,
                `ratio: ${toolArgs.ratio}`,
                `resolution: ${toolArgs.resolution}`,
                `size: ${toolArgs.size}`,
                `quality: ${toolArgs.quality}`,
                `count: ${toolArgs.count}`,
                `error: ${message}`,
                ...layerLines
              ].join("\n"),
              nodeType: "image",
              parentId: actionParentId,
              ...(actionParentId ? { relationType: toolArgs.relationType || "derived-from" } : {}),
              outputs: 0,
              assets: [],
              imageState: "error",
              imageError: message,
              status: "review",
              taskProvenance: toolArgs.taskProvenance,
              imageParams: {
                prompt: toolArgs.prompt,
                size: toolArgs.size,
                ratio: toolArgs.ratio,
                resolution: toolArgs.resolution,
                count: toolArgs.count,
                quality: toolArgs.quality,
                batchMode: toolArgs.generationMode || "parallel",
                referenceImages: toolArgs.referenceImages ?? [],
                outputFormat: toolArgs.outputFormat,
                outputCompression: toolArgs.outputCompression,
                background: toolArgs.background,
                moderation: toolArgs.moderation,
                inputFidelity: toolArgs.inputFidelity,
                model: toolArgs.model ?? context?.settings?.imageModel ?? "",
                layerId: toolArgs.layerId,
                layerRole: toolArgs.layerRole,
                layerGroupId: toolArgs.layerGroupId,
                transparentPreferred: toolArgs.transparentPreferred
              },
              imageProgress: {
                total: toolArgs.count,
                completed: 0,
                retryCount: 0,
                maxRetries: 0,
                stopped: true,
                message: "生图失败，已停止。可手动重试。"
              },
              ...(toolArgs.count > 1 ? {
                imageCollection: {
                  id: `collection-${currentToolRunId}`,
                  kind: toolArgs.collectionKind === "series" ? "series" : "batch",
                  generationMode: toolArgs.generationMode || "parallel",
                  sourceNodeId: actionParentId || undefined,
                  createdAt: new Date().toISOString(),
                  items: collectionSeedItems.map((item) => ({ ...item, status: "error", error: message }))
                }
              } : {})
            }
          }
        });
        throw error;
      }
      const completedOutputs = Array.isArray(generation.outputs) ? generation.outputs : [];
      const reviewPaths = completedOutputs
        .map((asset) => String(asset?.path || "").trim())
        .filter(Boolean);
      if (reviewPaths.length) {
        modelOutput = [
          "image_gen completed successfully.",
          `operation: ${toolArgs.operation || generation.mode || "generate"}`,
          `returned: ${generation.returned ?? reviewPaths.length}`,
          "project-local output_paths ready for view_image:",
          ...reviewPaths.map((value) => `- ${value}`),
          "The images are already synchronized to the canvas. Use these paths directly with view_image; do not call workflow or shell_command to locate generated files."
        ].join("\n");
      }
      const collectionItems = Array.isArray(generation.items)
        ? generation.items.slice(0, 10)
        : completedOutputs.map((asset, index) => ({
            id: `item-${index + 1}`,
            assetIndex: index + 1,
            requestIndex: Number(asset.index || index + 1),
            prompt: asset.prompt || asset.revisedPrompt || generation.prompt,
            title: asset.title || (completedOutputs.length > 1 ? `方案 ${index + 1}` : undefined),
            status: "done"
          }));
      const completedNode = (asset, index, total) => ({
        title: `${nodeTitlePrefix}：${shortTitle(asset?.prompt || generation.prompt, 18)}${total > 1 ? ` · ${index + 1}/${total}` : ""}`,
        prompt: [
          `prompt: ${asset?.prompt || generation.prompt}`,
          `tool: ${primaryImageToolName}`,
          `operation: ${toolArgs.operation || generation.mode || "generate"}`,
          `mode: ${generation.mode ?? (isGenerate ? "generate" : "edit")}`,
          `model: ${generation.model}`,
          `ratio: ${generation.ratio ?? toolArgs.ratio}`,
          `resolution: ${generation.resolution ?? toolArgs.resolution}`,
          `size: ${generation.size}`,
          `quality: ${generation.quality}`,
          `count: ${asset ? 1 : generation.count}`,
          `returned: ${asset ? 1 : generation.returned ?? 0}`,
          total > 1 ? `assetIndex: ${index + 1}/${total}` : "",
          generation.failed ? `failed: ${generation.failed}` : "",
          `referenceImages: ${generation.referenceImageCount ?? 0}`,
          `editImage: ${generation.editImage ? "yes" : "no"}`,
          `maskImage: ${generation.maskImage ? "yes" : "no"}`,
          `outputFormat: ${generation.outputFormat ?? "png"}`,
          generation.outputCompression !== undefined ? `outputCompression: ${generation.outputCompression}` : "",
          generation.background ? `background: ${generation.background}` : "",
          generation.moderation ? `moderation: ${generation.moderation}` : "",
          generation.inputFidelity ? `inputFidelity: ${generation.inputFidelity}` : "",
          ...layerLines,
          ...(generation.errors ?? []).map((error) => `error: ${error}`)
        ].filter(Boolean).join("\n"),
        nodeType: "image",
        parentId: actionParentId,
        ...(actionParentId ? { relationType: toolArgs.relationType || "derived-from" } : {}),
        outputs: asset ? 1 : generation.returned ?? 0,
        assets: asset ? [{
          ...asset,
          index: 1,
          prompt: asset.prompt || generation.prompt,
          title: sourceDisplayCode
            ? `${sourceDisplayCode} · ${asset.title || "成果"}`
            : asset.title
        }] : [],
        imageState: asset ? "done" : generation.returned > 0 ? "done" : "empty",
        imageError: asset ? undefined : generation.errors?.length ? generation.errors.slice(0, 3).join("；") : undefined,
        taskProvenance: toolArgs.taskProvenance,
        imageParams: {
          prompt: generation.prompt,
          size: generation.size,
          ratio: generation.ratio ?? toolArgs.ratio,
          resolution: generation.resolution ?? toolArgs.resolution,
          count: asset ? 1 : generation.count,
          quality: generation.quality,
          batchMode: toolArgs.generationMode || "parallel",
          referenceImages: toolArgs.referenceImages ?? [],
          outputFormat: generation.outputFormat ?? toolArgs.outputFormat,
          outputCompression: generation.outputCompression ?? toolArgs.outputCompression,
          background: generation.background ?? toolArgs.background,
          moderation: generation.moderation ?? toolArgs.moderation,
          inputFidelity: generation.inputFidelity ?? toolArgs.inputFidelity,
          model: generation.model,
          layerId: generation.layerId ?? toolArgs.layerId,
          layerRole: generation.layerRole ?? toolArgs.layerRole,
          layerGroupId: generation.layerGroupId ?? toolArgs.layerGroupId,
          transparentPreferred: generation.transparentPreferred ?? toolArgs.transparentPreferred
        },
        imageProgress: asset
          ? {
              total: 1,
              completed: 1,
              failed: 0,
              failedSlots: [],
              retryCount: 0,
              maxRetries: 0,
              stopped: false,
              message: total > 1 ? `批量结果 ${index + 1}/${total} 已完成` : "已完成 1/1 张"
            }
          : {
              total: generation.count,
              completed: generation.returned ?? 0,
              failed: generation.failed ?? 0,
              failedSlots: collectionItems
                .filter((item) => item.status === "error")
                .map((item, index) => clampNumber(item.requestIndex, 1, generation.count, index + 1)),
              retryCount: 0,
              maxRetries: 0,
              stopped: false,
              message: generation.failed
                ? `部分失败，已完成 ${generation.returned ?? 0}/${generation.count} 张`
                : `已完成 ${generation.returned ?? 0}/${generation.count} 张`
            }
      });
      const shouldGroupOutputs = Number(generation.count || toolArgs.count || 1) > 1 || completedOutputs.length > 1 || collectionItems.length > 1;
      if (shouldGroupOutputs) {
        const collectionKind = toolArgs.collectionKind === "series" ? "series" : "batch";
        const groupAssets = completedOutputs.map((asset, index) => {
          const collectionItem = collectionItems.find((item) => Number(item.assetIndex) === index + 1);
          return {
            ...asset,
            index: index + 1,
            prompt: asset.prompt || collectionItem?.prompt || generation.prompt,
            title: sourceDisplayCode
              ? `${sourceDisplayCode} · ${asset.title || collectionItem?.title || `方案 ${index + 1}`}`
              : asset.title || collectionItem?.title || `方案 ${index + 1}`,
            status: "done"
          };
        });
        const baseNode = completedNode(null, 0, Math.max(1, Number(generation.count || toolArgs.count || collectionItems.length)));
        actions = [{
          type: "workflow.node.create",
          operationId: currentToolRunId,
          toolRunId: currentToolRunId,
          node: {
            ...baseNode,
            title: `${collectionKind === "series" ? "连续系列" : "批量图片组"}：${shortTitle(generation.prompt, 18)}`,
            outputs: groupAssets.length,
            assets: groupAssets,
            imageState: groupAssets.length ? "done" : generation.failed ? "error" : "empty",
            imageCollection: {
              id: `collection-${currentToolRunId}`,
              kind: collectionKind,
              generationMode: generation.executionMode === "sequential" ? "sequential" : "parallel",
              sourceNodeId: actionParentId || undefined,
              createdAt: new Date().toISOString(),
              items: collectionItems.map((item, index) => {
                const compactAssetIndex = Number.isInteger(Number(item.assetIndex)) && Number(item.assetIndex) >= 1
                  ? clampNumber(item.assetIndex, 1, 10, 1)
                  : undefined;
                const boundAsset = compactAssetIndex === undefined ? undefined : groupAssets[compactAssetIndex - 1];
                return {
                  id: String(item.id || `item-${index + 1}`),
                  requestIndex: clampNumber(item.requestIndex, 1, 10, index + 1),
                  assetIndex: compactAssetIndex,
                  prompt: String(item.prompt || boundAsset?.prompt || generation.prompt),
                  title: item.title ? String(item.title) : boundAsset?.title,
                  status: item.status === "error" || item.status === "pending" ? item.status : "done",
                  error: item.error ? String(item.error) : undefined
                };
              })
            }
          }
        }];
      } else {
        const outputNodes = completedOutputs.length ? completedOutputs : [null];
        actions = outputNodes.map((asset, index) => ({
          type: "workflow.node.create",
          operationId: currentToolRunId,
          toolRunId: index === 0 ? currentToolRunId : `${currentToolRunId}-asset-${index + 1}`,
          node: completedNode(asset, index, completedOutputs.length || 1)
        }));
      }
      context?.progress?.({
        phase: generation.dryRun ? "image-dry-run" : "image-response",
        tool: primaryImageToolName,
        summary: generation.dryRun
          ? "Image API key 未配置，已记录 dry-run。"
          : generation.failed
            ? `Image API 已返回 ${generation.returned ?? 0} 张图片，${generation.failed} 张失败。`
            : `Image API 已返回 ${generation.returned ?? 0} 张图片。`,
        brief: toolBriefFromArgs(primaryImageToolName, toolArgs),
        operation: toolOperationFromArgs(primaryImageToolName, toolArgs),
        params: toolParamsFromArgs(primaryImageToolName, toolArgs),
        input: toolArgs,
        operationId: currentToolRunId,
        toolRunId: currentToolRunId,
        workflowAction: actions[0]
      });
      for (const action of actions.slice(1)) {
        context?.progress?.({
          phase: "workflow-action",
          tool: primaryImageToolName,
          toolRunId: action.toolRunId || currentToolRunId,
          internalOnly: true,
          workflowAction: action
        });
      }
      result = [
        generation.dryRun ? `IMAGE ${toolLabel}任务已创建（dry-run）。` : `IMAGE ${toolLabel}任务已执行。`,
        `tool: ${primaryImageToolName}`,
        `operation: ${toolArgs.operation || generation.mode || "generate"}`,
        `mode: ${generation.mode ?? (isGenerate ? "generate" : "edit")}`,
        `model: ${generation.model}`,
        `ratio: ${generation.ratio ?? toolArgs.ratio}`,
        `resolution: ${generation.resolution ?? toolArgs.resolution}`,
        `size: ${generation.size}`,
        `quality: ${generation.quality}`,
        `count: ${generation.count}`,
        `returned: ${generation.returned ?? 0}`,
        generation.failed ? `failed: ${generation.failed}` : "",
        `outputFormat: ${generation.outputFormat ?? "png"}`,
        generation.outputCompression !== undefined ? `outputCompression: ${generation.outputCompression}` : "",
        generation.background ? `background: ${generation.background}` : "",
        generation.moderation ? `moderation: ${generation.moderation}` : "",
        generation.inputFidelity ? `inputFidelity: ${generation.inputFidelity}` : "",
        ...layerLines,
        `prompt: ${generation.prompt}`,
        `references: ${(toolArgs.referenceImages ?? []).map((image) => image.path).join(", ")}`,
        `editImage: ${toolArgs.editImage?.path ?? "none"}`,
        `maskImage: ${toolArgs.maskImage?.path ?? (toolArgs.maskDataUrl ? "maskDataUrl" : "none")}`,
        generation.outputs?.length
          ? `outputs:\n${generation.outputs
              .map((output) => `- ${output.type === "file" ? output.path : output.url}${output.revisedPrompt ? ` | revised: ${output.revisedPrompt}` : ""}`)
              .join("\n")}`
          : "outputs: none",
        generation.summary
      ].filter(Boolean).join("\n");
    } else if (name === "ask_user") {
      const kind = ["clarify", "confirm", "source_images", "reference_images"].includes(String(args.kind || "")) ? String(args.kind) : "clarify";
      const title = String(args.title || (kind === "source_images" ? "添加原图" : kind === "reference_images" ? "添加参考图" : "需要你确认"));
      const question = String(args.question || args.detail || "请补充信息。").trim();
      const options = kind === "clarify" || kind === "confirm" ? normalizedAskUserOptions(args.options) : [];
      const requestId = String(args.toolRunId || args.runId || context?.toolRunId || context?.operationId || toolRunId(context, "ask-user"));
      actions = [
        {
          type: kind === "source_images" ? "ui.source_images.open" : kind === "reference_images" ? "ui.reference_images.open" : "ui.ask_user.open",
          operationId: requestId,
          toolRunId: requestId,
          request: {
            requestId,
            kind,
            title,
            question,
            detail: String(args.detail || ""),
            suggestedAnswer: String(args.suggestedAnswer || ""),
            options,
            maxSourceImages: clampNumber(args.maxSourceImages, 1, 40, 40),
            maxReferenceImages: clampNumber(args.maxReferenceImages, 1, 9, 9)
          }
        }
      ];
      result = [
        "ASK USER 已请求前端弹窗。",
        `kind: ${kind}`,
        `title: ${title}`,
        `question: ${question}`,
        options.length ? `options:\n${options.map((option) => `- ${option.id}: ${option.label}${option.recommended ? " (recommended)" : ""} -> ${option.answer}`).join("\n")}` : "",
        kind === "source_images"
          ? `maxSourceImages: ${actions[0].request.maxSourceImages}`
          : `maxReferenceImages: ${actions[0].request.maxReferenceImages}`
      ].join("\n");
    } else if (name === "view_image") {
      const requestedPath = String(args.path ?? args.imagePath ?? "").trim();
      const resolvedPath = path.resolve(projectRoot, requestedPath);
      let contextualImageRoots = [];
      if (typeof runtimeOptions.resolveImageRoots === "function") {
        try {
          const resolvedRoots = runtimeOptions.resolveImageRoots({ ...(context || {}), requestedPath: resolvedPath });
          if (Array.isArray(resolvedRoots)) contextualImageRoots = resolvedRoots;
        } catch (error) {
          log(`view_image contextual roots failed ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const allowedRoots = [
        ...(runtimeOptions.includeProjectRootImageRoot === false ? [] : [projectRoot]),
        ...(Array.isArray(runtimeOptions.imageRoots) ? runtimeOptions.imageRoots : []),
        ...contextualImageRoots
      ]
        .map((root) => path.resolve(String(root || "")))
        .filter(Boolean);
      const allowed = Boolean(requestedPath) && viewImagePathAllowed(resolvedPath, allowedRoots);
      if (!requestedPath || !allowed) {
        const text = `VIEW IMAGE 已拒绝。\nreason: 图片必须位于当前项目目录或项目图片库内。`;
        return { envelope: storeToolResult(name, args, text, { ok: false, error: "图片路径不在当前项目内。", errorCategory: "invalid_path", summary: "View Image 已拒绝项目外路径。" }), actions };
      }
      const info = imageInfo(resolvedPath);
      if (!info.exists) {
        const text = `VIEW IMAGE 失败。\npath: ${resolvedPath}\nerror: 图片不存在。`;
        return { envelope: storeToolResult(name, args, text, { ok: false, error: "图片不存在。", errorCategory: "missing_image", summary: "View Image 找不到图片。" }), actions };
      }
      if (info.bytes > 20 * 1024 * 1024) {
        const text = `VIEW IMAGE 失败。\npath: ${resolvedPath}\nerror: 图片超过 20MB 安全上限。`;
        return { envelope: storeToolResult(name, args, text, { ok: false, error: "图片超过 20MB。", errorCategory: "image_too_large", summary: "View Image 图片过大。" }), actions };
      }
      const detail = String(args.detail || "high").trim().toLowerCase();
      if (!["high", "original"].includes(detail)) {
        const text = `VIEW IMAGE 失败。\nerror: detail 只支持 high 或 original。`;
        return { envelope: storeToolResult(name, args, text, { ok: false, error: "detail 只支持 high 或 original。", errorCategory: "invalid_tool_arguments", summary: "View Image 参数无效。" }), actions };
      }
      const modelImage = await prepareViewImageModelPayload(
        resolvedPath,
        detail,
        context?.viewImagePayloadMaxBytes ?? viewImageModelPayloadMaxBytes
      );
      result = [
        "VIEW IMAGE 已把本地图片附加到当前模型上下文。",
        `path: ${resolvedPath}`,
        `format: ${info.format}`,
        `size: ${info.width ?? "unknown"}x${info.height ?? "unknown"}`,
        `modelSize: ${modelImage.width ?? "unknown"}x${modelImage.height ?? "unknown"}`,
        `modelPayload: ${Math.max(1, Math.round(modelImage.payloadBytes / 1024))}KB`,
        `detail: ${detail}`
      ].join("\n");
      return {
        envelope: storeToolResult(name, args, result, {
          summary: "View Image 已把图片放入当前模型上下文。",
          modelOutput: [{ type: "input_image", image_url: modelImage.dataUrl, detail }]
        }),
        actions
      };
    } else if (name === "workflow") {
      const operation = String(args.operation || "list_nodes");
      const nodes = canvasArtifacts(context);
      const rawNodeId = String(args.nodeId || args.id || "").trim();
      const rawNodeTitle = String(args.nodeTitle || "").trim();
      const selectedNode = findWorkflowNode(nodes, context.selectedNodeId);
      const selectedDefaultOperations = new Set(["describe_node", "focus_node", "update_node", "disconnect_node", "delete_node", "continue_node", "redraw_node", "cutout_node"]);
      const resolvedTargetNode =
        resolveWorkflowNodeReference(nodes, { id: rawNodeId, title: rawNodeTitle }) ||
        (!rawNodeId && !rawNodeTitle && selectedDefaultOperations.has(operation) ? selectedNode : null);
      const nodeId = resolvedTargetNode?.id || rawNodeId;
      const targetNode = resolvedTargetNode;
      const sourceNodeForConnection = resolveWorkflowNodeReference(nodes, { id: args.sourceId, title: args.sourceTitle });
      const targetNodeForConnection = resolveWorkflowNodeReference(nodes, { id: args.targetId, title: args.targetTitle });
      const sourceId = sourceNodeForConnection?.id || String(args.sourceId || "").trim();
      const targetId = targetNodeForConnection?.id || String(args.targetId || "").trim();
      const title = String(args.title || "").trim();
      const prompt = String(args.prompt || "").trim();
      const status = ["queued", "working", "review", "done"].includes(String(args.status || "")) ? String(args.status) : "";
      const assetIndex = Math.max(0, Number(args.assetIndex ?? 0) || 0);
      if (operation === "list_nodes") {
        const offset = Math.max(0, Math.floor(Number(args.offset ?? 0) || 0));
        const limit = Math.max(1, Math.min(100, Math.floor(Number(args.limit ?? 25) || 25)));
        const query = normalizeWorkflowTitle(args.query || "");
        const type = String(args.type || "").trim().toLowerCase();
        const relation = String(args.relation || "").trim().toLowerCase();
        const filteredNodes = nodes.filter((node) => {
          if (type && String(node.type || "").toLowerCase() !== type) return false;
          if (relation === "root" && node.parentId) return false;
          if (relation && relation !== "root" && (!node.parentId || String(node.relationType || "derived-from").toLowerCase() !== relation)) return false;
          if (!query) return true;
          const searchable = [
            node.id,
            node.title,
            node.prompt,
            node.imageParams?.prompt,
            node.parentId,
            node.relationType
          ].map((value) => normalizeWorkflowTitle(value)).join(" ");
          return searchable.includes(query);
        });
        const page = filteredNodes.slice(offset, offset + limit);
        const nextOffset = offset + page.length;
        result = [
          "ARTIFACT CANVAS 成果列表",
          `canvasTotal: ${nodes.length}`,
          `total: ${filteredNodes.length}`,
          `offset: ${offset}`,
          `limit: ${limit}`,
          `returned: ${page.length}`,
          `hasMore: ${nextOffset < filteredNodes.length}`,
          `nextOffset: ${nextOffset < filteredNodes.length ? nextOffset : "none"}`,
          page.length ? page.map(workflowNodeSummary).join("\n") : "暂无匹配成果。"
        ].join("\n");
      } else if (operation === "describe_node") {
        result = targetNode
          ? ["ARTIFACT CANVAS 成果详情", workflowNodeSummary(targetNode), targetNode.prompt ? `rawPrompt:\n${targetNode.prompt}` : ""].filter(Boolean).join("\n")
          : `ARTIFACT CANVAS 未找到成果。\nnodeId: ${nodeId}`;
      } else if (operation === "focus_node") {
        actions = [{ type: "workflow.node.focus", id: nodeId }];
        result = `ARTIFACT CANVAS 定位成果。\nnodeId: ${nodeId}${rawNodeTitle ? `\nnodeTitle: ${rawNodeTitle}` : ""}`;
      } else if (operation === "connect_nodes") {
        const relationType = ["derived-from", "referenced", "variant", "grouped"].includes(String(args.relationType || ""))
          ? String(args.relationType)
          : "derived-from";
        actions = [{ type: "workflow.node.connect", sourceId, targetId, relationType }];
        result = `ARTIFACT CANVAS 关联成果。\n${sourceId || ""} -> ${targetId || ""}\nrelation: ${relationType}${args.sourceTitle || args.targetTitle ? `\nsourceTitle: ${args.sourceTitle || ""}\ntargetTitle: ${args.targetTitle || ""}` : ""}`;
      } else if (operation === "disconnect_node") {
        actions = [{ type: "workflow.node.disconnect", id: nodeId, direction: ["input", "output", "both"].includes(String(args.direction || "")) ? String(args.direction) : "input" }];
        result = `ARTIFACT CANVAS 移除成果关系。\nnodeId: ${nodeId}${rawNodeTitle ? `\nnodeTitle: ${rawNodeTitle}` : ""}\ndirection: ${args.direction || "input"}`;
      } else if (operation === "delete_node") {
        actions = [{ type: "workflow.node.delete", id: nodeId, mode: args.deleteMode === "branch" ? "branch" : "only" }];
        result = `ARTIFACT CANVAS 删除成果。\nnodeId: ${nodeId}${rawNodeTitle ? `\nnodeTitle: ${rawNodeTitle}` : ""}\nmode: ${args.deleteMode === "branch" ? "branch" : "only"}`;
      } else if (operation === "clear_canvas") {
        actions = [{ type: "workflow.canvas.clear", mode: "all" }];
        result = "WORKBENCH 清理当前画布。";
      } else if (operation === "update_node") {
        actions = [
          {
            type: "workflow.node.update",
            patch: {
              id: nodeId,
              ...(title ? { title } : {}),
              ...(prompt ? { prompt } : {}),
              ...(args.status ? { status: args.status } : {}),
              ...(Number.isFinite(Number(args.x)) ? { x: Number(args.x) } : {}),
              ...(Number.isFinite(Number(args.y)) ? { y: Number(args.y) } : {})
            }
          }
        ];
        result = `ARTIFACT CANVAS 更新成果。\n${safeJson(actions[0].patch)}`;
      } else if (operation === "continue_node") {
        actions = [{ type: "workflow.node.continue", id: nodeId, prompt }];
        result = `WORKBENCH 基于节点继续生图。\nnodeId: ${nodeId}${prompt ? `\nprompt: ${prompt}` : ""}`;
      } else if (operation === "redraw_node") {
        actions = [{ type: "workflow.node.redraw", id: nodeId, kind: "repaint", assetIndex, prompt }];
        result = `WORKBENCH 打开节点区域重绘。\nnodeId: ${nodeId}\nassetIndex: ${assetIndex}`;
      } else if (operation === "cutout_node") {
        actions = [{ type: "workflow.node.cutout", id: nodeId, kind: "cutout", assetIndex }];
        result = `WORKBENCH 打开节点 AI 抠图。\nnodeId: ${nodeId}\nassetIndex: ${assetIndex}`;
      } else {
        result = `WORKBENCH 未知操作。\noperation: ${operation}`;
      }
    } else if (name === "experience") {
      return { envelope: directEnvelope(name, experienceManage(args)), actions };
    } else if (name === "context_manage") {
      return { envelope: directEnvelope(name, contextManage(args)), actions };
    } else if (name === "memory") {
      if (operation === "add") return { envelope: directEnvelope(name, { ...memoryAdd(args), tool: "memory" }), actions };
      if (operation === "read") return { envelope: directEnvelope(name, { ...memoryRead(args), tool: "memory" }), actions };
      return { envelope: directEnvelope(name, { ...memoryCheck(args), tool: "memory" }), actions };
    } else {
      result = `未知工具：${name}`;
    }

    return { envelope: storeToolResult(name, args, result, modelOutput ? { modelOutput } : {}), actions };
  }

  function addExternalEntry(target, input = {}) {
    const store = readExternalStore(target);
    const now = new Date().toISOString();
    const section = String(input.section || (target === "memorycontext" ? "private" : "surface"));
    const prefix = target === "memorycontext" ? "mctx" : "fmem";
    const scope = externalScopeFromInput(input);
    const entry = {
      entry_id: makeEntryId(prefix),
      order_index: nextExternalOrder(store),
      section,
      title: String(input.title || (target === "memorycontext" ? "Memory Context" : "FastMemory")),
      text: String(input.text || input.summary || ""),
      status: "active",
      keywords: splitKeywords(input.keywords),
      created_at: now,
      updated_at: now,
      compact_of: [],
      ...(target === "fastmemory" && scope.projectId ? { projectId: scope.projectId } : {}),
      ...(target === "fastmemory" && scope.conversationId ? { conversationId: scope.conversationId } : {})
    };
    if (!entry.text.trim()) return { ok: false, target, summary: "缺少 text，未写入。" };
    store.entries.push(entry);
    writeExternalStore(target, store);
    return {
      ok: true,
      target,
      action: "add",
      entryId: entry.entry_id,
      section: entry.section,
      summary: `${target} 已写入 ${entry.entry_id}。`
    };
  }

  function compactExternalEntries(target, input = {}) {
    const section = String(input.section || "");
    const selector = input.selector ?? (input.scope === "all" ? "all" : "");
    const { store, entries } = resolveExternalSelector(target, selector, section, input);
    const scope = externalScopeFromInput(input);
    if (!entries.length) return { ok: false, target, selector, summary: `没有找到可 compact 的 ${target} entries。`, selectedEntryIds: [] };
    const now = new Date().toISOString();
    const sourceText = entries.map((entry) => `[${entry.entry_id}] ${entry.section}/${entry.title}\n${entry.text}`).join("\n\n");
    const summaryText = String(input.summary || input.text || "").trim() || [
      `### ${target} compact`,
      "",
      `selector: ${selector}`,
      `entries: ${entries.map((entry) => entry.entry_id).join(", ")}`,
      "",
      summarizeText(sourceText, 3600),
      "",
      `instruction: ${input.instruction || "保留稳定偏好、关键规则和可执行线索。"}`
    ].join("\n");

    if (entries.length === 1) {
      const selected = entries[0];
      store.entries = store.entries.map((entry) =>
        entry.entry_id === selected.entry_id
          ? {
              ...entry,
              title: String(input.title || `compact ${selected.title}`),
              text: summaryText,
              keywords: splitKeywords(input.keywords).length ? splitKeywords(input.keywords) : entry.keywords,
              updated_at: now,
              compact_of: Array.from(new Set([...(entry.compact_of || []), selected.entry_id]))
            }
          : entry
      );
      writeExternalStore(target, store);
      return {
        ok: true,
        target,
        action: "compact",
        entryId: selected.entry_id,
        selectedEntryIds: [selected.entry_id],
        replaced: true,
        summary: summarizeText(summaryText, 1600)
      };
    }

    const selectedIds = new Set(entries.map((entry) => entry.entry_id));
    const newEntry = {
      entry_id: makeEntryId(target === "memorycontext" ? "mctx" : "fmem"),
      order_index: nextExternalOrder(store),
      section: String(input.section || entries[0]?.section || (target === "memorycontext" ? "private" : "surface")),
      title: String(input.title || `compact ${selector}`),
      text: summaryText,
      status: "active",
      keywords: splitKeywords(input.keywords),
      created_at: now,
      updated_at: now,
      compact_of: entries.map((entry) => entry.entry_id),
      ...(target === "fastmemory" && (scope.projectId || entries[0]?.projectId) ? { projectId: scope.projectId || entries[0]?.projectId } : {}),
      ...(target === "fastmemory" && (scope.conversationId || entries[0]?.conversationId) ? { conversationId: scope.conversationId || entries[0]?.conversationId } : {})
    };
    store.entries = store.entries.map((entry) => (selectedIds.has(entry.entry_id) ? { ...entry, status: "compacted", updated_at: now } : entry));
    store.entries.push(newEntry);
    writeExternalStore(target, store);
    return {
      ok: true,
      target,
      action: "compact",
      entryId: newEntry.entry_id,
      selectedEntryIds: entries.map((entry) => entry.entry_id),
      replaced: false,
      summary: summarizeText(summaryText, 1600)
    };
  }

  function replaceExternalEntry(target, input = {}) {
    const section = String(input.section || "");
    const selector = input.selector ?? "";
    const { store, entries } = resolveExternalSelector(target, selector, section, input);
    if (!entries.length) return { ok: false, target, action: "replace", selector, summary: `没有找到可替换的 ${target} entry。`, selectedEntryIds: [] };
    if (entries.length !== 1) {
      return {
        ok: false,
        target,
        action: "replace",
        selector,
        selectedEntryIds: entries.map((entry) => entry.entry_id),
        summary: "replace 需要精确选择一个 entry；多个 entry 请使用 compact。"
      };
    }
    const text = String(input.text || input.summary || "").trim();
    if (!text) return { ok: false, target, action: "replace", selector, entryId: entries[0].entry_id, summary: "缺少 text，未替换。" };
    const selected = entries[0];
    const now = new Date().toISOString();
    store.entries = store.entries.map((entry) =>
      entry.entry_id === selected.entry_id
        ? {
            ...entry,
            section: String(input.section || entry.section),
            title: String(input.title || entry.title),
            text,
            keywords: splitKeywords(input.keywords).length ? splitKeywords(input.keywords) : entry.keywords,
            updated_at: now
          }
        : entry
    );
    writeExternalStore(target, store);
    return {
      ok: true,
      target,
      action: "replace",
      entryId: selected.entry_id,
      selectedEntryIds: [selected.entry_id],
      summary: `${target} 已替换 ${selected.entry_id}。`
    };
  }

  function readExternalEntries(target, input = {}) {
    const section = String(input.section || "");
    const selector = input.selector ?? (input.scope === "all" ? "all" : "");
    const { entries } = resolveExternalSelector(target, selector, section, input);
    return {
      ok: entries.length > 0,
      target,
      action: "read",
      selector,
      selectedEntryIds: entries.map((entry) => entry.entry_id),
      entries: entries.map((entry) => ({
        entry_id: entry.entry_id,
        section: entry.section,
        title: entry.title,
        status: entry.status,
        text: summarizeText(entry.text, 1600),
        keywords: entry.keywords
      })),
      summary: entries.length ? `${target} 已读取 ${entries.length} 条 entry。` : `没有找到可读取的 ${target} entry。`
    };
  }

  function contextManage(input = {}) {
    const requestedAction = String(input.action || "");
    const requestedTarget = String(input.target || "context").trim().toLowerCase();
    if (requestedTarget === "prompt") {
      return {
        ok: false,
        target: "prompt",
        action: requestedAction || "read",
        summary: "Agent Prompt 只能通过专用纯文本配置接口读取或编辑。"
      };
    }
    if (requestedAction === "add_experience") {
      return addExternalEntry("fastmemory", {
        ...input,
        section: "experience",
        title: input.title || `经验 ${input.rating || "note"}`,
        text: [
          `rating: ${input.rating || "note"}`,
          `source: ${(input.sourceEntryIds || []).join(", ")}`,
          "",
          String(input.text || input.summary || "")
        ].join("\n"),
        keywords: ["experience", input.rating || "note", ...splitKeywords(input.keywords)]
      });
    }
    const target = ["fastmemory", "memorycontext"].includes(requestedTarget) ? requestedTarget : "context";
    const action = ["add", "write", "replace", "read", "compact"].includes(requestedAction) ? requestedAction : input.text && !input.selector ? "add" : "compact";
    if (target === "fastmemory" || target === "memorycontext") {
      if (action === "add" || action === "write") return addExternalEntry(target, input);
      if (action === "replace") return replaceExternalEntry(target, input);
      if (action === "read") return readExternalEntries(target, input);
      return compactExternalEntries(target, input);
    }

    if (action === "add" || action === "write") {
      const entry = recordContextEntry({
        role: "system",
        kind: String(input.kind || "context_note"),
        title: input.title || "外置上下文补充",
        text: input.text || input.summary || ""
      });
      return {
        ok: true,
        target,
        action: "add",
        entryId: entry.entry_id,
        summary: `Context 已写入 ${entry.entry_id}。`
      };
    }

    if (action === "replace") {
      const entries = resolveEntrySelector(input.selector ?? "");
      if (!entries.length) return { ok: false, target, action: "replace", selector: input.selector ?? "", summary: "没有找到可替换的 Context entry。", selectedEntryIds: [] };
      if (entries.length !== 1) {
        return {
          ok: false,
          target,
          action: "replace",
          selector: input.selector ?? "",
          selectedEntryIds: entries.map((entry) => entry.entry_id),
          summary: "replace 需要精确选择一个 entry；多个 entry 请使用 compact。"
        };
      }
      const text = String(input.text || input.summary || "").trim();
      if (!text) return { ok: false, target, action: "replace", entryId: entries[0].entry_id, summary: "缺少 text，未替换。" };
      const replaced = replaceContextEntry(entries[0].entry_id, {
        title: input.title || entries[0].title,
        text,
        kind: input.kind || entries[0].kind
      });
      return {
        ok: true,
        target,
        action: "replace",
        entryId: replaced?.entry_id || entries[0].entry_id,
        selectedEntryIds: [entries[0].entry_id],
        summary: `Context 已替换 ${entries[0].entry_id}。`
      };
    }

    if (action === "read") {
      const entries = resolveEntrySelector(input.selector ?? "");
      return {
        ok: entries.length > 0,
        target,
        action: "read",
        selector: input.selector ?? "",
        selectedEntryIds: entries.map((entry) => entry.entry_id),
        entries: entries.map((entry) => ({
          entry_id: entry.entry_id,
          title: entry.title,
          kind: entry.kind,
          text: summarizeText(entry.text, 1600)
        })),
        summary: entries.length ? `Context 已读取 ${entries.length} 条 entry。` : "没有找到可读取的 Context entry。"
      };
    }

    return compact(input);
  }

  function experienceManage(input = {}) {
    const action = ["add", "write", "replace", "read", "compact"].includes(String(input.action || "")) ? String(input.action || "") : "read";
    const baseInput = {
      ...input,
      target: "fastmemory",
      section: "experience",
      keywords: Array.from(new Set(["experience", "painting", ...splitKeywords(input.keywords)]))
    };
    if (action === "add" || action === "write") {
      const text = String(input.text || input.summary || "").trim();
      if (!text) return { ok: false, tool: "experience", action: "add", summary: "缺少绘画经验正文，未写入。" };
      const result = addExternalEntry("fastmemory", {
        ...baseInput,
        title: input.title || `绘画经验 ${input.rating || "note"}`,
        text: [
          `rating: ${input.rating || "note"}`,
          input.sourceEntryIds?.length ? `source: ${input.sourceEntryIds.join(", ")}` : "",
          "",
          text
        ].filter(Boolean).join("\n")
      });
      return result.ok
        ? { ok: true, tool: "experience", action: "add", summary: "绘画经验已记录。" }
        : { ok: false, tool: "experience", action: "add", summary: result.summary || "绘画经验记录失败。" };
    }
    if (action === "replace") {
      const result = saveFastMemory(baseInput);
      return result.ok
        ? { ok: true, tool: "experience", action: "replace", summary: "绘画经验已更新。" }
        : { ok: false, tool: "experience", action: "replace", summary: result.error || "绘画经验更新失败。" };
    }
    if (action === "compact") {
      const result = compactExternalEntries("fastmemory", { ...baseInput, selector: "all" });
      return result.ok
        ? { ok: true, tool: "experience", action: "compact", summary: "绘画经验已整理。" }
        : { ok: false, tool: "experience", action: "compact", summary: "没有可整理的绘画经验。" };
    }
    const result = getFastMemory(baseInput);
    return result.ok
      ? { ok: true, tool: "experience", action: "read", text: result.text, isEmpty: result.isEmpty, summary: result.isEmpty ? "当前没有绘画经验。" : "绘画经验已读取。" }
      : { ok: false, tool: "experience", action: "read", text: "", isEmpty: true, summary: result.error || "绘画经验读取失败。" };
  }

  function compact(input) {
    const selector = input?.selector ?? "all";
    const entries = resolveEntrySelector(selector);
    if (entries.length === 0) {
      return {
        ok: false,
        selector,
        summary: "没有找到可 compact 的 active entries。",
        selectedEntryIds: []
      };
    }

    const text = entries
      .map((entry) => `[${entry.entry_id}] ${entry.role}/${entry.kind}/${entry.title}\n${entry.text}`)
      .join("\n\n");
    const summary = String(input?.summary || input?.text || "").trim() || `### Context Compact\n\nselector: ${selector}\nentries: ${entries.map((entry) => entry.entry_id).join(", ")}\n\n${summarizeText(text, 3600)}\n\ninstruction: ${input?.instruction ?? "保留关键任务、决策、工具引用和用户偏好。"}`;
    if (entries.length === 1) {
      const replaced = replaceContextEntry(entries[0].entry_id, {
        title: input?.title || `compact ${entries[0].title}`,
        text: summary,
        kind: "compact",
        compactOf: [entries[0].entry_id]
      });
      return {
        ok: true,
        selector,
        entryId: replaced?.entry_id || entries[0].entry_id,
        selectedEntryIds: [entries[0].entry_id],
        replaced: true,
        summary: summarizeText(summary, 1600)
      };
    }
    setEntryStatus(
      entries.map((entry) => entry.entry_id),
      "compacted"
    );
    const compactEntry = recordContextEntry({
      role: "system",
      kind: "compact",
      title: `compact ${selector}`,
      text: summary,
      compactOf: entries.map((entry) => entry.entry_id)
    });

    return {
      ok: true,
      selector,
      entryId: compactEntry.entry_id,
      selectedEntryIds: entries.map((entry) => entry.entry_id),
      summary: summarizeText(summary, 1600)
    };
  }

  function memoryAdd(input = {}) {
    ensureMemory();
    const target = String(input.target || "datememory").toLowerCase();
    if (target !== "datememory") return { ok: false, target, summary: "memory operation=add 目前只允许 target=datememory。" };
    const rawEntries = Array.isArray(input.entries) ? input.entries : input.entry ? [input.entry] : [];
    const written = [];
    for (const item of rawEntries) {
      const diary = item && typeof item === "object" ? item : {};
      const date = String(diary.date || diary.dateKey || dateKey()).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const content = String(diary.content || diary.text || "").trim();
      if (!content) continue;
      const title = String(diary.title || `${date} 日记`).trim();
      const keywords = splitKeywords(diary.keywords);
      const sourceEntryIds = Array.isArray(diary.sourceEntryIds) ? diary.sourceEntryIds.map(String).filter(Boolean) : [];
      const previous = db.prepare("SELECT * FROM date_memory WHERE date_key = ?").get(date);
      const block = [`## ${title}`, keywords.length ? `keywords: ${keywords.join(", ")}` : "", sourceEntryIds.length ? `source: ${sourceEntryIds.join(", ")}` : "", "", content]
        .filter(Boolean)
        .join("\n");
      const summary = previous?.summary ? `${previous.summary}\n\n---\n${block}` : block;
      const nextKeywords = Array.from(new Set([...(previous?.keywords ? splitKeywords(previous.keywords) : []), ...keywords]));
      const nextEntryIds = Array.from(new Set([...(previous?.entry_ids ? splitKeywords(previous.entry_ids) : []), ...sourceEntryIds]));
      db.prepare(
        `INSERT INTO date_memory(date_key, summary, chars, status, updated_at, keywords, entry_ids)
         VALUES(?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(date_key) DO UPDATE SET
           summary = excluded.summary,
           chars = excluded.chars,
           status = excluded.status,
           updated_at = excluded.updated_at,
           keywords = excluded.keywords,
           entry_ids = excluded.entry_ids`
      ).run(date, summary, summary.length, "active", new Date().toISOString(), nextKeywords.join(","), nextEntryIds.join(","));
      written.push({ date, title, chars: content.length, keywords: nextKeywords, sourceEntryIds });
    }

    if (input.clearContext) {
      writeJson(dateMemoryPath, { version: 1, next_entry_id: 1, needs_compaction: false, entries: [] });
    }

    return {
      ok: written.length > 0,
      target,
      written,
      clearedContext: Boolean(input.clearContext),
      summary: written.length ? `datememory 已写入 ${written.length} 篇日记。` : "没有可写入的 datememory 日记。"
    };
  }

  function memoryCheck(input = {}) {
    ensureMemory();
    const entryId = input.entryId ? String(input.entryId) : "";
    const keywords = splitKeywords(input.keywords ?? input.keyword);
    const keyword = keywords.join(" ");
    const scope = String(input.scope || "").toLowerCase();

    if (entryId && (!scope || scope === "tool" || scope === "toolmemory")) {
      const tool = db.prepare("SELECT * FROM tool_memory WHERE entry_id = ?").get(entryId);
      if (tool) {
        const lines = String(tool.result_text ?? "").split(/\r?\n/);
        const matches = keywords.length
          ? lines
              .map((line, index) => ({ line, lineNumber: index + 1 }))
              .filter((item) => keywords.some((word) => item.line.toLowerCase().includes(word.toLowerCase())))
              .slice(0, 20)
          : [];
        return {
          ok: true,
          scope: "tool",
          entryId,
          summary: tool.summary,
          chars: tool.chars,
          lines: tool.lines,
          matches
        };
      }
      if (scope === "tool" || scope === "toolmemory") {
        return { ok: false, scope: "tool", entryId, summary: "未找到 toolmemory entry。" };
      }
    }

    if (entryId) {
      const entry = db.prepare("SELECT * FROM memory_entries WHERE entry_id = ?").get(entryId);
      return entry ? { ok: true, scope: "meta", entry } : { ok: false, entryId, summary: "未找到 entry。" };
    }

    if (keywords.length && (!scope || scope === "date" || scope === "datememory")) {
      const rows = db.prepare("SELECT * FROM date_memory ORDER BY date_key DESC LIMIT 400").all();
      const hits = rows
        .map((row) => {
          const haystack = `${row.date_key}\n${row.keywords || ""}\n${row.summary || ""}`.toLowerCase();
          const matched = keywords.filter((word) => haystack.includes(word.toLowerCase()));
          const score = matched.reduce((sum, word) => sum + (String(row.keywords || "").toLowerCase().includes(word.toLowerCase()) ? 3 : 1), 0);
          return { row, matched, score };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || String(b.row.date_key).localeCompare(String(a.row.date_key)));
      return {
        ok: true,
        scope: "date",
        query: keywords,
        best: hits[0]
          ? {
              date: hits[0].row.date_key,
              score: hits[0].score,
              matchedKeywords: hits[0].matched,
              keywords: splitKeywords(hits[0].row.keywords),
              entryIds: splitKeywords(hits[0].row.entry_ids),
              summary: summarizeText(hits[0].row.summary, 5000)
            }
          : null,
        hits: hits.slice(1, 12).map((item) => ({
          date: item.row.date_key,
          score: item.score,
          matchedKeywords: item.matched,
          keywords: splitKeywords(item.row.keywords)
        }))
      };
    }

    const targetDate = input.date ? String(input.date).slice(0, 10) : dateKey();
    const dateRow = db.prepare("SELECT * FROM date_memory WHERE date_key = ?").get(targetDate);
    if (dateRow && (!scope || scope === "date" || scope === "datememory")) {
      return {
        ok: true,
        scope: "date",
        date: targetDate,
        summary: summarizeText(dateRow.summary, 5000),
        keywords: splitKeywords(dateRow.keywords),
        entryIds: splitKeywords(dateRow.entry_ids),
        chars: dateRow.chars,
        status: dateRow.status
      };
    }

    const rows = keyword
      ? db
          .prepare("SELECT * FROM memory_entries WHERE text LIKE ? OR title LIKE ? ORDER BY order_index DESC LIMIT 80")
          .all(`%${keyword}%`, `%${keyword}%`)
      : db.prepare("SELECT * FROM memory_entries WHERE date_key = ? ORDER BY order_index ASC LIMIT 80").all(targetDate);
    return {
      ok: true,
      scope: "meta",
      date: targetDate,
      entries: rows.map((row) => ({
        entryId: row.entry_id,
        orderIndex: row.order_index,
        role: row.role,
        title: row.title,
        status: row.status,
        preview: summarizeText(row.text, 240)
      }))
    };
  }

  function memoryRead(input = {}) {
    ensureMemory();
    const scope = String(input.scope || "").toLowerCase();
    const date = input.date ? String(input.date).slice(0, 10) : "";
    const entryId = String(input.entryId ?? "");
    if ((scope === "date" || scope === "datememory" || (!scope && date)) && date) {
      const row = db.prepare("SELECT * FROM date_memory WHERE date_key = ?").get(date);
      return row
        ? {
            ok: true,
            scope: "date",
            date,
            keywords: splitKeywords(row.keywords),
            entryIds: splitKeywords(row.entry_ids),
            text: row.summary
          }
        : { ok: false, scope: "date", date, summary: "未找到 datememory 日记。" };
    }

    if (!entryId) return { ok: false, summary: "需要 entryId 或 date。" };

    const tool = db.prepare("SELECT * FROM tool_memory WHERE entry_id = ?").get(entryId);
    if (!tool && (scope === "tool" || scope === "toolmemory")) return { ok: false, entryId, summary: "未找到 toolmemory。" };
    if (!tool) {
      const entry = db.prepare("SELECT * FROM memory_entries WHERE entry_id = ?").get(entryId);
      return entry ? { ok: true, scope: "meta", entryId, text: entry.text, entry } : { ok: false, entryId, summary: "未找到 memory entry。" };
    }

    const lines = String(tool.result_text ?? "").split(/\r?\n/);
    const start = Math.max(1, Number(input.lineStart ?? 1));
    const end = Math.min(lines.length, Number(input.lineEnd ?? Math.min(start + 80, lines.length)));
    return {
      ok: true,
      scope: "tool",
      entryId,
      lineStart: start,
      lineEnd: end,
      totalLines: lines.length,
      text: lines.slice(start - 1, end).join("\n")
    };
  }

  function externalPromptFor(section = "main") {
    const store = readPromptTextStore();
    if (section === "memory") return String(store.memoryPrompt || defaultMemoryAgentPrompt);
    return String(store.mainPrompt || defaultMainAgentPrompt);
  }

  function fastMemoryForPrompt(scope = {}) {
    const exactScope = requiredFastMemoryScope(scope);
    if (!exactScope.ok) return "暂无绘画经验。";
    const store = readExternalStore("fastmemory");
    const entries = exactScopedFastMemoryEntries(store, exactScope);
    if (!entries.length) return "暂无绘画经验。";
    return selectFastMemoryPromptContext(entries, scope).text || "暂无绘画经验。";
  }

  function memoryContextForPrompt() {
    const store = readExternalStore("memorycontext");
    const entries = store.entries.filter((entry) => entry.status === "active");
    if (!entries.length) return "暂无后台 Memory Context。";
    return entries
      .slice(-24)
      .map((entry) => `[${entry.entry_id}] ${entry.section}/${entry.title}${entry.keywords?.length ? ` keywords=${entry.keywords.join(",")}` : ""}\n${summarizeText(entry.text, 700)}`)
      .join("\n\n");
  }

  function recentContextForPrompt() {
    try {
      const rows = getActiveEntries().slice(-16);
      return rows.map((row) => `[${row.entry_id}] #${row.order_index} ${row.role}/${row.kind}/${row.title}\n${summarizeText(row.text, 700)}`).join("\n\n");
    } catch {
      return "";
    }
  }

  function memoryAgentMessages(task, payloadText, extra = {}) {
    return [
      {
        role: "system",
        content: externalPromptFor("memory")
      },
      {
        role: "system",
        content: `FastMemory（与主 Agent 共享）：\n${fastMemoryForPrompt(extra)}`
      },
      {
        role: "system",
        content: `后台 Memory Context entries：\n${memoryContextForPrompt()}`
      },
      {
        role: "user",
        content: safeJson({
          task,
          instruction: extra.instruction || "",
          payload: payloadText
        })
      }
    ];
  }

  function messageAttachmentManifest(message = {}) {
    const attachments = message.attachments && typeof message.attachments === "object" ? message.attachments : {};
    const compactItems = (items, role) => (Array.isArray(items) ? items : [])
      .slice(0, 12)
      .map((item) => [
        cleanOneLine(item?.displayCode || "", 40),
        `assetId=${cleanOneLine(item?.assetId || "", 160)}`,
        item?.nodeId ? `node=${cleanOneLine(item.nodeId, 160)}` : "",
        cleanOneLine(item?.name || (role === "SOURCE" ? "原图" : "参考图"), 160),
        item?.referenceRole ? `role=${cleanOneLine(item.referenceRole, 80)}` : "",
        item?.purpose ? `purpose=${cleanOneLine(item.purpose, 240)}` : ""
      ].filter(Boolean).join(" | "));
    const sources = compactItems(attachments.sourceAssets, "SOURCE");
    const references = compactItems(attachments.referenceAssets, "REFERENCE");
    const sourceCount = Math.max(sources.length, Math.floor(Number(attachments.sourceCount ?? sources.length) || sources.length));
    const referenceCount = Math.max(references.length, Math.floor(Number(attachments.referenceCount ?? references.length) || references.length));
    if (!sourceCount && !referenceCount) return "";
    return [
      "[历史素材角色快照；仅用于理解对话，真实路径与当前状态以最新 Current Task Scope 为准]",
      `SOURCE ${sourceCount}${sourceCount > sources.length ? `（列出 ${sources.length}）` : ""}:`,
      ...(sources.length ? sources.map((item) => `- ${item}`) : ["- 未保留明细"]),
      `REFERENCE ${referenceCount}${referenceCount > references.length ? `（列出 ${references.length}）` : ""}:`,
      ...(references.length ? references.map((item) => `- ${item}`) : ["- 未保留明细"])
    ].join("\n");
  }

  function messageContentForModel(message = {}) {
    const content = String(message.content || "").trim();
    const pasteText = Array.isArray(message.pasteBlocks)
      ? message.pasteBlocks
          .map((block) => String(block?.text || "").trim())
          .filter(Boolean)
          .join("\n\n")
      : "";
    const attachmentManifest = messageAttachmentManifest(message);
    return [content, pasteText, attachmentManifest].filter(Boolean).join("\n\n").trim();
  }

  function assistantMessageIsModelContext(message = {}) {
    const meta = String(message.meta || "").toLowerCase();
    if (["progress", "thinking", "interrupted", "interrupt"].some((item) => meta.includes(item))) return false;
    const status = String(message.status || "").toLowerCase();
    if (["running", "pending", "interrupted"].includes(status)) return false;
    const content = messageContentForModel(message);
    return Boolean(content);
  }

  function visibleConversationMessages(payload = {}) {
    return (payload.messages ?? [])
      .filter((message) => {
        if (message.hidden) return false;
        if (message.role === "user") return Boolean(messageContentForModel(message));
        if (message.role === "assistant") return assistantMessageIsModelContext(message);
        return false;
      })
      .map((message) => ({
        role: message.role,
        content: message.role === "assistant"
          ? sanitizeModelVisibleToolText(messageContentForModel(message))
          : messageContentForModel(message)
      }))
      .filter((message) => message.content);
  }

  function compactStateForPayload(payload = {}) {
    const state = runtimeMetaJson(conversationSummaryKey(payload), { summary: "", messageCount: 0, updatedAt: "" }) || { summary: "", messageCount: 0, updatedAt: "" };
    return {
      ...state,
      summary: sanitizeModelVisibleToolText(state.summary)
    };
  }

  function protocolToolOutputForPersistence(output) {
    if (!Array.isArray(output)) return typeof output === "string" ? output : safeJson(output);
    const persisted = output.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      if (String(item.type || "") === "input_image") {
        return [{ type: "input_text", text: "Local image was loaded for that tool turn. Call view_image again when fresh pixels are needed." }];
      }
      if (String(item.type || "") === "input_text") {
        return [{ type: "input_text", text: summarizeText(String(item.text || ""), 2400) }];
      }
      if (String(item.type || "") === "encrypted_content" && item.encrypted_content) {
        return [{ type: "encrypted_content", encrypted_content: String(item.encrypted_content) }];
      }
      return [];
    });
    return persisted.length ? persisted : "Tool completed without persistent text output.";
  }

  function protocolItemForPersistence(item = {}) {
    const type = String(item?.type || "");
    if (type === "message") {
      const content = (Array.isArray(item.content) ? item.content : [])
        .map((part) => {
          const partType = String(part?.type || "");
          if (!["input_text", "output_text"].includes(partType)) return null;
          return { type: partType, text: summarizeText(String(part.text || ""), 12000) };
        })
        .filter(Boolean);
      return content.length ? { type, role: String(item.role || "assistant"), content } : null;
    }
    if (type === "reasoning") {
      const encrypted = String(item.encrypted_content || "");
      if (!encrypted) return null;
      return {
        type,
        ...(item.id ? { id: String(item.id) } : {}),
        summary: Array.isArray(item.summary) ? item.summary : [],
        encrypted_content: encrypted
      };
    }
    if (type === "function_call") {
      const name = String(item.name || "").trim();
      const callId = String(item.call_id || item.id || "").trim();
      if (!name || !callId) return null;
      const rawArguments = typeof item.arguments === "string" ? item.arguments : safeJson(item.arguments || {});
      const argumentsForPersistence = name === "experience"
        ? safeJson(Object.fromEntries(Object.entries(parseJsonObject(rawArguments)).filter(([key]) => experiencePublicArgumentKeys.has(key))))
        : rawArguments;
      return { type, call_id: callId, name, arguments: argumentsForPersistence };
    }
    if (type === "function_call_output") {
      const callId = String(item.call_id || "").trim();
      if (!callId) return null;
      return { type, call_id: callId, output: protocolToolOutputForPersistence(item.output) };
    }
    if (type === "web_search_call") {
      return {
        type,
        ...(item.id ? { id: String(item.id) } : {}),
        ...(item.status ? { status: String(item.status) } : {}),
        ...(item.action && typeof item.action === "object" ? { action: JSON.parse(safeJson(item.action)) } : {})
      };
    }
    if (["compaction", "context_compaction"].includes(type) && item.encrypted_content) {
      return { type, ...(item.id ? { id: String(item.id) } : {}), encrypted_content: String(item.encrypted_content) };
    }
    return null;
  }

  function protocolStateForPayload(payload = {}) {
    const state = runtimeMetaJson(conversationProtocolKey(payload), { version: 1, turns: [], updatedAt: "" }) || { version: 1, turns: [], updatedAt: "" };
    return {
      version: 1,
      turns: Array.isArray(state.turns) ? state.turns.filter((turn) => Array.isArray(turn?.items)) : [],
      updatedAt: String(state.updatedAt || "")
    };
  }

  function conversationProtocolItemsForPrompt(payload = {}) {
    const turns = protocolStateForPayload(payload).turns;
    const selected = [];
    let chars = 0;
    for (const turn of [...turns].reverse()) {
      const turnChars = safeJson(turn.items).length;
      if (selected.length && chars + turnChars > protocolHistoryPromptChars) break;
      selected.unshift(turn);
      chars += turnChars;
      if (selected.length >= protocolHistoryMaxTurns) break;
    }
    return selected.flatMap((turn) => turn.items);
  }

  function appendConversationProtocolTurn(payload = {}, items = []) {
    const persistedItems = (Array.isArray(items) ? items : []).map(protocolItemForPersistence).filter(Boolean);
    if (!persistedItems.length) return;
    const state = protocolStateForPayload(payload);
    const turns = [
      ...state.turns,
      { createdAt: new Date().toISOString(), items: persistedItems }
    ].slice(-protocolHistoryMaxTurns);
    while (turns.length > 1 && safeJson(turns).length > protocolHistoryStoreChars) turns.shift();
    writeRuntimeMetaJson(conversationProtocolKey(payload), {
      version: 1,
      turns,
      updatedAt: new Date().toISOString()
    });
  }

  function conversationPayloadTokenEstimate(payload = {}) {
    const conversationText = visibleConversationMessages(payload).map((message) => `${message.role}: ${message.content}`).join("\n");
    const nodeText = workbenchSnapshotForPrompt(payload).text;
    const referenceText = normalizeReferenceImages(payload.referenceImages, 9)
      .map((image) => `${image.name} ${image.path} ${image.mimeType}${image.role ? ` role=${image.role}` : ""}${image.purpose ? ` purpose=${image.purpose}` : ""}`)
      .join("\n");
    const taskScopeText = taskScopeForPrompt(payload).text;
    return estimateTokens(`${externalPromptFor("main")}\n${fastMemoryForPrompt(payload)}\n${conversationText}\n${nodeText}\n${taskScopeText}\n${referenceText}\n${payload.prompt || ""}`);
  }

  function compactAidebugMarkers(existingSummary = "", messages = [], prompt = "") {
    const source = [
      existingSummary,
      messages.map((message) => `${message.role}: ${message.content}`).join("\n\n"),
      prompt
    ].filter(Boolean).join("\n\n");
    return Array.from(new Set(source.match(/\bAIDEBUG_[A-Z0-9_]+_\d+\b/g) || []));
  }

  function preserveCompactAidebugMarkers(summary = "", existingSummary = "", messages = [], prompt = "") {
    const markers = compactAidebugMarkers(existingSummary, messages, prompt);
    const cleanSummary = String(summary || "").trim();
    if (!markers.length) return cleanSummary;
    const markerBlock = [
      "AIDebug preserved markers:",
      ...markers.map((marker) => `- ${marker}`)
    ].join("\n");
    if (markers.every((marker) => cleanSummary.includes(marker)) && cleanSummary.includes("AIDebug preserved markers:")) {
      return cleanSummary;
    }
    return `${markerBlock}\n\n${cleanSummary}`.trim();
  }

  function fallbackConversationSummary(existingSummary, messages, prompt = "") {
    const source = [
      existingSummary ? `Existing summary:\n${existingSummary}` : "",
      messages.map((message) => `${message.role}: ${message.content}`).join("\n\n"),
      prompt ? `Current user request:\n${prompt}` : ""
    ].filter(Boolean).join("\n\n");
    return summarizeText(source, 9000);
  }

  async function compactConversationIfNeeded(settings, payload, progress) {
    const state = compactStateForPayload(payload);
    const messages = visibleConversationMessages(payload);
    const estimated = conversationPayloadTokenEstimate(payload);
    const limit = Math.max(8000, Number(settings.contextCompactTokens || runtimeOptions.mainContextCompactTokens || mainContextCompactTokens));
    const shouldCompact = messages.length > mainContextCompactMessageCount || estimated >= limit;
    if (!shouldCompact) return state;

    const messageCount = messages.length;
    const coveredCount = Math.max(0, Number(state.messageCount || 0));
    const compactUntil = Math.max(0, messageCount - mainContextRecentMessages);
    if (compactUntil <= coveredCount && state.summary) {
      const repairedSummary = summarizeText(preserveCompactAidebugMarkers(state.summary, state.summary, messages, payload.prompt), 12000);
      if (repairedSummary && repairedSummary !== state.summary) {
        const repairedState = {
          ...state,
          summary: repairedSummary,
          updatedAt: new Date().toISOString()
        };
        writeRuntimeMetaJson(conversationSummaryKey(payload), repairedState);
        return repairedState;
      }
      return state;
    }

    const sourceMessages = messages.slice(coveredCount, compactUntil);
    if (!sourceMessages.length) return state;

    progress?.({
      phase: "context-compact-start",
      tool: "compact",
      summary: "上下文接近阈值，正在压缩旧会话。"
    });

    let summary = "";
    const compactModel = compactModelForSettings(settings);
    try {
      if (compactModel) {
        const response = await callModel(
          { ...settings, agentModel: compactModel },
          [
            {
              role: "system",
              content:
                "You are the compact model for IIimage Agent. Compress old conversation into a cache-friendly summary for the same agent. Preserve user goals, constraints, decisions, image parameters, node/tool result references, errors, unresolved next steps, and exact AIDEBUG_* marker tokens. Do not invent facts. Return only JSON with keys summary and keywords."
            },
            {
              role: "user",
              content: safeJson({
                existingSummary: state.summary || "",
                messages: sourceMessages,
                currentUserRequest: String(payload.prompt || "")
              })
            }
          ],
          {
            model: compactModel,
            stream: false,
            tools: [],
            toolChoice: "none",
            progress
          }
        );
        const text = String(messageFromResponse(response)?.content || "").trim();
        const parsed = parseJsonObject(text);
        summary = String(parsed.summary || text || "").trim();
      }
    } catch (error) {
      progress?.({
        phase: "context-compact-warning",
        tool: "compact",
        summary: `compact 模型失败，使用本地压缩：${error instanceof Error ? error.message : String(error)}`
      });
    }

    if (!summary) summary = fallbackConversationSummary(state.summary || "", sourceMessages, payload.prompt);
    summary = preserveCompactAidebugMarkers(summary, state.summary || "", sourceMessages, payload.prompt);
    const nextState = {
      version: 1,
      summary: summarizeText(summary, 12000),
      messageCount: compactUntil,
      updatedAt: new Date().toISOString(),
      compactModel: compactModel || "local-fallback"
    };
    writeRuntimeMetaJson(conversationSummaryKey(payload), nextState);
    progress?.({
      phase: "context-compact-done",
      tool: "compact",
      summary: `旧会话已压缩，保留最近 ${Math.min(mainContextRecentMessages, messageCount)} 条消息。`
    });
    return nextState;
  }

  function buildPromptMessages(payload, compactState = null) {
    const modelContract = imageModelContractForSettings(payload.settings ?? {});
    const selectedNodeId = String(payload.selectedNodeId || "").trim();
    const selectedNodeIds = selectedCanvasArtifactIds(payload);
    const workbenchSnapshot = workbenchSnapshotForPrompt(payload);
    const nodeSnapshot = workbenchSnapshot.text;
    const taskScopeSnapshot = taskScopeForPrompt(payload);
    const runtimeToolContract = [
      "运行时向主 Agent 暴露 IIimage 自有 image_gen、experience、ask_user、成果画布工具，以及与 Codex 对齐的 view_image、shell_command 和 Responses 原生 web_search；每项能力只以 API tools schema 为准。",
      "由你根据用户目标自主决定是否调用工具以及调用顺序，系统不会替你强制 tool_choice 或改写参数。需要生成或修改图片时必须通过 image_gen tool_call 表达；普通问答直接回复，不要声称执行了不存在的工具。",
      "同一用户图片任务优先合并为一次 image_gen：相同提示词多张使用 count，不同提示词多张使用 items，并显式选择 generationMode=parallel 或 sequential；分层任务使用 operation=layers。用户在同一轮要求 N 张、N 版或 N 个候选时使用 parallel，即使表达为‘基于这张继续给 N 版’；parentId 表示来源，不决定执行模式。sequential 仅用于明确的一次一张、故事/时间顺序或连续系列。不要用多次单图调用模拟批量，但工具回执明确失败时应根据错误修正参数后再自主决定。",
      "",
      "Image Task Contract:",
      "- generate：文字生图，或仅基于 Current Task Scope 的 REFERENCE 进行参考图生图；只要 SOURCE 非空，generate 就不会读取原图，必须改用 edit、replace、variants、layers、cutout 或 redraw。",
      "- 需要使用画布图片时，从 Current Workbench Snapshot 选择真实节点 ID 并填写 parentId；运行时只读取 Current Task Scope 已声明的项目库图片，不猜测来源节点。",
      "- edit：只修改 Current Task Scope 的 SOURCE；REFERENCE 仅提供身份、风格、构图、材质等参考。",
      "- replace：替换当前图片中的元素，非替换区域尽量保持不变。",
      "- variants：基于当前图片生成多种独立款式，count 是款式数量，禁止拼图。",
      "- layers：生成一张合成预览、2-8 个同尺寸独立 PNG 图层和重组校验图。"
    ].join("\n");
    const summaryText = String((compactState ?? compactStateForPayload(payload))?.summary || "").trim();
    const protocolItems = conversationProtocolItemsForPrompt(payload);
    const priorMessages = protocolItems.length ? [] : visibleConversationMessages(payload).slice(-(summaryText ? mainContextRecentMessages : 14));
    const fastMemoryText = fastMemoryForPrompt(payload);

    return [
      {
        role: "developer",
        content: externalPromptFor("main")
      },
      {
        role: "developer",
        content: [
          "Runtime Context Boundary",
          runtimeToolContract,
          "",
          "Internal image preference context:",
          fastMemoryText,
          "",
          "Conversation Summary:",
          summaryText || "暂无压缩摘要。",
          "",
          "Image Model Contract:",
          modelContract.text,
          "",
          "Canvas Contract:",
          "- 右侧 Agent 是唯一智能控制中心；画布展示图片成果、来源关系，以及用户主动保存的可复用需求节点。",
          "- 不要创建、调用或描述子 Agent，也不要自行创建计划、工具或执行步骤节点。需求节点只承载用户保存的图片处理要求；选中需求节点时沿其输入连线读取 SOURCE，并让新成果连接在需求节点之后。",
          "- 当前选择和输入区参考图会作为动态上下文提供；需要画布来源时必须自行选择并填写 parentId，不要要求用户手抄本地路径。",
          "- replace、edit、variants 应设置 parentId 指向你选择的来源图片；运行时会校验但不会猜测、补写或改换 parentId。",
          "- 缺少必需 SOURCE 时用 ask_user 请用户选择待修改原图；不能要求用户手抄路径，也不能把 REFERENCE 当原图。",
          "",
          "Task Scope Contract:",
          "- Current Task Scope 是本轮素材角色的权威来源：SOURCE 是需要处理的原图，REFERENCE 只提供参考。",
          "- 绝不能根据 REFERENCE 的数量推导输出数量；输出张数只由用户明确要求和 image_gen count/items 决定。",
          "- 用户要求修改/替换/分层/翻译但 SOURCE 为空时，先用 ask_user 要求指定原图，不能把参考图擅自当成编辑目标。",
          "- 按 resultPolicy 归组成果；confirmationPolicy=preview-3/staged 时，用结构化 ask_user options 对账批量策略，direct/auto 时不要重复确认。等待回复后沿用冻结的 snapshotHash 对应素材范围。",
          "",
          "Current Selected Node:",
          selectedNodeId || "暂无选中节点。",
          "",
          "Current Selected Nodes:",
          selectedNodeIds.length ? selectedNodeIds.join(", ") : "暂无选中成果。",
          "",
          "Current Workbench Snapshot:",
          nodeSnapshot || "暂无节点。",
          "",
          "Current Task Scope:",
          taskScopeSnapshot.text
        ].join("\n")
      },
      ...(protocolItems.length ? [{ role: "responses_items", items: protocolItems }] : []),
      ...priorMessages,
      { role: "user", content: payload.prompt }
    ];
  }

  async function callModel(settings, messages, requestOptions = {}) {
    const config = providerSettings(settings, "agent");
    const model = String(requestOptions.model ?? config.model ?? "").trim();
    const progress = typeof requestOptions.progress === "function" ? requestOptions.progress : () => {};
    const nativeWebSearchState = new Map();
    if (!Object.prototype.hasOwnProperty.call(requestOptions, "tools") || !Array.isArray(requestOptions.tools)) {
      throw new Error("Agent 模型调用必须显式提供 tools 数组，禁止回退暴露完整内部 toolSchemas。");
    }
    let sawThinking = false;
    const requestBody = {
      model,
      messages,
      reasoning_effort: settings.reasoningEffort ?? "low",
      temperature: 0.7,
      stream: requestOptions.stream !== false,
      tools: requestOptions.tools,
      tool_choice: requestOptions.toolChoice ?? "auto"
    };
    if (settings.fastMode) requestBody.service_tier = "fast";
    if (Array.isArray(requestBody.tools) && requestBody.tools.length === 0) {
      delete requestBody.tools;
      delete requestBody.tool_choice;
    }
    if (diagnosticModelIO) {
      const toolNames = Array.isArray(requestBody.tools)
        ? requestBody.tools.map(toolSchemaName).filter(Boolean)
        : [];
      const lastUser = [...messages].reverse().find((message) => message?.role === "user");
      const inputImages = messages.flatMap((message) => Array.isArray(message?.content)
        ? message.content.filter((item) => item?.type === "input_image" && typeof item?.image_url === "string")
        : []);
      const detail = {
        model,
        stream: Boolean(requestBody.stream),
        messageCount: messages.length,
        messageRoles: messages.map((message) => message?.role || "unknown"),
        inputImageCount: inputImages.length,
        inputImagePayloadBytes: inputImages.reduce((total, item) => total + Buffer.byteLength(String(item.image_url || ""), "utf8"), 0),
        requestJsonBytes: Buffer.byteLength(JSON.stringify(requestBody), "utf8"),
        toolChoice: requestBody.tool_choice ?? "none",
        toolNames,
        lastUserPreview: summarizeText(String(lastUser?.content || ""), 360)
      };
      progress({
        phase: "model-request-detail",
        summary: `Agent 模型请求摘要：tools=${toolNames.join(",") || "none"} tool_choice=${detail.toolChoice}.`,
        detail
      });
      log(`agent model request detail ${safeJson(detail)}`);
    }

    if (typeof runtimeOptions.serverChatCompletion === "function") {
      if (requestBody.stream) {
        const streamed = await runtimeOptions.serverChatCompletion({
          ...requestBody,
          onStreamEvent: (chunk) => {
            emitNativeWebSearchProgress(chunk, progress, nativeWebSearchState);
            const reasoningDelta = reasoningDeltaFromChunk(chunk);
            const contentDelta = contentDeltaFromChunk(chunk);
            if (reasoningDelta) {
              sawThinking = true;
              progress({ phase: "model-thinking-delta", delta: reasoningDelta });
            }
            if (contentDelta) {
              if (sawThinking) {
                progress({ phase: "model-thinking-done" });
                sawThinking = false;
              }
              progress({ phase: "assistant-message-delta", delta: contentDelta });
            }
          }
        });
        if (sawThinking) progress({ phase: "model-thinking-done" });
        return responseFromStreamChunks(streamed.chunks ?? []);
      }
      const response = await runtimeOptions.serverChatCompletion(requestBody);
      emitNativeWebSearchProgress({ response }, progress, nativeWebSearchState);
      return response;
    }

    const apiKey = String(config.apiKey ?? "").trim();
    if (!apiKey) {
      throw new Error("Agent 模型未接入。请先登录服务端账户或配置真实 Agent 模型。");
    }
    const controller = new AbortController();
    const timeoutMs = Math.max(5, Number(settings.timeoutSeconds ?? 90)) * 1000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(normalizeChatUrl(config.baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({ ...requestBody, stream: false }),
        signal: controller.signal
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`API ${response.status}: ${text.slice(0, 320)}`);
      }

      return response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function webSearchQueryFromAction(action = {}) {
    const queries = Array.isArray(action?.queries) ? action.queries.map((item) => cleanOneLine(item, 180)).filter(Boolean) : [];
    return cleanOneLine(action?.query || queries.join("；") || action?.url || action?.pattern || "", 300);
  }

  function nativeWebSearchItemsFromChunk(chunk = {}) {
    const eventType = String(chunk?.type || "");
    const items = [];
    const direct = chunk?.item ?? chunk?.output_item;
    if (String(direct?.type || "") === "web_search_call") items.push({ item: direct, eventType });
    if (/web_search_call/i.test(eventType) && !direct) {
      items.push({
        item: {
          type: "web_search_call",
          id: chunk.item_id || chunk.id || chunk.call_id,
          status: chunk.status,
          action: chunk.action
        },
        eventType
      });
    }
    for (const item of Array.isArray(chunk?.response?.output) ? chunk.response.output : []) {
      if (String(item?.type || "") === "web_search_call") items.push({ item, eventType: eventType || "response.completed" });
    }
    return items;
  }

  function emitNativeWebSearchProgress(chunk, progress, state = new Map()) {
    if (typeof progress !== "function") return;
    for (const { item, eventType } of nativeWebSearchItemsFromChunk(chunk)) {
      const action = item?.action && typeof item.action === "object" ? item.action : {};
      const query = webSearchQueryFromAction(action);
      const toolRunId = String(item?.id || chunk?.item_id || chunk?.call_id || `web-search-${state.size + 1}`);
      const prior = state.get(toolRunId) || { started: false, done: false };
      const done = /completed|output_item\.done|response\.completed/i.test(eventType) || String(item?.status || "").toLowerCase() === "completed";
      const input = query ? { query, action: action.type || "search" } : { action: action.type || "search" };
      if (!prior.started) {
        progress({
          phase: "tool-start",
          tool: "web_search",
          toolRunId,
          summary: query ? `正在搜索：${query}` : "正在执行原生网页搜索。",
          brief: query || "执行原生网页搜索。",
          operation: String(action.type || "search"),
          input,
          nativeTool: true,
          nativeEventType: eventType
        });
        prior.started = true;
      }
      if (done && !prior.done) {
        progress({
          phase: "tool-done",
          tool: "web_search",
          toolRunId,
          summary: query ? `搜索完成：${query}` : "原生网页搜索已完成。",
          brief: query || "原生网页搜索已完成。",
          operation: String(action.type || "search"),
          input,
          nativeTool: true,
          nativeEventType: eventType
        });
        prior.done = true;
      }
      state.set(toolRunId, prior);
    }
  }

  async function runMaintenanceToolCalls(settings, response, context = {}) {
    const message = messageFromResponse(response);
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    const results = [];
    for (const call of toolCalls) {
      const name = call?.function?.name;
      if (!["memory", "context_manage"].includes(name)) continue;
      const result = await runTool(name, call?.function?.arguments, {
        settings,
        nodes: [],
        progress: context.progress,
        runId: context.runId || "memory-maintenance"
      });
      results.push(result.envelope);
    }
    return results;
  }

  function dateMemoryBuffer() {
    const buffer = readJson(dateMemoryPath, { version: 1, entries: [], needs_compaction: false });
    const entries = Array.isArray(buffer.entries) ? buffer.entries : [];
    const bytes = Buffer.byteLength(JSON.stringify({ ...buffer, entries }), "utf8");
    return { ...buffer, entries, bytes, overLimit: bytes >= dateMemoryCompactChars || Boolean(buffer.needs_compaction) };
  }

  function fallbackDateMemoryEntries(entries) {
    const byDate = new Map();
    for (const entry of entries) {
      const date = String(entry.date || entry.date_key || dateKey()).slice(0, 10);
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push(entry);
    }
    return [...byDate.entries()].map(([date, rows]) => {
      const text = rows.map((row) => `[${row.id || row.entry_id}] ${row.role || ""}/${row.title || ""}\n${row.text || ""}`).join("\n\n");
      return {
        date,
        title: `${date} IIimage 工作日记`,
        keywords: Array.from(new Set(["IIimage", "Agent", "绘图", ...rows.flatMap((row) => splitKeywords(row.title))])).slice(0, 12),
        sourceEntryIds: rows.map((row) => String(row.id || row.entry_id || "")).filter(Boolean),
        content: summarizeText(text, 3600)
      };
    });
  }

  async function runDateMemoryMaintenance(settings, progress, runId = "") {
    const buffer = dateMemoryBuffer();
    if (!buffer.overLimit || !buffer.entries.length) return null;
    progress?.({ phase: "memory-start", tool: "memory", summary: "正在整理记忆。" });
    let toolResults = [];
    try {
      if (typeof runtimeOptions.serverChatCompletion === "function") {
        const response = await callModel(settings, memoryAgentMessages("datememory_maintenance", summarizeText(JSON.stringify(buffer.entries), dateMemoryCompactChars), {
          instruction: "将 datememorycontext 按日期整理为 datememory 日记，并调用 memory operation=add target=datememory clearContext=true。"
        }), {
          tools: toolSchemas().filter((tool) => ["memory", "context_manage"].includes(tool.function?.name)),
          toolChoice: "auto"
        });
        toolResults = await runMaintenanceToolCalls(settings, response, { progress, runId });
      }
    } catch (error) {
      progress?.({ phase: "memory-warning", tool: "memory", summary: `记忆 Agent 调用失败，使用本地整理：${error instanceof Error ? error.message : String(error)}` });
    }

    if (!toolResults.some((item) => item?.tool === "memory" || item?.target === "datememory" || item?.written?.length)) {
      const fallback = memoryAdd({ target: "datememory", entries: fallbackDateMemoryEntries(buffer.entries), clearContext: true });
      toolResults.push(fallback);
    }
    progress?.({ phase: "memory-done", tool: "memory", summary: "记忆整理完成。" });
    return { ok: true, bytes: buffer.bytes, toolResults };
  }

  async function maybeRunBackgroundMaintenance(settings, payload, progress, runId = "") {
    if (maintenanceRunning) return [];
    maintenanceRunning = true;
    try {
      const results = [];
      const dateResult = await runDateMemoryMaintenance(settings, progress, runId);
      if (dateResult) results.push(dateResult);
      return results;
    } finally {
      maintenanceRunning = false;
    }
  }

  function scheduleBackgroundMaintenance(settings, payload, progress, runId = "") {
    void maybeRunBackgroundMaintenance(settings, payload, progress, runId).catch((error) => {
      progress({
        phase: "memory-warning",
        tool: "context_manage",
        summary: `后台维护未阻塞主回复，但执行失败：${error instanceof Error ? error.message : String(error)}`
      });
    });
  }

  function responseItemsForProtocol(response, assistantMessage = {}) {
    const raw = Array.isArray(assistantMessage.responses_output)
      ? assistantMessage.responses_output
      : Array.isArray(response?.output)
        ? response.output
        : [];
    if (raw.length) return raw;
    const items = [];
    const content = String(assistantMessage?.content || "").trim();
    if (content) {
      items.push({ type: "message", role: "assistant", content: [{ type: "output_text", text: content }] });
    }
    for (const call of Array.isArray(assistantMessage?.tool_calls) ? assistantMessage.tool_calls : []) {
      const name = String(call?.function?.name || "").trim();
      const callId = String(call?.id || "").trim();
      if (!name || !callId) continue;
      items.push({
        type: "function_call",
        call_id: callId,
        name,
        arguments: typeof call.function.arguments === "string" ? call.function.arguments : safeJson(call.function.arguments || {})
      });
    }
    return items;
  }

  async function chat(payload = {}) {
    ensureMemory();
    const settings = payload.settings ?? {};
    const progress = typeof payload.progress === "function" ? payload.progress : () => {};

    const actions = [];
    const toolResults = [];
    const turnProtocolItems = [
      { type: "message", role: "user", content: [{ type: "input_text", text: String(payload.prompt || "") }] }
    ];
    const compactState = await compactConversationIfNeeded(settings, payload, progress);
    const messages = buildPromptMessages(payload, compactState);
    const exposedTools = agentToolSchemas(settings);
    const exposedToolNames = new Set(exposedTools.map(toolSchemaName).filter(Boolean));

    let first = null;
    let assistantMessage = null;
    let modelRound = 0;
    // Complex native tool sequences can legitimately include reference review,
    // generation, result review and one corrective pass. Keep a generous safety
    // ceiling while relying on the tool schema, duplicate-call guard and bounded
    // review contract to make the model converge naturally.
    const maxModelRounds = 16;

    function appendToolMessage(call, envelope, name) {
      const modelOutput = typeof envelope?.modelOutput === "string" || Array.isArray(envelope?.modelOutput)
        ? envelope.modelOutput
        : safeJson(toolEnvelopeForModel(envelope, name, modelRound));
      const callId = call?.id || `${name || "tool"}-${modelRound}`;
      messages.push({
        role: "tool",
        tool_call_id: callId,
        name,
        content: modelOutput
      });
      turnProtocolItems.push({ type: "function_call_output", call_id: String(callId), output: modelOutput });
    }

    function appendPendingToolSkips(toolCalls, startIndex, summary, options = {}) {
      const internalOnly = options.internalOnly === true;
      for (let index = startIndex; index < toolCalls.length; index += 1) {
        const call = toolCalls[index];
        const name = call?.function?.name || "unknown";
        const skipped = {
          ok: true,
          tool: name,
          summary,
          ...(internalOnly ? { internalOnly: true } : {})
        };
        toolResults.push(skipped);
        appendToolMessage(call, skipped, name);
        if (internalOnly) continue;
        const input = parseJsonObject(call?.function?.arguments ?? {});
        progress({
          phase: "tool-skip",
          tool: name,
          summary,
          brief: summary,
          operation: toolOperationFromArgs(name, input),
          params: toolParamsFromArgs(name, input),
          input
        });
      }
    }

    function canRunToolCallInParallel(call) {
      const name = String(call?.function?.name || "");
      return name === "view_image";
    }

    function exactDuplicateToolResult(call, name) {
      const envelope = {
        ok: true,
        tool: name || "unknown",
        summary: "同一轮中参数完全一致的重复工具调用已跳过；首次调用结果仍然有效。",
        internalOnly: true
      };
      toolResults.push(envelope);
      return { envelope, actions: [], name, ok: true };
    }

    function internalToolArgumentFailure(name, parsedInput, error) {
      const failureMessage = cleanOneLine(errorMessage(error), 500);
      const errorCategory = "invalid_tool_arguments";
      const envelope = {
        ok: false,
        tool: name,
        summary: "工具参数需要模型内部修正。",
        visibleOutput: [
          "TOOL ARGUMENT VALIDATION",
          "ok: false",
          `tool: ${name}`,
          `message: ${failureMessage}`,
          "call_json:",
          safeJson(parsedInput)
        ].join("\n"),
        error: failureMessage,
        errorCategory,
        retriable: true,
        advice: toolErrorAdvice(errorCategory),
        internalOnly: true
      };
      toolResults.push(envelope);
      return { envelope, actions: [], name, ok: false, error };
    }

    async function executeToolCall(call, fallbackName = "", executionContext = {}) {
      const name = call?.function?.name || fallbackName;
      if (!exposedToolNames.has(String(name || ""))) {
        throw new Error(`Agent 模型请求了未公开工具 ${String(name || "<missing>")}；该调用已拒绝。`);
      }
      const currentToolRunId = String(call?.id || toolRunId({ runId: payload.runId }, name || "tool"));
      let input = call?.function?.arguments ?? {};
      let parsedInput = parseJsonObject(input);
      if (name === "experience") {
        parsedInput = Object.fromEntries(Object.entries(parsedInput).filter(([key]) => experiencePublicArgumentKeys.has(key)));
        input = parsedInput;
      }
      if (isImageToolName(name)) {
        try {
          parsedInput = normalizeSingleImageItemCompatibility(parsedInput);
          const imageOperation = String(parsedInput.operation ?? parsedInput.mode ?? "").trim().toLowerCase();
          const publicImageOperations = new Set(["generate", "edit", "replace", "variants", "layers", "cutout", "redraw"]);
          if (!publicImageOperations.has(imageOperation)) {
            throw new Error(`image_gen operation=${imageOperation || "<missing>"} 无效。请使用公开 schema 中列出的 operation。`);
          }
          const isRegionOperation = ["redraw", "cutout"].includes(imageOperation);
          const modelSuppliedMask = Boolean(parsedInput.maskImage || parsedInput.maskPath || /^data:image\//i.test(String(parsedInput.maskDataUrl || "")));
          if (isRegionOperation && modelSuppliedMask) {
            throw new Error(`image_gen operation=${imageOperation} 的蒙版只能由用户在区域编辑器中绘制，模型不能直接提交 mask。`);
          }
          const imageContext = {
            settings,
            nodes: payload.nodes ?? [],
            prompt: payload.prompt,
            messages: payload.messages ?? [],
            selectedNodeId: payload.selectedNodeId,
            selectedNodeIds: payload.selectedNodeIds ?? [],
            taskScope: payload.taskScope,
            referenceImages: payload.referenceImages ?? []
          };
          if (imageOperation === "layers") {
            parsedInput = normalizeLayeredImageToolArgs(name, parsedInput, settings, imageContext);
          } else if (isRegionOperation) {
            parsedInput = normalizeRegionEditorOpenArgs(name, parsedInput, settings, imageContext);
          } else {
            parsedInput = normalizeImageToolArgs(name, parsedInput, settings, {
              ...imageContext
            });
            Object.defineProperty(parsedInput, normalizedImageToolArgsMarker, { value: true });
          }
          input = parsedInput;
        } catch (error) {
          const validationError = cleanOneLine(errorMessage(error), 500);
          if (diagnosticModelIO) {
            const diagnosticInput = {
              keys: Object.keys(parsedInput || {}).sort(),
              operation: cleanOneLine(parsedInput?.operation ?? parsedInput?.mode ?? "", 80),
              promptChars: String(parsedInput?.prompt ?? "").length,
              count: parsedInput?.count,
              generationMode: parsedInput?.generationMode,
              model: cleanOneLine(parsedInput?.model ?? "", 120),
              ratio: cleanOneLine(parsedInput?.ratio ?? "", 40),
              resolution: cleanOneLine(parsedInput?.resolution ?? "", 40),
              size: cleanOneLine(parsedInput?.size ?? "", 40),
              quality: cleanOneLine(parsedInput?.quality ?? "", 40),
              items: Array.isArray(parsedInput?.items)
                ? parsedInput.items.map((item) => ({
                    keys: item && typeof item === "object" ? Object.keys(item).sort() : [],
                    title: cleanOneLine(item?.title ?? "", 120),
                    promptChars: String(item?.prompt ?? "").length,
                    ratio: cleanOneLine(item?.ratio ?? "", 40),
                    resolution: cleanOneLine(item?.resolution ?? "", 40),
                    quality: cleanOneLine(item?.quality ?? "", 40)
                  }))
                : parsedInput?.items === undefined ? undefined : typeof parsedInput?.items
            };
            progress({
              phase: "tool-validation-detail",
              tool: name,
              toolRunId: currentToolRunId,
              summary: "工具参数校验未通过。",
              detail: {
                error: validationError,
                input: diagnosticInput
              },
              input: diagnosticInput,
              internalOnly: true
            });
            log(`agent tool validation detail ${safeJson({ tool: name, error: validationError, input: diagnosticInput })}`);
          }
          return internalToolArgumentFailure(name, parsedInput, error);
        }
      }
      const brief = toolBriefFromArgs(name, parsedInput);
      const operation = toolOperationFromArgs(name, parsedInput);
      const params = toolParamsFromArgs(name, parsedInput);
      progress({ phase: "tool-start", tool: name, operationId: currentToolRunId, toolRunId: currentToolRunId, summary: brief, brief, operation, params, input: parsedInput });
      const stopPolling = startToolPolling(progress, name, brief, payload.runId, { operationId: currentToolRunId, toolRunId: currentToolRunId, operation, params, input: parsedInput });
      try {
        const result = await runTool(name, input, {
          settings,
          nodes: payload.nodes ?? [],
          progress,
          runId: payload.runId,
          projectId: payload.projectId,
          conversationId: payload.conversationId,
          operationId: currentToolRunId,
          toolRunId: currentToolRunId,
          prompt: payload.prompt,
          messages: payload.messages ?? [],
          selectedNodeId: payload.selectedNodeId,
          selectedNodeIds: payload.selectedNodeIds ?? [],
          taskScope: payload.taskScope,
          referenceImages: payload.referenceImages ?? [],
          viewImagePayloadMaxBytes: executionContext.viewImagePayloadMaxBytes
        });
        stopPolling();
        actions.push(...(result.actions ?? []));
        toolResults.push(result.envelope);
        if (result.envelope?.ok === false) {
          const failureMessage = cleanOneLine(result.envelope.error || result.envelope.summary || `${name} 执行失败。`, 500);
          const failureCategory = String(result.envelope.errorCategory || "unknown");
          progress({
            phase: "tool-error",
            tool: result.envelope?.tool ?? name,
            operationId: currentToolRunId,
            toolRunId: currentToolRunId,
            summary: failureMessage,
            detail: result.envelope.advice || toolErrorAdvice(failureCategory),
            errorCategory: failureCategory,
            retriable: result.envelope.retriable === true,
            brief,
            operation,
            params,
            input: parsedInput
          });
          return { ...result, name, ok: false, error: new Error(failureMessage) };
        }
        progress({
          phase: "tool-done",
          tool: result.envelope?.tool ?? name,
          operationId: currentToolRunId,
          toolRunId: currentToolRunId,
          summary: result.envelope?.summary ?? `工具 ${name ?? "unknown"} 已完成。`,
          brief,
          operation,
          params,
          input: parsedInput
        });
        return { ...result, name, ok: true };
      } catch (error) {
        stopPolling();
        const failure = makeToolErrorEnvelope(name, parsedInput, error);
        const envelope = storeToolResult(name, parsedInput, failure.resultText, {
          ok: false,
          summary: `${toolDisplayName(name)} 失败：${failure.errorMessage}`,
          error: failure.errorMessage,
          errorCategory: failure.errorCategory,
          retriable: failure.retriable,
          advice: toolErrorAdvice(failure.errorCategory)
        });
        toolResults.push(envelope);
        progress({
          phase: "tool-error",
          tool: name,
          operationId: currentToolRunId,
          toolRunId: currentToolRunId,
          summary: `${failure.errorMessage}`,
          detail: toolErrorAdvice(failure.errorCategory),
          errorCategory: failure.errorCategory,
          retriable: failure.retriable,
          brief,
          operation,
          params,
          input: parsedInput
        });
        return { envelope, actions: [], name, ok: false, error };
      }
    }

    async function flushParallelToolCalls(batch = []) {
      if (!batch.length) return { failedTool: null, waitingForUserAction: null };
      const executableViewCount = Math.max(1, batch.filter((item) => !item.exactDuplicate).length);
      const viewImagePayloadMaxBytes = viewImagePayloadBudgetForBatch(executableViewCount);
      const settled = await Promise.all(batch.map((item) =>
        item.exactDuplicate
          ? exactDuplicateToolResult(item.call, item.name)
          : executeToolCall(item.call, item.name, { viewImagePayloadMaxBytes })
      ));
      let waitingForUserAction = null;
      let failedTool = null;
      settled.forEach((result, index) => {
        const item = batch[index];
        appendToolMessage(item.call, result.envelope, result.name || item.name);
        if (!result.ok && !failedTool) failedTool = { ...result, callIndex: item.callIndex };
        if ((result.name || item.name) === "ask_user") {
          waitingForUserAction = (result.actions ?? [])[0] ?? waitingForUserAction;
        }
      });
      return { failedTool, waitingForUserAction };
    }

    while (true) {
      modelRound += 1;
      if (modelRound > maxModelRounds) {
        throw new Error(`Agent 工具循环超过 ${maxModelRounds} 轮，已停止以避免重复调用。`);
      }
      progress({
        phase: "model-request",
        summary: `请求 Agent 模型，第 ${modelRound} 轮。`
      });
      let response;
      try {
        response = await callModel(
          settings,
          compactRuntimeMessagesForModel(messages),
          {
            progress: (event) => progress({ ...event, modelRound }),
            tools: exposedTools,
            toolChoice: "auto"
          }
        );
      } catch (error) {
        throw error;
      }
      progress({ phase: "model-response", summary: `Agent 模型第 ${modelRound} 轮已返回。` });
      if (!first) first = response;
      assistantMessage = messageFromResponse(response);
      turnProtocolItems.push(...responseItemsForProtocol(response, assistantMessage));
      let toolCalls = Array.isArray(assistantMessage.tool_calls) ? assistantMessage.tool_calls : [];
      if (diagnosticModelIO) {
        const responseDetail = {
          round: modelRound,
          toolCallCount: toolCalls.length,
          toolCalls: toolCalls.map((call) => ({
            name: String(call?.function?.name || ""),
            argumentsPreview: summarizeText(String(call?.function?.arguments || ""), 520)
          })),
          contentPreview: summarizeText(String(assistantMessage?.content || ""), 520)
        };
        progress({
          phase: "model-response-detail",
          summary: `Agent 模型响应摘要：tool_calls=${responseDetail.toolCallCount}.`,
          detail: responseDetail
        });
        log(`agent model response detail ${safeJson(responseDetail)}`);
      }
      const assistantTextForProgress = String(assistantMessage?.content ?? "").trim();
      if (toolCalls.length > 0 && assistantTextForProgress) {
        progress({
          phase: "assistant-message",
          summary: assistantTextForProgress
        });
      }
      if (toolCalls.length === 0) break;

      messages.push(assistantMessage);
      let waitingForUserAction = null;
      let failedTool = null;
      let pendingParallelCalls = [];
      const toolCallSignatures = new Set();
      const flushPendingParallelCalls = async (skipStartIndex = toolCalls.length) => {
        if (!pendingParallelCalls.length) return false;
        const batch = pendingParallelCalls;
        pendingParallelCalls = [];
        const outcome = await flushParallelToolCalls(batch);
        waitingForUserAction = outcome.waitingForUserAction ?? waitingForUserAction;
        failedTool = outcome.failedTool ?? failedTool;
        if (failedTool) {
          appendPendingToolSkips(toolCalls, skipStartIndex, "上一并行工具失败，本轮后续工具未执行，等待 Agent 重新决策。", {
            internalOnly: failedTool.envelope?.internalOnly === true
          });
          return true;
        }
        if (waitingForUserAction) {
          appendPendingToolSkips(
            toolCalls,
            skipStartIndex,
            "已进入等待用户补充信息状态，本轮后续工具未执行。"
          );
          return true;
        }
        return false;
      };

      for (let callIndex = 0; callIndex < toolCalls.length; callIndex += 1) {
        const call = toolCalls[callIndex];
        const name = call?.function?.name;
        const signature = normalizedToolCallSignature(name, call?.function?.arguments ?? {});
        const exactDuplicate = toolCallSignatures.has(signature);
        toolCallSignatures.add(signature);

        if (canRunToolCallInParallel(call)) {
          pendingParallelCalls.push({ call, name, callIndex, exactDuplicate });
          continue;
        }

        if (await flushPendingParallelCalls(callIndex)) break;
        const result = exactDuplicate
          ? exactDuplicateToolResult(call, name)
          : await executeToolCall(call, name);
        appendToolMessage(call, result.envelope, name);
        if (!result.ok) {
          failedTool = { ...result, callIndex };
          appendPendingToolSkips(toolCalls, callIndex + 1, "上一工具失败，本轮后续工具未执行，等待 Agent 重新决策。", {
            internalOnly: result.envelope?.internalOnly === true
          });
          break;
        }
        if (name === "ask_user") {
          waitingForUserAction = (result.actions ?? [])[0] ?? waitingForUserAction;
        }
        if (waitingForUserAction) {
          appendPendingToolSkips(
            toolCalls,
            callIndex + 1,
            "已进入等待用户补充信息状态，本轮后续工具未执行。"
          );
          break;
        }
      }

      if (!failedTool && !waitingForUserAction) {
        await flushPendingParallelCalls(toolCalls.length);
      }
      if (waitingForUserAction) {
        const request = waitingForUserAction.request ?? {};
        assistantMessage = {
          role: "assistant",
          content: String(request.question || request.detail || "我需要你先补充信息。")
        };
        break;
      }
    }

    const publicToolResults = toolResults.filter((envelope) => !envelope?.internalOnly).map((envelope, index) =>
      toolEnvelopeForModel(envelope, envelope?.tool || "tool", index + 1)
    );
    const fallbackToolSummary = publicToolResults
      .map((envelope) => cleanOneLine(envelope?.summary || "", 220))
      .filter(Boolean)
      .slice(-3)
      .join("；");
    const content =
      String(assistantMessage?.content ?? first?.output_text ?? "").trim() ||
      fallbackToolSummary;
    if (!content) throw new Error("API 返回成功，但没有文本内容。");
    appendConversationProtocolTurn(payload, turnProtocolItems);
    return { ok: true, content, actions, toolResults: publicToolResults };
  }

  async function composeImagePrompt(payload = {}) {
    ensureMemory();
    const settings = payload.settings ?? {};
    const progress = typeof payload.progress === "function" ? payload.progress : () => {};
    const config = providerSettings(settings, "agent");
    const apiKey = String(config.apiKey ?? "").trim();
    const model = String(settings.agentModel ?? settings.model ?? "").trim();
    if (!apiKey && typeof runtimeOptions.serverChatCompletion !== "function") {
      return { ok: false, error: "Agent API key 未配置，无法执行真实 Agent 辅助。" };
    }
    if (!model && typeof runtimeOptions.serverChatCompletion !== "function") {
      return { ok: false, error: "Agent 模型未配置，无法执行真实 Agent 辅助。" };
    }

    const request = String(payload.request ?? "").trim();
    if (!request) return { ok: false, error: "Agent 辅助输入为空。" };

    recordContextEntry({
      role: "user",
      kind: "image_assist",
      title: "生图参数辅助请求",
      text: request
    });

    const composeTool = toolSchemas(settings).find((tool) => tool.function?.name === primaryImageToolName);
    const current = {
      prompt: String(payload.currentPrompt ?? "").trim(),
      ratio: String(payload.currentRatio ?? "1:1").trim(),
      resolution: String(payload.currentResolution ?? "1080P").trim(),
      count: clampNumber(payload.currentCount, 1, 10, 1),
      quality: String(payload.currentQuality ?? "auto").trim()
    };
    const messages = [
      {
        role: "system",
        content:
          "你是 IIimage 的生图提示词与参数优化 Agent。你必须调用 image_gen 工具一次提交最终结果，并设置 operation=compose；不要直接生成图片，不要只输出正文。prompt 要写成可直接交给 Image2 的完整画面要求，并结合用户当前提示词、补充要求和参数。提示词必须使用正向、健康、具体、视觉化的表达；删除或改写性暗示、未成年擦边、血腥暴力、自伤、仇恨、病理化、规避审查等高风险措辞。不要写否定式敏感词，例如“不要血腥/不色情/不暴力”，要改成“干净、非伤害性、健康成人角色、时尚摄影、自然姿态”等正面描述。不要使用隐蔽词、谐音、拆字、暗号或任何绕过审核的写法。"
      },
      {
        role: "user",
        content: safeJson({
          task: "优化当前生图提示词并选择 Image2 参数。",
          userRequest: request,
          current
        })
      }
    ];

    progress({ phase: "model-request", tool: primaryImageToolName, summary: "正在调用用户配置的 Agent 模型整理生图参数。" });
    const response = await callModel(settings, messages, {
      tools: [composeTool],
      toolChoice: "auto"
    });
    progress({ phase: "model-response", tool: primaryImageToolName, summary: "Agent 模型已返回，正在读取工具参数。" });

    const assistantMessage = messageFromResponse(response);
    const toolCalls = Array.isArray(assistantMessage.tool_calls) ? assistantMessage.tool_calls : [];
    const composeCall = toolCalls.find((call) => call?.function?.name === primaryImageToolName);
    if (!composeCall) {
      return { ok: false, error: "Agent 模型没有调用 image_gen(operation=compose) 工具。" };
    }

    const toolArgs = { ...parseJsonObject(composeCall.function?.arguments), operation: "compose" };
    const draft = normalizeImagePromptDraft(toolArgs, current);
    if (!draft) {
      return { ok: false, error: "Agent 模型返回的工具参数缺少可用提示词。" };
    }

    const result = await runTool(primaryImageToolName, { ...draft, operation: "compose" }, { settings, nodes: [], progress });
    progress({
      phase: "tool-done",
      tool: primaryImageToolName,
      summary: "Agent 工具参数已写入当前生图面板。"
    });
    return { ok: true, draft, envelope: toolEnvelopeForModel(result.envelope, primaryImageToolName, 1) };
  }

  function smokeTest() {
    ensureMemory();
    const schemas = toolSchemas({ imageModel: "gpt-image-2", imageModelPool: ["gpt-image-2", "gpt-image-1.5", "gemini-2.5-flash-image"] });
    const publicSchemas = agentToolSchemas({ imageModel: "gpt-image-2", imageModelPool: ["gpt-image-2", "gpt-image-1.5", "gemini-2.5-flash-image"] });
    const imageTool = schemas.find((tool) => tool.function?.name === primaryImageToolName);
    const publicImageTool = publicSchemas.find((tool) => tool.function?.name === primaryImageToolName);
    const publicExperienceTool = publicSchemas.find((tool) => tool.function?.name === "experience");
    const modelEnum = imageTool?.function?.parameters?.properties?.model?.enum ?? [];
    const tempItemRegression = normalizeImageBatchItems({
      items: [
        { title: "JAVA 语言娘化｜虚拟机之焰", prompt: "成年二次元女性 Java 语言娘化竖版主视觉。" },
        { title: "temp", prompt: "temp" }
      ]
    }, { imageSize: "1024x1536" });
    const promptTextRegression = externalPromptFor("main");
    const fastMemorySanitizeRegression = sanitizeFastMemoryText([
      "rating: note",
      "source: fmem-20260712-000001, ent-20260712-000002",
      "selector: all",
      "keywords: portrait, lighting",
      "保留极近景构图和克制的主视觉动势。"
    ].join("\n"));
    const modelEnvelopeRegression = toolEnvelopeForModel({
      ok: false,
      tool: "image_gen",
      entryId: "ent-20260712-000003",
      summary: "工具回执 ent-20260712-000003",
      visibleOutput: '{"entryId":"ent-20260712-000003","memoryRef":{"entryId":"ent-20260712-000003"},"selector":"all"}',
      memoryRef: { type: "toolmemory", entryId: "ent-20260712-000003" },
      error: "读取 fmem-20260712-000004 失败",
      errorCategory: "transient",
      retriable: true
    }, "image_gen", 2);
    const forbiddenModelMetadata = /\b(?:fmem|ent|pmt|mctx)-[a-z0-9_-]+\b|\b(?:selectedEntryIds|sourceEntryIds|entry[_ ]?ids?|entryId|memoryRef|toolmemoryEntryId|selector|keywords)\b/i;
    const sample = storeToolResult(
      "debug_echo",
      { source: "diagnostics" },
      Array.from({ length: 520 }, (_, index) => `line ${index + 1}: debug output with enough text to verify toolmemory externalization`).join("\n")
    );
    const compactResult = compact({ selector: "all", instruction: "diagnostics smoke compact" });
    return {
      ok: true,
      sqlite: Boolean(DatabaseSync),
      dbPath,
      dateMemoryPath,
      toolCount: schemas.length,
      publicToolNames: publicSchemas.map(toolSchemaName).filter(Boolean),
      publicImageOperations: publicImageTool?.function?.parameters?.properties?.operation?.enum ?? [],
      imageModelEnum: modelEnum,
      tempImageBatchItemFilteredOk:
        tempItemRegression.length === 1 &&
        tempItemRegression[0]?.title === "JAVA 语言娘化｜虚拟机之焰" &&
        !/temp/i.test(tempItemRegression[0]?.prompt || ""),
      plainTextPromptVisibleOk:
        Boolean(promptTextRegression.trim()) &&
        !/^\s*\[(?:prompt|pmt)-/im.test(promptTextRegression) &&
        !/\bentry[_ ]?id\b|\bentryId\b/i.test(promptTextRegression),
      fastMemorySanitizationOk:
        fastMemorySanitizeRegression === "保留极近景构图和克制的主视觉动势。" &&
        !/fmem|entry[_ ]?id|selector|keywords/i.test(fastMemorySanitizeRegression),
      publicExperienceSchemaMetadataHiddenOk:
        Boolean(publicExperienceTool) &&
        !["selector", "keywords", "sourceEntryIds"].some((name) =>
          Object.prototype.hasOwnProperty.call(publicExperienceTool.function?.parameters?.properties || {}, name)
        ),
      modelToolEnvelopeMetadataHiddenOk:
        !forbiddenModelMetadata.test(JSON.stringify(modelEnvelopeRegression)) &&
        !Object.prototype.hasOwnProperty.call(modelEnvelopeRegression, "entryId") &&
        !Object.prototype.hasOwnProperty.call(modelEnvelopeRegression, "memoryRef"),
      modelToolFailureMetadataHiddenOk:
        !forbiddenModelMetadata.test(JSON.stringify(modelEnvelopeRegression)) &&
        !Object.prototype.hasOwnProperty.call(modelEnvelopeRegression, "nextInstruction"),
      externalized: sample.externalized,
      compactOk: compactResult.ok
    };
  }

  async function debugScenario() {
    ensureMemory();
    const fixtureDir = path.join(projectRoot, ".diagnostics", "fixtures");
    mkdirSync(fixtureDir, { recursive: true });
    const fixtureImage = path.join(fixtureDir, "debug-reference.png");
    if (!existsSync(fixtureImage)) {
      writeFileSync(
        fixtureImage,
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
          "base64"
        )
      );
    }
    const created = recordContextEntry({
      role: "user",
      kind: "chat",
      title: "diagnostics 用户输入",
      text: "请生成一个并行多图的角色概念图工作流，并记录工具结果。"
    });
    const progressEvents = [];
    const modelPoolSettings = {
      imageModel: "gpt-image-2",
      imageModelPool: ["gpt-image-2", "gpt-image-1.5", "gemini-2.5-flash-image"],
      imageCount: 4,
      imageSize: "3840x2160",
      imageQuality: "auto"
    };
    const dynamicSchemas = toolSchemas(modelPoolSettings);
    const imageToolSchema = dynamicSchemas.find((tool) => tool.function?.name === primaryImageToolName);
    const image = await runTool(
      primaryImageToolName,
      {
        mode: "generate",
        prompt: "清新现代的 Agent 生图工作台视觉测试图",
        model: "gpt-image-2",
        size: "3840x2160",
        quality: "auto",
        count: 4,
        references: []
      },
      {
        settings: modelPoolSettings,
        nodes: [],
        runId: "aidebug-runtime-scenario",
        progress: (event) => progressEvents.push(event)
      }
    );
    const transparentLayer = await runTool(
      primaryImageToolName,
      {
        mode: "generate",
        prompt: "透明 PNG 角色前景图层，保留透明背景",
        size: "1024x1024",
        quality: "auto",
        count: 1,
        transparentPreferred: true,
        layerRole: "character",
        references: []
      },
      { settings: modelPoolSettings, nodes: [] }
    );
    const unselectedModelFallback = await runTool(
      primaryImageToolName,
      {
        mode: "generate",
        prompt: "验证 Agent 错传未勾选模型时仍回到用户模型池",
        model: "not-in-user-image-model-pool",
        size: "1024x1024",
        quality: "auto",
        count: 1,
        references: []
      },
      { settings: modelPoolSettings, nodes: [] }
    );
    const layerMerge = await runTool(
      primaryImageToolName,
      {
        operation: "layer_merge",
        title: "diagnostics 图层合成",
        width: 1024,
        height: 1024,
        layers: [
          { id: "background", title: "背景", sourceNodeId: "A", assetIndex: 1, x: 0, y: 0, opacity: 1 },
          { id: "character", title: "角色", sourceNodeId: "B", assetIndex: 1, x: 0, y: 0, opacity: 1 }
        ]
      },
      { settings: modelPoolSettings, nodes: [] }
    );
    const view = await runTool(
      "view_image",
      {
        path: fixtureImage,
        detail: "high"
      },
      { settings: {}, nodes: [] }
    );
    const workflow = await runTool(
      "workflow",
      {
        operation: "list_nodes",
        brief: "验证 Agent 可以读取成果画布。"
      },
      { settings: { imageCount: 4 }, nodes: [{ id: "A", title: "diagnostics 来源成果", type: "image", status: "done" }] }
    );
    const experience = await runTool(
      "context_manage",
      {
        action: "add_experience",
        title: "diagnostics 生图经验",
        text: "测试经验上下文写入：保留用户对好图和坏图的反馈，用于后续生图调优。",
        sourceEntryIds: [image.envelope.entryId],
        rating: "note"
      },
      { settings: {}, nodes: [] }
    );
    const longOutput = storeToolResult(
      "debug_long_output",
      { source: "diagnostics debugScenario" },
      Array.from({ length: 700 }, (_, index) => `line ${index + 1}: diagnostics long tool output for toolmemory externalization`).join("\n")
    );
    const compactResult = compact({ selector: "all", instruction: "diagnostics 验证 compact all 能稳定生成摘要条目。" });
    const diary = memoryAdd({
      target: "datememory",
      entries: [
        {
          date: dateKey(),
          title: "diagnostics runtime scenario 日记",
          content: `图像工具专项场景完成：验证 ${primaryImageToolName}、view_image、workflow、context_manage experience 和 toolmemory 外导。`,
          keywords: ["diagnostics", "runtime", primaryImageToolName, "workflow", "toolmemory"],
          sourceEntryIds: [created.entry_id, image.envelope.entryId, transparentLayer.envelope.entryId, unselectedModelFallback.envelope.entryId, layerMerge.envelope.entryId, view.envelope.entryId, longOutput.entryId]
        }
      ]
    });
    const memoryByDate = memoryCheck({ date: dateKey(), scope: "date" });
    const imageRead = memoryRead({ entryId: image.envelope.entryId, lineStart: 1, lineEnd: 24 });
    const longRead = memoryRead({ entryId: longOutput.entryId, lineStart: 1, lineEnd: 24 });

    return {
      ok: true,
      createdEntryId: created.entry_id,
      toolEntries: [image.envelope.entryId, transparentLayer.envelope.entryId, unselectedModelFallback.envelope.entryId, layerMerge.envelope.entryId, view.envelope.entryId, longOutput.entryId],
      imageExternalized: image.envelope.externalized,
      viewExternalized: view.envelope.externalized,
      longExternalized: longOutput.externalized,
      progressEvents,
      imageActions: image.actions,
      transparentLayerActions: transparentLayer.actions,
      unselectedModelFallbackActions: unselectedModelFallback.actions,
      layerMergeActions: layerMerge.actions,
      viewActions: view.actions,
      workflowActions: workflow.actions,
      experienceEntry: experience.envelope.entryId,
      compact: compactResult,
      diary,
      memoryByDate,
      imageRead,
      longRead,
      checks: {
        hasStableEntryIds: [created.entry_id, image.envelope.entryId, transparentLayer.envelope.entryId, unselectedModelFallback.envelope.entryId, layerMerge.envelope.entryId, view.envelope.entryId, longOutput.entryId].every((id) =>
          /^ent-\d{8}-\d{6}$/.test(id)
        ),
        canViewExistingImage: view.envelope.visibleOutput.includes("exists: true"),
        canReadToolMemory: Boolean(imageRead.ok && imageRead.text),
        canExternalizeToolMemory: Boolean(longOutput.externalized && longRead.ok && longRead.text),
        canCheckDateMemory: Boolean(memoryByDate.ok && memoryByDate.summary),
        canListCanvasArtifacts: workflow.actions.length === 0 && workflow.envelope.visibleOutput.includes("diagnostics 来源成果"),
        canImageGenerateCreateNode: image.actions.length === 1 && image.actions[0].type === "workflow.node.create",
        canImageProgressCreateWorkingNode: progressEvents.some(
          (event) =>
            event.phase === "image-request" &&
            event.tool === primaryImageToolName &&
            event.workflowAction?.type === "workflow.node.create" &&
            event.workflowAction?.node?.imageState === "generating" &&
            event.workflowAction?.toolRunId
        ),
        canImageActionResolveProgressNode: Boolean(
          image.actions[0]?.toolRunId &&
            progressEvents.some((event) => event.workflowAction?.toolRunId === image.actions[0]?.toolRunId)
        ),
        canImageGenerateExposeState: image.actions[0]?.node?.imageState === "empty" && Array.isArray(image.actions[0]?.node?.assets),
        canImageViewStayOffCanvas: view.actions.length === 0,
        canExposeSelectedImageModelPool: ["gpt-image-2", "gpt-image-1.5", "gemini-2.5-flash-image"].every((model) =>
          (imageToolSchema?.function?.parameters?.properties?.model?.enum ?? []).includes(model)
        ),
        canKeepImage2ForTransparentLayer: transparentLayer.envelope.visibleOutput.includes("model: gpt-image-2"),
        canRejectUnselectedImageModel: unselectedModelFallback.envelope.visibleOutput.includes("model: gpt-image-2") && !unselectedModelFallback.envelope.visibleOutput.includes("not-in-user-image-model-pool"),
        canCreateLayerMergeAction: layerMerge.actions.length === 1 && layerMerge.actions[0].type === "workflow.layer.merge",
        canAddExperience: Boolean(experience.envelope.entryId)
      }
    };
  }

  function dispose() {
    if (!db) return;
    try {
      db.close();
    } finally {
      db = null;
    }
  }

  return {
    getToolSchemas: agentToolSchemas,
    listModels,
    chat,
    composeImagePrompt,
    compact,
    memoryCheck,
    memoryRead,
    getMainPrompt,
    saveMainPrompt,
    resetMainPrompt,
    getFastMemory,
    saveFastMemory,
    resetFastMemory,
    clearConversationState,
    cancelPendingExecutionState,
    runTool,
    debugScenario,
    smokeTest,
    ensureMemory,
    dispose
  };
}

module.exports = {
  createAgentRuntime,
  toolSchemas,
  defaultPromptText,
  normalizedTaskScope,
  taskScopeSnapshotHash,
  taskScopeForPrompt,
  validateImageOperationSourcePolicy,
  prepareViewImageModelPayload,
  viewImagePayloadBudgetForBatch,
  viewImagePathAllowed,
  normalizeImage2Size,
  normalizeImageToolFrame,
  runtimeImageSourceMaxBytes
};
