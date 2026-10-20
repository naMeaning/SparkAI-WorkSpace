# AI-Native 第三期验证记录（2026-10-20）

本记录覆盖项目知识、本地成果检索与既有需求模板库 v2。本地owner/Runtime、完整源码与安装版Electron交互、性能实测及最终EXE/原位安装均已通过；对应源码与文档普通Git同步由Progress记录。动态结果和最终身份以 [Goal](../GOAL.md) 与 [Progress](../PROGRESS.md) 顶部为准，不能将第二期同名 EXE 计为本期制品。

仅修改桌面与本地 Runtime，复用 TaskScope、第一期任务回执、第二期 creation、catalog、原 requirement-library 与唯一 image_gen。0 真实模型/图片/视频请求；loopback 中的模型和图片 POST 均由本机夹具响应，不涉及外部 New API、Extension、生产服务或计费。长期边界见 [工作流合同](AGENT_WORKFLOW_CONTRACT.md)，owner、镜像规则和存储位置见 [上下文地图](CONTEXT_MAP.md)。

## 已收集的验证

| 验证入口 | 实际证据 | 结论与边界 |
| --- | --- | --- |
| `node scripts/project-knowledge-selftest.cjs` | [13组报告](../.diagnostics/project-knowledge/2026-10-20T05-48-31-386Z/report.json) | 旧项目空读无写、跨会话/跨项目与对象隔离、suggestion显式提升、双owner CAS/删除墓碑、catalog只读权威、历史冻结/伪造拒绝、采用风格失效、确定性预算、不可变contexts、真实fsync→rename/失败保留、子进程重开/损坏拒绝、公开脱敏；0模型请求。 |
| `node scripts/project-result-index-selftest.cjs` | [修后10组及90样本](../.diagnostics/project-result-index/2026-10-20T06-09-28-591Z/report.json) | 原view_image消费证明与Prompt/名称/标签分源；对象/用途/精确来源/采用/观察组合过滤，同字节不同occurrence和稳定分页；搜索只写派生cache，明确使用重验文件；采用撤销、来源/要求/字节/删除失效与损坏重建；跨项目隔离；0模型请求。 |
| `test:project-results-performance` | [真实Main性能及3组安全报告](../.diagnostics/project-result-performance/2026-10-20T06-10-56-143Z/report.json) | Electron 42.6.1 / Node v24.18.0；100/500/1000共享文件与1000独立文件，cold删除派生cache、OS缓存未清；每次1次session读取，逐文件fresh路径/stat检查、hot不重读未变图片bytes。独立occurrence的hash、替换/删除/恢复、Windows junction及legacy metadata只读通过；详情见下文。 |
| `node scripts/requirement-template-selftest.mjs` | [8组报告](../.diagnostics/requirement-template-wyJQjy/report.json) | v1惰性兼容、有限变量/当前项目材料重绑、非法语法/超限拒绝、真实Main sanitizeSession template/templateDraft往返与伪造拒绝、剥离实例秘密、CAS和独立展开快照、严格portable及native导入导出、社媒/科研只保留可复用结构；0模型请求。 |
| `corepack pnpm run test:project-context-runtime` | [10组报告](../.diagnostics/project-context-runtime/2026-10-20T06-11-55-332Z/report.json) | metadata读取链调整后本轮exit0；实际 Main owner+task/session+共享hash+HTTP，9本地Responses POST、1本地图片edit POST、0真实服务请求。模板另经实际工具handler/Main/Renderer命令runtime与真实library展开，应用本身0 HTTP。详细路径见下文。 |
| `test:project-context-legacy` | [3组报告](../.diagnostics/project-context-legacy/2026-10-20T05-49-06-575Z/report.json) | 实际旧ledger的waiting任务→新task service claimAnswer→prepare→admit，按原scope恢复且不注入升级后知识；新任务冻结当前知识，漏知识或借其他task不能绕过；0真实请求。 |
| `node scripts/project-context-projection-selftest.mjs` | [7组报告](../.diagnostics/project-context-projection/2026-10-20T05-39-46-434Z/report.json) | 真实React输出、独立窗DOM与hook，白名单/隐私、同源CAS表单和稳定操作、冲突保留草稿、采用撤销poll、search迟到/顺序/切项目保护。是离线组件证据，不代替真实Electron布局和点击。 |
| `test:project-session-dual-renderer` | 本轮实际exit0，7组stdout；无独立持久report | 两个真实Renderer经Main保存各自冻结知识/模板，并集保留；旧窗口缺字段不清历史，同task改快照及外项目context均拒绝且session原字节不变；真实重开仍保留原历史。 |
| `corepack pnpm run test:project-io` | strict legacy修复后本轮实际exit0；stdout，无独立持久report；322资产 | 原项目IO合同与本地完整知识/模板、AskUser scope保存重开；导出及恶意导入均清空pending/task contexts，源项目本地历史不变。metadata断言：缺项目不创建、canonical损坏明确拒绝且原字节不变、已有revision保留、asset locator不hydrate/回写；8例legacy export/manifest的parse/顶层array/内嵌session array或scalar错误均拒绝、不迁移、不创建canonical metadata，输出contextMetadataReadOnly/contextMetadataLegacyCorruptionRejected=true；夹具正常清理。 |
| project-store metadata review fixture | [8例复验](../.diagnostics/project-metadata-review/2026-10-20T06-17-39-287Z/report.json) | 直接复用实际project-store，对上述legacy损坏组合额外记录writes/logs/hydrates均为0，原字节保留、session.json与canonical metadata均未创建；0模型请求。 |
| `corepack pnpm run test:ipc-registration` | metadata读取链调整后本轮实际exit0；164 registered / 161 preload / 3 internal | 五个新handler唯一注册及preload一致；context command/prepare转发和prepare失败；模板apply/import/export进入原owner。真实requirement-library实例经过IPC导出→导入→应用，原生dialog拿到发起窗口，import不把Renderer payload当窗口。真实fs目录写失败和ENOENT经save/export/import保留错误码，不泄路径或原始IO消息，原库两条不变；业务RequirementLibraryError仍返回安全details。 |
| `node scripts/creation-selftest.cjs` | 本轮实际exit0，16组 | 新私有 `searchSnapshot` 加入后原创建合同、A/B/C、修订、容量、失效与保存合同保持通过；0模型请求。 |

