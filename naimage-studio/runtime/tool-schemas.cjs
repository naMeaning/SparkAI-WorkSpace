"use strict";

// Owns the complete internal tool schema set and the sanitized public Agent tool set.
// Keep names, order, descriptions, required fields, and model-pool enums stable.

const {
  imageFrameContractForSettings,
  imagePromptRatios,
  imagePromptResolutions
} = require("./image-frame.cjs");

const primaryImageToolName = "image_gen";
const imagePromptRatioValues = [...imagePromptRatios];
const imagePromptResolutionValues = [...imagePromptResolutions];

function nativeWebSearchToolSchema() {
  return { type: "web_search" };
}

function uniqueImageModels(models = []) {
  return models
    .map((model) => String(model || "").trim())
    .filter(Boolean)
    .filter((model, index, list) => list.findIndex((item) => item.toLowerCase() === model.toLowerCase()) === index);
}

function imageModelPoolFromSettings(settings = {}) {
  const pool = Array.isArray(settings.imageModelPool) ? settings.imageModelPool : [];
  const selected = uniqueImageModels([settings.imageModel, ...pool]);
  if (selected.length) return selected;
  return uniqueImageModels([settings.imageModel, "gpt-image-2"]);
}

function imageModelContractForSettings(settings = {}) {
  const pool = imageModelPoolFromSettings(settings);
  const primary = String(settings.imageModel || pool[0] || "").trim();
  return {
    primary,
    pool,
    text: [
      `主生图模型：${primary || "未配置"}`,
      `用户勾选的生图模型池：${pool.length ? pool.join(", ") : "未配置"}`,
      "选择策略：显式指定模型时，只要该模型在用户勾选池中就必须优先采用；未勾选的显式模型会安全回退到主生图模型。未显式指定时保持单模型执行，并可优先使用池中的 gpt-image-2。"
    ].join("\n")
  };
}

function normalizeToolSchemas(schemas) {
  return schemas;
}

function imageModelToolProperty(settings = {}) {
  const contract = imageModelContractForSettings(settings);
  const description = `可选。只能从用户勾选的生图模型池选择：${contract.pool.join(", ") || "未配置"}。显式填写且已勾选时运行时必须采用该模型；未勾选则安全回退主模型。不填时仍只选择一个模型，并可优先使用池中的 gpt-image-2。主模型为 ${contract.primary || "未配置"}。`;
  return contract.pool.length ? { type: "string", enum: contract.pool, description } : { type: "string", description };
}