## 实际 Runtime 路径

1. Main prepare 得到完整知识与模板，Renderer `agentTaskScopeSnapshotHash`、Runtime hash、共享clone往返完全一致；知识与模板变量改变均改变scope hash。
2. 先 reserve 固定知识回执，再在 admit 前编辑长期规则；原任务仍按原内容受理。ledger只含refs/summary，不含知识正文，原submission重复返回原任务，携带新版有效知识的同submission在派发前冲突。
3. 真正经过HTTP的主模型回合收到原知识和优先级指令，并能看见公开 `project_context`；get_context、保存assumption建议、保存用户明确长期要求均走Main owner。原活动scope未被新知识改写。
4. AskUser使用原effectiveTaskScope；真实Main sanitize、写session、重开、陈旧session merge保留task上下文，再创建新的task-service/knowledge owner/Runtime回答，仍收到原知识，当前新规则不进入该任务指令。其他会话不读取这一任务的已用知识，其他项目保持空知识。
5. run-control实际预检新增reference节点锁：另一任务占用时commit数为0，模拟持久化失败保留旧hash/锁，成功commit后新节点被锁；文字steer保留同scope，stop释放活动锁，原record仍保留冻结材料。
6. 本地公开search组合名称与intended条件，返回唯一稳定目标且unobserved。查询时模型/图片计数都不增加，原TaskScope未选入素材；之后新任务明确取得当前规则。
7. Runtime依次调用search→use_results→image_gen，前两步图片POST计数不变。唯一实际multipart edit上传所选资产的相同SHA-256，原medium/1:1/1K配置被保留，实时设置的high/3:2/2K漂移不覆盖冻结配置；新成果保存后真实文件hash匹配。
8. Goal扩展、图片派发后绑定、内容替换、错误occurrence、跨项目目标均在下一图片请求前拒绝，额外POST为0。
9. 实际采用风格成果通过知识save/prepare→索引resolveUse形成reference；二次prepare识别已有材料不重复添加，reference投影不反推商品SOURCE；Goal缺少该材料时零请求拒绝。
10. apply_template的公开schema实际校验imageBindings，工具handler→Main applyTemplate→原Renderer `executeAutomationCommand("requirement-library.use")`→真实library.apply展开。当前项目/图片/变量正确，actions为空，旧模板版本、外项目、缺失节点被原入口拒绝，模型/图片HTTP计数均不变；此路径验证命令转发与展开，不代替React主窗真实创建/点击。SOURCE与REFERENCE同identity互换被拒绝，原scope不变，同role重复绑定幂等。

## 本地索引测量

以下保留[最初Node owner基准](../.diagnostics/project-result-index/2026-10-20T05-24-39-101Z/report.json)作为分层证据：使用100/500/1000张真实24×24 PNG，索引file hash并发8。每个规模5种查询，每种1次应用cold和5次hot，共90个样本；cold清本进程索引状态，未清操作系统磁盘缓存。hot仍读取owner元数据并复核stat，未重复读取图片bytes。下表不是生产大图或操作系统完全冷盘的性能承诺，也不替代真实Electron Main链路测量。

| 资产数 | session元数据 B | cold范围 ms | hot范围 ms | hot图片字节读取 |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 72,630 | 46.78–55.38 | 15.63–26.57 | 0 |
| 500 | 362,110 | 151.97–216.14 | 65.54–85.87 | 0 |
| 1000 | 725,460 | 302.22–340.57 | 128.99–150.00 | 0 |

完整query、分页结果数、逐次耗时和冷/热fileReads均在最初Node报告；优化后的10组回归和另90样本见验证表的06:09报告。

## 真实 Electron Main 检索性能

[原真实UI失败报告](../.diagnostics/project-context-ui-2026-10-20T05-54-34-169Z/report.json)记录100/500条的service为2306/11181ms、UI为2438/10962ms；1000条UI超过30秒超时。原UI夹具的各occurrence共用一个受管图片文件，早期Node owner基准没有暴露Main完整项目读取的代价。

[分段定位报告](../.diagnostics/project-result-performance/2026-10-20T06-01-37-554Z/report.json)在已有session root-resolution缓存的中间源码上运行：100/500/1000热查1288/6596/12690ms，其中两次完整`projectSessionFromDisk`合计1035/5320/10235ms、重复受管检查235/1206/2332ms。该报告的cold仅新建owner，加载了已有磁盘派生cache、fileReads为0，不能作为删除cache的真正cold或原UI失败的精确复刻。

修复把知识/检索读取接到project-store的只读metadata owner，由creation私有复用同次session；索引在单次查询内按规范locator共享路径/stat/hash检查，每个occurrence仍独立比较期望hash。asset repository仅在单次validator closure复用roots，每个独立文件仍执行fresh exists/lstat/realpath；下一查询及明确使用重新验证。普通项目打开/hydrate链保持原owner。

最终实际命令为`corepack pnpm exec electron scripts/project-result-performance-selftest.cjs --fixture-root=.diagnostics/project-context-ui-2026-10-20T05-54-34-169Z`，exit0，报告见验证表。环境Windows、Intel Xeon E5-2673 v3 2.40GHz、Electron42.6.1/Node24.18.0、hash并发8；每组cold新建索引并删除派生cache，未清OS缓存，每组各1次cold/hot。使用原UI共享文件夹具并增加1000个独立受管文件；均返回20条分页及正确总数，独立occurrence保留，查询前后session字节hash不变。

| 夹具 | cold ms | hot ms | 每查询session读取 | 每查询受管文件检查 |
| --- | ---: | ---: | ---: | ---: |
| 100 occurrence，共用1文件 | 75.05 | 21.63 | 1 | 1 |
| 500 occurrence，共用1文件 | 94.98 | 66.50 | 1 | 1 |
| 1000 occurrence，共用1文件 | 119.58 | 105.10 | 1 | 1 |
| 1000 occurrence，1000独立文件 | 2408.70 | 1095.42 | 1 | 1000 |

hot图片bytes增量读取均为0，1000独立文件cold读取1000次。共享单文件夹具只证明重复occurrence不重复校验物理文件，不能据此推断1000独立文件或生产大图也在百毫秒内。

同一脚本的3组安全检查实际通过：同物理文件中期望hash错误的occurrence单独排除；同尺寸替换并还原mtime仍由ctime/stat/hash失效，明确使用拒绝，删除/恢复重新检验。已查询后把`assets`替换成指向项目外同字节文件的真实Windows junction，下一search为空且resolveUse拒绝，恢复原目录后可用。legacy manifest内嵌session和`start.naimage` fallback沿原source选择，metadata不hydrate、不serialize、不迁移写回，也不创建缺失的session文件。损坏session的直接metadata拒绝由project-io专项负责，不把该项计入此处3组。

## 真实 UI 性能复验

[performance-only报告](../.diagnostics/project-context-ui-2026-10-20T06-07-54-154Z/report.json)为ok，真实service→Renderer各只渲染20条；3张100/500/1000截图已由UI owner检查。模型和图片POST均0，正常退出exit0、forced:false。

| occurrence数（共用文件） | service首查 ms | service热查三次 ms | UI搜索 ms | 输入＋双rAF ms | 项目ready ms |
| ---: | ---: | --- | ---: | ---: | ---: |
| 100 | 43 | 20 / 30 / 30 | 573 | 30 | 1585 |
| 500 | 70 | 73 / 61 / 61 | 179 | 15 | 6397 |
| 1000 | 131 | 121 / 3751 / 215 | 222 | 20 | 12986 |

1000热查的3751ms离群值保留，原因尚未定位，不能声称所有查询均为低延迟。projectReady仍包含原完整项目打开/hydrate路径，尚未优化；此次性能复验不代替第三期完整知识/CAS/双窗/模板/重启交互验收。

## 失败记录与修复