function toolSchemas(settings = {}) {
  const imageModelProperty = imageModelToolProperty(settings);
  const imageFrameContract = imageFrameContractForSettings(settings);
  const defaultImageRatio = imageFrameContract.ratio;
  const defaultImageResolution = imageFrameContract.resolution;
  const imageRatioValues = imageFrameContract.locked ? [defaultImageRatio] : imagePromptRatioValues;
  const imageResolutionValues = imageFrameContract.locked ? [defaultImageResolution] : imagePromptResolutionValues;
  const imageSizeProperty = imageFrameContract.locked
    ? {
        type: "string",
        enum: [imageFrameContract.size],
        description: `本次最终交付尺寸已由对话框按钮锁定为 ${imageFrameContract.size}，模型不能覆盖。运行时会为上游选择兼容基础画幅，再无拉伸地规整到该尺寸。`
      }
    : { type: "string", description: "可选最终交付尺寸。优先设置 ratio/resolution；运行时会使用图像服务稳定支持的基础画幅生成，再无拉伸地裁切到交付尺寸。" };
  const ratioDescription = imageFrameContract.locked
    ? `本次画面比例已由对话框按钮锁定为 ${defaultImageRatio}，模型和批量子项都不能覆盖。`
    : `用户要求的画面比例。当前默认值为 ${defaultImageRatio}；用户未明确其他比例时使用该值，用户说 3:4、竖版海报等时按用户要求覆盖。多图时每张图使用同一比例。`;
  const resolutionDescription = imageFrameContract.locked
    ? `本次输出清晰度已由对话框按钮锁定为 ${defaultImageResolution}，模型和批量子项都不能覆盖。清晰度与 quality（草稿/标准/精细）是两个不同参数。`
    : `输出清晰度档位。当前默认值为 ${defaultImageResolution}；用户未明确其他清晰度时使用该值。清晰度与 quality（草稿/标准/精细）是两个不同参数。`;
  return normalizeToolSchemas([
    {
      type: "function",
      function: {
        name: "shell_command",
        description: "Runs a Powershell command (Windows) and returns its output. SparkAI WorkSpace 将执行范围限制为当前项目内的受控只读诊断命令；画布与成果操作使用 workflow。",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string", description: "Shell command to execute. SparkAI WorkSpace currently permits only its documented read-only project diagnostics allowlist." },
            workdir: { type: "string", description: "Working directory for the command. Defaults to the current SparkAI WorkSpace project root and must remain inside it." },
            timeout_ms: { type: "integer", minimum: 250, maximum: 30000, description: "Maximum command runtime in milliseconds. The effective SparkAI WorkSpace read-only limit may be lower." },
            login: { type: "boolean", description: "True uses login shell semantics; false disables them. Defaults to true." }
          },
          required: ["command"],
          additionalProperties: false
        }
      }
    },
    {
      type: "function",
      function: {
        name: primaryImageToolName,
        description: "SparkAI WorkSpace 唯一图像执行工具。用于文字或参考图生成、精确编辑与换物改字、多款和多角度、服装上身、电商商品图、Logo 栅格概念、UI 视觉、插画、角色与游戏原画、分层 PNG、抠图和区域重绘。结果会自动同步到成果画布。",
        parameters: {
          type: "object",
          properties: {
            operation: { type: "string", enum: ["compose", "generate", "edit", "replace", "variants", "layers", "redraw", "cutout", "layer_merge"], description: "图像操作。generate=从文字或参考图创作；edit=保留来源核心不变量并继续设计；replace=只替换指定元素或文字，其他内容保持不变；variants=基于同一来源生成多种独立款式或角度，各款差异必须逐项填写 items；layers=真实分层任务，必须同时提交完整 layerPlan，不能用 generate/edit 代替；cutout=根据来源图、用户涂抹范围和描述提取主体并原生输出透明 PNG；redraw=只重绘蒙版区域；layer_merge/compose 为内部兼容操作。" },
            mode: { type: "string", enum: ["generate", "edit", "redraw", "cutout"], description: "兼容字段；优先使用 operation。" },
            prompt: { type: "string", description: "必填的顶层纯视觉画面 prompt。复杂任务按用途、主体与身份或商品、场景、风格媒介、构图景别、光线氛围、逐字文字、参考图分工、保留项与禁改项、输出意图组织；编辑任务明确‘只改变 X，保持 Y 不变’。用户要求、参考图 purpose 和当前 FastMemory 优先于通用风格，不擅自套用电影感、蓝金或海报模板。只能写最终画面需要呈现的内容；彻底省略任务 nonce、AIDebug/SELFTEST 标记、文件路径、节点或调用 ID、记忆 ID、实现说明和其他非画面文本，不能把它们写成负面约束。count=1 时完整提示词只写在这里并且不要填写 items。多图且方向不同时这里只写共同约束，各自完整画面写入 items.prompt；不要把清晨/夜色/极简等多个互斥方案塞进同一个顶层 prompt。不要直接填用户评价、催促、对话文本或‘这张效果很好’等反馈原文。" },
            model: imageModelProperty,
            ratio: { type: "string", enum: imageRatioValues, description: ratioDescription },
            resolution: { type: "string", enum: imageResolutionValues, description: resolutionDescription },
            size: imageSizeProperty,
            quality: { type: "string", enum: ["low", "medium", "high", "auto"] },
            count: { type: "integer", minimum: 1, maximum: 200, description: "独立输出图片总张数，只能来自用户明确要求。运行时按设置中的每批数量顺序派发，不会一次发出全部请求；绝不能因为上传了 N 张参考图就把 count 设为 N。" },
            generationMode: { type: "string", enum: ["parallel", "sequential"], description: "count>1 时的执行与画布组织方式。parallel=同一轮要求 N 张、N 版、N 个候选或 N 个方案，并收纳为批量图片组；即使用户说‘基于这张继续给 N 版’，也应使用 parallel 并另设 parentId。sequential 仅用于明确的一次一张、故事/时间顺序或连续系列。" },
            scopeExecution: { type: "string", enum: ["all-goal-sources"], description: "仅用于 Current Task Scope 明确标记 frozen=true 且完整、未截断的 Goal TaskScope。all-goal-sources=由运行时按冻结快照中的每个 SOURCE bindingId 逐绑定展开，并在探测批次与并发上限保护下执行；模型对整个 Goal 只调用一次 image_gen，不得自行按 SOURCE 重复调用。count 必须严格等于冻结的 goalOperationsPerAsset，SOURCE×count 必须严格等于 goalRequestCount；count=1 省略 items，count>1 使用 variants，相同要求可省略 items，逐项要求提供与 count 等长的 items。跨境电商矩阵还必须严格匹配冻结计划的 hash 与槽位/语言顺序。总请求不得超过 200。普通或不完整 TaskScope 必须省略。" },
            commercePlanHash: { type: "string", pattern: "^commerce-[a-f0-9]{32}$", description: "可选。只用于已确认的跨境电商结构化套图计划，原样复制任务中的 PLAN_HASH，用于成果溯源。" },
            slotId: { type: "string", description: "可选。仅当已确认的跨境电商 Goal 对每个 SOURCE 只生成一张时使用，记录该成品的结构化槽位 ID。" },
            slotIndex: { type: "integer", minimum: 0, maximum: 11, description: "可选。仅当已确认的跨境电商 Goal 对每个 SOURCE 只生成一张时使用，记录 0-11 的套图槽位零基序号。" },
            localeCode: { type: "string", description: "可选。仅当已确认的跨境电商 Goal 对每个 SOURCE 只生成一张时使用，记录 BCP-47 目标语言代码。" },
            socialContentType: { type: "string", enum: ["cover", "card", "shot"], description: "仅用于当前结构化社媒 Requirement 的图片成果类型。小红书使用 cover/card，抖音使用 cover/shot。" },
            socialSlot: { type: "string", description: "仅用于当前结构化社媒 Requirement 的成果槽位：cover、card-N、card-set、shot-N 或 shot-set。批量卡片/分镜使用对应 *-set。" },
            items: {
              type: "array",
              minItems: 2,
              maxItems: 200,
              description: "本轮要生成至少两张不同方向的成品时必填。用户逐一列出 A/B/C 款式、氛围、角度、版式、商品文案或其他差异时，必须为每个成品提供一个 items 项，不能把多个方案合写进顶层 prompt。count=1 时必须省略 items，只填写顶层 prompt；每一项对应一张独立图片并收纳到同一个图片组。完全相同提示词的多张随机变体才只使用顶层 prompt + count。严禁添加 temp、placeholder、todo、sample、测试项或其他占位项凑数。",
              items: {
                type: "object",
                properties: {
                  title: { type: "string", description: "该图片在批量组中的短标题。" },
                  prompt: { type: "string", description: "这一张图片自己的完整纯视觉提示词；必须重复系列身份、商品、服装、版式、文字等核心不变量，并清楚写出本项唯一变化。多角度商品图逐项写明方位角、俯仰角和必须显露的侧面/顶部结构，不能只写左侧、右侧等模糊方向。省略任务 nonce、测试标记、文件路径、节点/调用/记忆 ID 和实现说明，不能把这些内容写成负面约束。" },
                  slotId: { type: "string", description: "可选的结构化套图槽位 ID；仅作成果溯源，不得写入画面。" },
                  slotIndex: { type: "integer", minimum: 0, maximum: 11, description: "可选的结构化套图槽位零基序号；同一槽位跨语言复用相同序号，仅作成果溯源。" },
                  localeCode: { type: "string", description: "可选的 BCP-47 目标语言代码；仅作成果溯源与排版策略。" },
                  ratio: { type: "string", enum: imageRatioValues, description: ratioDescription },
                  resolution: { type: "string", enum: imageResolutionValues, description: resolutionDescription },
                  size: imageSizeProperty,
                  quality: { type: "string", enum: ["low", "medium", "high", "auto"] }
                },
                required: ["prompt"]
              }
            },
            outputFormat: { type: "string", enum: ["png", "jpeg", "webp"], description: "输出图片格式。默认 png；jpeg/webp 可配合 outputCompression。" },
            outputCompression: { type: "integer", minimum: 0, maximum: 100, description: "jpeg/webp 输出压缩质量，0-100。" },
            background: { type: "string", description: "图像背景模式 auto/transparent/opaque，或 layer_merge 的 CSS 背景色。cutout 由工具固定为 transparent，不需要模型另填。" },
            moderation: { type: "string", enum: ["auto", "low"], description: "官方 Image API moderation 参数。" },
            inputFidelity: { type: "string", enum: ["low", "high"], description: "编辑/参考图的输入保真度。人物身份、商品结构与标签、服装版型与图案等保真任务优先使用 high。" },
            layerId: { type: "string", description: "可选图层 ID；分层绘制时用于后续 image_gen(operation=layer_merge) 引用。" },
            layerRole: { type: "string", description: "可选图层角色，例如 background、character、foreground、text、shadow。" },
            layerGroupId: { type: "string", description: "可选图层组 ID；同一作品的一组分层素材使用同一个组。" },
            resumeLayerGroupId: { type: "string", description: "仅用于恢复失败的分层任务。必须复制 Current Workbench Snapshot 中 layerRecovery 对应的真实组 ID；工具会复用该组已成功图层。不要猜测或用于新任务。" },
            retryLayerIds: { type: "array", minItems: 1, maxItems: 8, uniqueItems: true, items: { type: "string" }, description: "仅与 resumeLayerGroupId 同时使用；若填写，必须完整复制 layerRecovery failed 列表。省略时重试该组全部失败层，绝不能包含 successful 图层。" },
            transparentPreferred: { type: "boolean", description: "是否优先生成透明 PNG 素材；适合前景、角色、贴纸、文字等图层。" },
            title: { type: "string", description: "compose/layer_merge 的标题。" },
            compositionId: { type: "string" },
            width: { type: "integer", minimum: 64, maximum: 8192 },
            height: { type: "integer", minimum: 64, maximum: 8192 },
            summary: { type: "string" },
            layers: {
              type: "array",
              maxItems: 32,
              description: "operation=layer_merge 时使用。顺序从底层到顶层。",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  title: { type: "string" },
                  prompt: { type: "string" },
                  sourceNodeId: { type: "string" },
                  assetIndex: { type: "integer", description: "源节点图片序号；1 表示第一张，也兼容 0。" },
                  x: { type: "number" },
                  y: { type: "number" },
                  width: { type: "number" },
                  height: { type: "number" },
                  scale: { type: "number" },
                  opacity: { type: "number", minimum: 0, maximum: 1 },
                  visible: { type: "boolean" },
                  blendMode: { type: "string", enum: ["normal", "multiply", "screen", "overlay", "source-over"] }
                }
              }
            },
            layerPlan: {
              type: "array",
              minItems: 2,
              maxItems: 8,
              description: "operation=layers 时必填。按从底层到顶层列出要生成的全部 PNG 图层；用户指定 N 层时必须准确提供 N 项，不得合并、省略或补默认层。",
              items: {
                type: "object",
                properties: {
                  id: { type: "string", description: "稳定的英文或拼音图层标识。" },
                  title: { type: "string", description: "用户可读的图层名称。" },
                  role: { type: "string", enum: ["background", "subject", "foreground", "decoration", "text", "shadow", "other"], description: "语义归属。background=唯一不透明底层；subject=主要人物、动物或其他有生命主体；decoration=商品、香水瓶、服装单品、手持物、家具、器皿及其他独立物件，即使标题叫‘人物道具’也使用 decoration；foreground=前景氛围与框景；text=实际文字；shadow=独立阴影。" },
                  prompt: { type: "string", description: "该图层应从合成预览中精确保留的视觉内容，不得重新设计或新增主体。" },
                  text: { type: "string", description: "仅 role=text 使用：该层要实际绘制的完整文字正文，必须是可直接排版的 literal copy，不能写成‘标题字形’等占位说明。" },
                  transparent: { type: "boolean", description: "除 background 外通常为 true。" }
                },
                required: ["id", "title", "role", "prompt", "transparent"]
              }
            },
            parentId: { type: "string", description: "来源节点 ID。通常填写来源图片节点；当前选中的是可复用需求节点时可填写该需求节点 ID，运行时会沿其左侧连线读取真正的 SOURCE，并把新成果连接到需求节点右侧。" },
            assetIndex: { type: "integer", minimum: 0, description: "parentId 指向多图容器时选择其中哪张图片；0 表示第一张。省略时使用第一张。" },
            sourceBindingId: { type: "string", description: "可选的精确素材 bindingId。普通任务通常省略；只有必须指定容器槽位或明确编辑目标时，才复制 Current Task Scope materials 中的 bindingId。不要自行构造。" },
            sourceAssetId: { type: "string", description: "可选的精确素材 ID，必须来自 Current Task Scope materials。普通任务通常省略，由 parentId/assetIndex 或当前选中成果提供上下文。" },
            sourceImage: {
              type: "object",
              properties: {
                 bindingId: { type: "string", description: "Current Task Scope materials 中的精确 bindingId；存在时优先于 assetId。普通任务通常不需要填写。" },
                 assetId: { type: "string", description: "Current Task Scope materials 中的素材 assetId。" },
                 role: { type: "string", enum: ["edit_target", "source"], description: "仅在需要精确声明编辑目标时使用 edit_target/source；普通任务由模型根据上下文判断。" },
                 purpose: { type: "string", description: "明确说明从这张图使用什么，以及哪些身份、几何、文字、结构或版式必须保持不变。" }
              },
              required: ["bindingId"],
              additionalProperties: false
            },
            referenceImages: {
              type: "array",
              maxItems: 9,
              description: "可选地从 Current Task Scope materials 引用最多 9 张参考素材。普通任务通常省略，由模型根据用户意图判断身份、商品、风格、构图或场景用途；显式填写时用于锁定参考用途，不决定输出数量。",
              items: {
                type: "object",
                properties: {
                  bindingId: { type: "string", description: "Current Task Scope materials 中的稳定 bindingId；同一 assetId 多次出现时用于精确指定对应素材。" },
                  assetId: { type: "string", description: "Current Task Scope materials 中的素材 assetId。" },
                  displayCode: { type: "string", description: "可选的人类可读编号，用于和用户表达对账；运行时仍以 assetId 为准。" },
                  role: { type: "string", enum: ["identity", "subject", "garment", "product", "style", "composition", "scene"], description: "可选的参考用途角色；普通任务由模型根据上下文判断，不使用 edit_target/source。" },
                  purpose: { type: "string", description: "该图具体提供什么、不得替换什么、需要锁定哪些身份或视觉不变量。" }
                },
                required: ["bindingId"],
                additionalProperties: false
              }
            }
          },
          required: ["operation"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "view_image",
        description: "View a local image file from the filesystem when visual inspection is needed. Use detail=high for normal composition, text and consistency review, especially when inspecting multiple images. For a comparison, emit parallel view_image calls for the result and all necessary references in the same assistant turn; do not alternate or repeatedly reopen the same paths across later rounds. Use detail=original only for one image when exact native pixels or resolution are essential.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Local filesystem path to an image file." },
            detail: { type: "string", enum: ["high", "original"], description: "Image detail level. Defaults to high. Use high for ordinary review and all multi-image review; use original only for a single image when exact native pixels or resolution are essential." }
          },
          required: ["path"],
          additionalProperties: false
        }
      }
    },
    {
      type: "function",
      function: {
        name: "ask_user",
        description: "向用户请求完成任务所必需的补充信息。用于缺少关键选择、必须确认高影响操作，或缺少任务要求的图片。普通任务已有 materials 时不要为了素材角色分类调用；确实没有可用素材且用户要求修改时用 source_images，需要额外视觉参考时用 reference_images。不要用它询问可自行合理默认的审美细节。",
        parameters: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["clarify", "confirm", "source_images", "reference_images"], description: "clarify=追问缺失信息；confirm=确认高影响操作；source_images=在没有可用 materials 时收集待处理图片；reference_images=补充明确需要的视觉参考。" },
            title: { type: "string", description: "弹窗标题。" },
            question: { type: "string", description: "直接问用户的一句话问题。" },
            detail: { type: "string", description: "可选补充说明，说明为什么需要用户补充。" },
            suggestedAnswer: { type: "string", description: "可选建议答案或格式提示。" },
            options: {
              type: "array",
              minItems: 2,
              maxItems: 3,
              description: "kind=confirm/clarify 时可提供 2-3 个互斥的短选项。批量风险确认优先给出‘先生成 3 版核对（建议）/阶段性批量/直接批量’；不要再添加 Other，界面保留自定义回复。",
              items: {
                type: "object",
                properties: {
                  id: { type: "string", description: "稳定、简短的选项 ID。" },
                  label: { type: "string", description: "1-8 个字的选项名称。" },
                  description: { type: "string", description: "一句话说明影响或权衡。" },
                  answer: { type: "string", description: "选择后发送回 Agent 的明确答案。" },
                  recommended: { type: "boolean", description: "最多一个选项为 true。" }
                },
                required: ["id", "label", "answer"],
                additionalProperties: false
              }
            },
            maxSourceImages: { type: "integer", minimum: 1, maximum: 40, description: "kind=source_images 时最多收集的原图数量。" },
            maxReferenceImages: { type: "integer", minimum: 1, maximum: 9, description: "kind=reference_images 时最多收集的参考图数量。" }
          },
          required: ["kind", "question"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "workflow",
        description: "成果画布管理工具。用于查看、描述、定位、删除、清理或更新成果，维护成果之间的来源关系，并对当前项目受管的图片组执行重命名、替换槽位或批量导出。不要创建 Agent、任务、计划、提示词步骤、后期步骤或工具调用节点；真实生成和修改图片时使用 image_gen。",
        parameters: {
          type: "object",
          properties: {
            operation: {
              type: "string",
              description: "成果操作：list_nodes 查看成果；describe_node 读取成果详情；focus_node 定位成果；connect_nodes 建立成果来源关系；disconnect_node 移除关系；delete_node 删除成果；clear_canvas 清空成果画布；update_node 修改成果元数据；update_social_content 将完成的社媒文案/卡片/分镜结构化写回当前 Requirement；rename_image_collections 重命名一个或多个图片组；replace_image_collection_item 用当前画布受管资产替换图片组槽位并保留瑕疵记录；export_image_collections 将一个或多个图片组导出到当前项目目录；continue_node/redraw_node/cutout_node 基于已有图片继续工作。图片组操作不能提交路径、URL 或目标目录。",
              enum: [
                "list_nodes",
                "describe_node",
                "focus_node",
                "connect_nodes",
                "disconnect_node",
                "delete_node",
                "clear_canvas",
                "update_node",
                "update_social_content",
                "rename_image_collections",
                "replace_image_collection_item",
                "export_image_collections",
                "continue_node",
                "redraw_node",
                "cutout_node"
              ]
            },
            nodeId: { type: "string", description: "目标成果 ID；如果用户只说标题且你不确定 ID，可改用 nodeTitle。" },
            nodeTitle: { type: "string", description: "目标成果标题选择器。用于 focus_node/describe_node/update_node/disconnect_node/delete_node/continue_node/redraw_node/cutout_node。" },
            sourceId: { type: "string", description: "connect_nodes 的来源成果 ID；如果用户只说标题且你不确定 ID，可改用 sourceTitle。" },
            sourceTitle: { type: "string", description: "connect_nodes 的来源成果标题选择器。" },
            targetId: { type: "string", description: "connect_nodes 的目标成果 ID；如果用户只说标题且你不确定 ID，可改用 targetTitle。" },
            targetTitle: { type: "string", description: "connect_nodes 的目标成果标题选择器。" },
            relationType: { type: "string", enum: ["derived-from", "referenced", "variant", "grouped"], description: "connect_nodes 的成果关系。derived-from=直接衍生；referenced=作为参考；variant=同源变体；grouped=仅组织归组。默认 derived-from。" },
            direction: { type: "string", enum: ["input", "output", "both"], description: "disconnect_node 的断开方向。input=移除当前成果的来源；output=移除以当前成果为来源的关系；both=两者都移除。不确定时用 input。" },
            deleteMode: { type: "string", enum: ["only", "branch"], description: "delete_node 的删除范围。only=默认，只删当前成果并保留衍生成果；branch=删除当前成果和所有衍生成果，只有用户明确要求时使用。" },
            title: { type: "string", description: "update_node 更新成果时使用的新标题。" },
            prompt: { type: "string", description: "更新成果说明，或 continue_node 的后续生成要求。真正生成或修改图片请用 image_gen(prompt=...)。" },
            socialPlan: {
              type: "object",
              description: "update_social_content 的完整社媒计划。保留 SOCIAL_PLAN_JSON 中的 platform、workflowId、比例、页数/分镜数和时长，并补齐标题、正文/脚本、标签、封面、cards 或 shots。",
              properties: {
                platform: { type: "string", enum: ["xiaohongshu", "douyin"] },
                workflowId: { type: "string" },
                brief: { type: "string" },
                audience: { type: "string" },
                objective: { type: "string" },
                language: { type: "string" },
                titleCandidates: { type: "array", items: { type: "string" } },
                recommendedTitle: { type: "string" },
                title: { type: "string" },
                body: { type: "string" },
                script: { type: "string" },
                subtitleText: { type: "string" },
                tags: { type: "array", items: { type: "string" } },
                cover: { type: "object" },
                cards: { type: "array", items: { type: "object" } },
                hooks: { type: "array", items: { type: "string" } },
                shots: { type: "array", items: { type: "object" } },
                status: { type: "string", enum: ["draft", "approved", "generated", "exported"] }
              },
              required: ["platform", "workflowId"]
            },
            status: { type: "string", enum: ["queued", "working", "review", "done"] },
            x: { type: "number" },
            y: { type: "number" },
            parentId: { type: "string", description: "成果来源 ID。生成或修改图片时优先使用 image_gen.parentId，由运行时自动建立来源关系。" },
            assetIndex: { type: "integer", minimum: 0, description: "图片资产序号；0 表示第一张。" },
            collectionId: { type: "string", minLength: 1, maxLength: 120, description: "单个图片组 ID。仅使用当前画布返回的受管图片组 ID。" },
            collectionIds: {
              type: "array",
              minItems: 1,
              maxItems: 200,
              uniqueItems: true,
              items: { type: "string", minLength: 1, maxLength: 120 },
              description: "export_image_collections 要导出的当前项目图片组 ID 列表；不要填写路径。"
            },
            format: {
              type: "string",
              enum: ["png", "jpeg", "webp", "avif", "tiff"],
              description: "export_image_collections 的明确输出格式。JPEG 会以白色背景展平透明像素。"
            },
            name: { type: "string", minLength: 1, maxLength: 240, description: "图片组新名称；运行时会执行 Windows 安全清洗和重复处理。" },
            itemId: { type: "string", minLength: 1, maxLength: 120, description: "replace_image_collection_item 的原图片组 item ID。" },
            requestIndex: { type: "integer", minimum: 1, maximum: 200, description: "replace_image_collection_item 的原图片请求序号（一-based）。" },
            sourceCollectionId: { type: "string", minLength: 1, maxLength: 120, description: "replace_image_collection_item 的原结果图片组 ID。" },
            replacementNodeId: { type: "string", minLength: 1, maxLength: 160, description: "当前画布中已受管替换图片所在的节点 ID；不能是本地路径。" },
            replacementAssetIndex: { type: "integer", minimum: 0, maximum: 199, description: "替换节点中的图片资产序号（zero-based）。" },
            defectReason: { type: "string", minLength: 1, maxLength: 320, description: "替换原因，将写入独立瑕疵图片组。" },
            requests: {
              type: "array",
              minItems: 1,
              maxItems: 200,
              description: "rename_image_collections 使用 [{collectionId,name}]；replace_image_collection_item 使用 [{sourceCollectionId,itemId 或 requestIndex,replacementNodeId,replacementAssetIndex,defectReason}]。",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  collectionId: { type: "string", minLength: 1, maxLength: 120 },
                  name: { type: "string", minLength: 1, maxLength: 240 },
                  sourceCollectionId: { type: "string", minLength: 1, maxLength: 120 },
                  itemId: { type: "string", minLength: 1, maxLength: 120 },
                  requestIndex: { type: "integer", minimum: 1, maximum: 200 },
                  replacementNodeId: { type: "string", minLength: 1, maxLength: 160 },
                  replacementAssetIndex: { type: "integer", minimum: 0, maximum: 199 },
                  defectReason: { type: "string", minLength: 1, maxLength: 320 }
                }
              }
            },
            expectedProjectId: { type: "string", minLength: 1, maxLength: 160, description: "当前项目 ID；运行时也会与活动项目核对。" },
            expectedCanvasRevision: { type: "integer", minimum: 0, description: "读取 canvas.state 后得到的画布版本，用于阻止过期写入。" },
            confirmed: { type: "boolean", description: "export_image_collections 必须显式传 true。" },
            offset: { type: "integer", minimum: 0, description: "list_nodes 分页起点，默认 0。" },
            limit: { type: "integer", minimum: 1, maximum: 100, description: "list_nodes 每页数量，默认 25，最大 100。" },
            query: { type: "string", description: "list_nodes 按节点 ID、标题或提示词模糊筛选。" },
            type: { type: "string", enum: ["intent", "image", "review", "export", "branch", "post"], description: "list_nodes 按成果类型筛选。" },
            relation: { type: "string", enum: ["root", "derived-from", "referenced", "variant", "grouped"], description: "list_nodes 按来源关系筛选；root 表示没有父节点。" },
          },
          required: ["operation"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "experience",
        description: "FastMemory 绘画经验工具。用于读取、写入、替换或整理可复用的绘画经验，例如用户稳定偏好、风格约束、构图/质感/配色经验。不要用它管理系统 Prompt、工具 schema、临时 compact 摘要或普通聊天记录；真正生图仍使用 image_gen。",
        parameters: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["add", "read", "replace", "compact"] },
            title: { type: "string", description: "经验标题。" },
            text: { type: "string", description: "可复用绘画经验。必须写成稳定偏好、风格约束、构图/质感/配色经验，而不是本轮临时聊天记录。" },
            summary: { type: "string", description: "整理经验时的摘要。" },
            instruction: { type: "string", description: "整理经验时的保留规则。" },
            rating: { type: "string", enum: ["good", "bad", "mixed", "note"] }
          },
          required: ["action"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "context_manage",
        description: "内部兼容工具。主 Agent 不应直接使用；Prompt/compact/MemoryContext 由运行时维护，绘画经验请使用 experience。",
        parameters: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["add", "write", "replace", "read", "compact", "add_experience"] },
            target: { type: "string", enum: ["context", "fastmemory", "memorycontext"] },
            selector: { type: "string", description: "示例：all、2、2-5、2,3,5、ent-20260616-000001、ent-... - ent-..." },
            title: { type: "string" },
            kind: { type: "string" },
            text: { type: "string" },
            summary: { type: "string" },
            instruction: { type: "string" },
            section: { type: "string", description: "记忆分区，例如 surface、experience、public。主 Agent Prompt 由专用配置接口维护，不属于此工具。" },
            keywords: { type: "array", items: { type: "string" } },
            sourceEntryIds: { type: "array", items: { type: "string" } },
            rating: { type: "string", enum: ["good", "bad", "mixed", "note"] }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "memory",
        description: "Memory 工具组。operation=add 写入 datememory 日记；check 检索 datememory/metamemory/toolmemory；read 精确读取 toolmemory 或记忆内容。",
        parameters: {
          type: "object",
          properties: {
            operation: { type: "string", enum: ["add", "check", "read"] },
            target: { type: "string", enum: ["datememory"] },
            entries: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  date: { type: "string", description: "YYYY-MM-DD" },
                  title: { type: "string" },
                  content: { type: "string" },
                  keywords: { type: "array", items: { type: "string" } },
                  sourceEntryIds: { type: "array", items: { type: "string" } }
                },
                required: ["date", "content"]
              }
            },
            clearContext: { type: "boolean" },
            date: { type: "string" },
            entryId: { type: "string" },
            keyword: { type: "string" },
            keywords: { type: "array", items: { type: "string" } },
            scope: { type: "string", enum: ["date", "datememory", "meta", "metamemory", "tool", "toolmemory"] },
            lineStart: { type: "integer" },
            lineEnd: { type: "integer" }
          },
          required: ["operation"]
        }
      }
    }
  ]);
}