- 实际模型首请求未暴露 `project_context`：[失败](../.diagnostics/project-context-runtime/2026-10-20T05-40-49-081Z/failure.json)。底层schema已存在，但公开工具白名单遗漏；补齐publicNames/supportsBrief后最终报告证明真实请求可见并执行工具。
- 自动风格reference进入普通TaskScope的sourceAssets投影后，知识owner把reference当商品SOURCE，二次prepare错误报告stale：[失败](../.diagnostics/project-context-runtime/2026-10-20T05-46-22-020Z/failure.json)。在真实来源解析处过滤reference，知识13组和Runtime第9组证明不污染商品归属，Goal仍拒绝超范围。
- IPC模板import原传法把payload当BrowserWindow；Main修为 `importTemplate(owner)`，测试使用真实library/native dialog往返核对窗口，而非仅匹配stub签名。
- 审查发现主Agent apply_template原先返回requirement的workflow.node.create动作，会被Renderer的图片action白名单过滤，且工具schema缺少imageBindings；现改走原requirement-library.use命令，第10组实际handler/Main/Renderer命令runtime和library展开通过。真实fs错误脱敏补充覆盖save/import/export。
- metadata读取审查实测：canonical session缺失且所选旧export/manifest损坏时，旧读取器吞解析失败并返回空项目，[原复现](../.diagnostics/project-metadata-review/2026-10-20T06-13-53-408Z/report.json)保留。metadata现传strict，parse和顶层/内嵌session类型错误均拒绝且不记录私有路径；最终8例owner复验和实际Electron project-io通过，原普通open迁移行为保留。
- 两次早期Runtime夹具失败属于断言读取了system而漏developer指令，原失败文件保留；最终断言读取实际system/developer指令并检查新旧知识分离。它们不计产品已修缺陷。

## 完整源码 Electron 界面

[最终源码报告](../.diagnostics/project-context-ui-2026-10-20T06-23-01-259Z/report.json)7组/15截图通过，4次本地模型POST、2次图片POST、0真实请求；两次正常退出exit0、forced:false。知识明确保存并进入实际任务，成功任务保存原模板库，text/enum/number/image变量及CAS编辑、缺图命名重绑、884×640编辑器与用户改文保留均实际点击。跨项目B只上传B的当前素材字节、使用当前图片配置与模板v3，A知识不进入B；搜索零绑定，定位沿原画布选择，比较不增加素材，明确使用才添加reference。

双窗验证先实际暴露折叠卸载知识草稿，修为同key保留挂载后，正式展开仍保留未保存文字、另一窗更新显示CAS冲突并禁旧保存。停用只影响后续任务，原已用知识版本保持。真实保存重载及正常重启保留模板草稿/绑定/正文/完整task context，旧需求仍可读，同submission不新增图片POST。主/子代理检查最小窗、比较、双窗及重启截图；早期失败报告保留，不计为通过。

脚本 `scripts/project-context-ui-selftest.mjs` 支持 `--exe=... --skip-performance` 复验最终安装版，`--performance-only` 单独运行性能夹具。

## 最终本地交付

[最终安装版UI](../.diagnostics/project-context-ui-2026-10-20T06-30-51-276Z/report.json)7组/15截图通过，4本地模型POST/2图片POST、两次正常退出0/未强杀；关键截图已检查。 安装版仍使用隔离配置/项目与本地loopback，未读取或覆盖日常凭据。

最终[Windows EXE](../release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe) 109,981,696 B / SHA-256 `adfa00602cbc2f2bc0fa8d67e287be256540f99b572cf9371f0cc87e343b6604`；ASAR 52,736,636 B / `72a19260ed610072f0104c3d8517533011a9a74969ca60e66901d6985b9054a5`。681个产品/测试/公开契约源冻结hash `ff8f8719af3cf1b81c3034d5b58e6cd2c8131ef0b60b357b3abe1c609eeed4a4`，130dist/175必需owner存在及逐字节核对通过。

品牌`/S`原位安装exit0/21,706ms，注册目录E:\sparkai-workspace\naimage/1.0.9保留，配置与快捷方式偏好不变；安装EXE/ASAR与候选包相同。安装前所有同名实例为空，未强杀；凭据sidecar仅核对metadata，未读内容。 [包审计](../.diagnostics/project-context-delivery-2026-10-20/package-audit.json)、[安装报告](../.diagnostics/project-context-delivery-2026-10-20/install.json)保存完整身份。最终Git提交/远端身份由Progress与本地交付索引记录，生成物保持忽略。

0真实模型/图片/视频请求；本地Mock不证明通用语义、真实视觉识别、Logo/文字/风格保持、审美或计费。1000项热检索3751ms离群及原项目打开耗时限制保留；1000独立文件冷/热2408.70/1095.42ms。未改外部New API/Extension/生产，未上传EXE、创建Release/tag；不自行启动后续阶段。