function agentToolSchemas(settings = {}, options = {}) {
  const schemas = toolSchemas(settings);
  const imageTool = schemas.find((tool) => String(tool.function?.name || "") === primaryImageToolName);
  if (!imageTool) return [];
  const sourceParameters = imageTool.function?.parameters || { type: "object", properties: {} };
  const sourceProperties = sourceParameters.properties || {};
  const visiblePropertyNames = [
    "operation",
    "prompt",
    "ratio",
    "resolution",
    "quality",
    "count",
    "generationMode",
    "scopeExecution",
    "commercePlanHash",
    "slotId",
    "slotIndex",
    "localeCode",
    "socialContentType",
    "socialSlot",
    "items",
    "outputFormat",
    "background",
    "inputFidelity",
    "parentId",
    "assetIndex",
    "sourceBindingId",
    "sourceAssetId",
    "sourceImage",
    "referenceImages",
    "layerPlan",
    "resumeLayerGroupId",
    "retryLayerIds"
  ];
  const visibleProperties = Object.fromEntries(
    visiblePropertyNames
      .filter((name) => sourceProperties[name])
      .map((name) => [name, sourceProperties[name]])
  );
  visibleProperties.operation = {
    ...visibleProperties.operation,
    enum: ["generate", "edit", "replace", "variants", "layers", "cutout", "redraw"],
    description: "generate=文字或参考图生成；edit=锁定来源身份、商品、服装或成功构图后继续设计；replace=只替换指定元素或文字；variants=基于来源图生成多种独立款式或角度，各款差异必须逐项填写 items；layers=输出可重组分层 PNG；cutout=打开用户涂抹范围编辑器后提取主体并输出透明 PNG；redraw=打开区域编辑器后只重绘用户蒙版区域。模型调用 cutout/redraw 只会打开编辑器，不能直接提交蒙版或开始生成。"
  };
  visibleProperties.parentId = {
    ...visibleProperties.parentId,
    description: "可选来源成果 ID。省略时自动使用当前选中的图片成果；只有明确引用其他成果时才填写。显式填写不存在的 ID 会失败，不要猜测。"
  };
  visibleProperties.sourceImage = {
    ...visibleProperties.sourceImage,
    description: "可选的精确素材绑定对象。普通任务通常省略；需要指定容器槽位或明确编辑目标时，复制 Current Task Scope materials 提供的 bindingId，或使用 parentId/assetIndex。不要自行构造 bindingId。"
  };
  if (visibleProperties.items) {
    const { minItems: _discardedPublicMinItems, ...publicItems } = visibleProperties.items;
    visibleProperties.items = {
      ...publicItems,
      description: "可选，但用户逐一列出至少两张不同款式、氛围、角度或版式时必须填写 items，每项只描述一张独立完整成品，并重复人物身份、商品几何、服装结构、版式、文字等核心不变量，只改变该项指定变量；不能把多个互斥方案合并进顶层 prompt。count=1 时省略 items 并只使用顶层 prompt，完全相同提示词的多张随机变体、edit/replace/cutout/redraw 也应省略整个 items 字段。不要填写 unused、占位、temp、todo 或数字序号凑项。"
    };
  }
  for (const name of ["items", "sourceImage", "referenceImages", "layerPlan", "retryLayerIds"]) {
    const property = visibleProperties[name];
    if (!property) continue;
    if (property.type === "object") {
      visibleProperties[name] = { ...property, additionalProperties: false };
      continue;
    }
    if (property.type === "array" && property.items?.type === "object") {
      visibleProperties[name] = {
        ...property,
        items: { ...property.items, additionalProperties: false }
      };
    }
  }
  const publicImageTool = {
    ...imageTool,
    function: {
      ...imageTool.function,
      description: "图片执行工具：单图、连续系列、顺序分批图片组、不同提示词批量、参考图精确编辑、换物改字、多角度、服装上身、电商商品图、Logo 栅格概念、UI 视觉、插画、角色与游戏原画、分层 PNG、抠图和区域重绘。结果自动进入成果画布。",
      parameters: {
        ...sourceParameters,
        additionalProperties: false,
        properties: visibleProperties,
        required: ["operation", "prompt"]
      }
    }
  };
  const workflowTool = schemas.find((tool) => String(tool.function?.name || "") === "workflow");
  const publicWorkflowTool = workflowTool
    ? {
        ...workflowTool,
        function: {
          ...workflowTool.function,
          description: "成果画布管理工具。管理已有图片成果、溯源关系，并可将完整社媒内容写回当前结构化 Requirement；不创建任务、Prompt、工具或执行步骤节点。",
          parameters: workflowTool.function.parameters
        }
      }
    : null;
  if (publicWorkflowTool?.function?.parameters?.properties?.operation) {
    publicWorkflowTool.function.parameters.properties.operation = {
      ...publicWorkflowTool.function.parameters.properties.operation,
      enum: ["list_nodes", "describe_node", "focus_node", "connect_nodes", "disconnect_node", "delete_node", "clear_canvas", "update_node", "update_social_content", "rename_image_collections", "replace_image_collection_item", "export_image_collections"]
    };
  }
  const experienceTool = schemas.find((tool) => String(tool.function?.name || "") === "experience");
  const experienceProperties = experienceTool?.function?.parameters?.properties || {};
  const publicExperienceTool = experienceTool
    ? {
        ...experienceTool,
        function: {
          ...experienceTool.function,
          description: "当前项目当前会话的 FastMemory 绘画经验工具。可读取、写入、整体替换或整理稳定的绘画偏好与经验；不管理系统 Prompt、工具 schema、compact 摘要或普通聊天记录。",
          parameters: {
            ...experienceTool.function.parameters,
            additionalProperties: false,
            properties: Object.fromEntries(
              ["action", "title", "text", "summary", "instruction", "rating"]
                .filter((key) => experienceProperties[key])
                .map((key) => [key, experienceProperties[key]])
            ),
            required: ["action"]
          }
        }
      }
    : null;
  const publicNames = ["shell_command", "view_image", "ask_user"];
  const includeNativeWebSearch = options.includeNativeWebSearch !== false;
  const publicTools = [
    publicImageTool,
    ...schemas.filter((tool) => publicNames.includes(String(tool.function?.name || ""))),
    ...(includeNativeWebSearch ? [nativeWebSearchToolSchema()] : []),
    ...(publicExperienceTool ? [publicExperienceTool] : []),
    ...(publicWorkflowTool ? [publicWorkflowTool] : [])
  ];
  return publicTools.map((tool) => {
    if (String(tool?.type || "") !== "function" || !tool?.function) return tool;
    const parameters = tool.function?.parameters || { type: "object", properties: {} };
    const name = String(tool.function?.name || "");
    const supportsBrief = [primaryImageToolName, "experience", "workflow", "ask_user"].includes(name);
    return {
      ...tool,
      function: {
        ...tool.function,
        parameters: {
          ...parameters,
          ...(supportsBrief
            ? {
                properties: {
                  ...(parameters.properties || {}),
                  brief: {
                    type: "string",
                    description: "一句简短、用户可读的执行说明。不要写 Brief 标题，不要暴露文件路径或内部参数。"
                  }
                }
              }
            : {})
        }
      }
    };
  });
}

module.exports = {
  agentToolSchemas,
  imageModelContractForSettings,
  imageModelPoolFromSettings,
  imageModelToolProperty,
  normalizeToolSchemas,
  primaryImageToolName,
  toolSchemas
};
