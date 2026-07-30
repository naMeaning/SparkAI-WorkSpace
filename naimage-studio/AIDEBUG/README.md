# AIDEBUG 控制层

`AIDEBUG/` 是项目根目录下的自动化推进与证据入口。它不复制现有 GUI harness；真实启动、操作与状态断言仍由 `scripts/aidebug-gui.mjs` 和 `scripts/aidebug/**` 负责，本目录补齐目标绑定、多 Agent 工作包、并发资源控制、截图裁切拼接和聚合报告。

## 当前能力审计

| 能力 | 现状 | 权威入口 |
| --- | --- | --- |
| 启动真实程序 | 已有。自动选择 Vite/CDP 端口，以独立 user-data/config 启动 Electron，失败或结束时终止已跟踪进程 | `corepack pnpm run aidebug:gui` |
| UI 功能闭环 | 已有。模拟真实手势，采集 React/画布/DOM 状态，检查可见性、裁切、尺寸、遮挡与稳定帧 | `scripts/aidebug-gui.mjs` 与各专项 package script |
| 截图证据 | 已有。CDP 双帧、原生回退、尺寸/来源/SHA-256 和证据复核 | GUI `report.json`、`corepack pnpm run aidebug:evidence -- --report=<report>` |
| 裁切与拼接观察 | 现在有统一入口。可从报告、图片或目录收集截图，严格裁切并生成 PNG montage 与独立哈希清单 | `node AIDEBUG/visual-review.mjs ...` |
| 多 Agent 专项测试 | workpack v2 已实现任务/目标哈希、owner lane/task fail-closed、并发 runner 唯一证据目录、原子 claim、wave 屏障、跨 workpack 资源锁、checkpoint、stale reclaim 和 closure report；完整 6-lane 生产 closure 已通过 | `AIDEBUG/run.mjs`、`AIDEBUG/super-goal-contract.mjs`、`AIDEBUG/workpack.mjs` |
| SUPER GOAL 融合 | 现在有机器可读/可更新状态；每次 plan/workpack/report 固化根目标与本清单指纹 | `SUPER_GOAL.json`、`SUPER_GOAL.md`、`catalog.json` |

完整 SUPER GOAL 生产 closure 为 `.diagnostics/aidebug-agents/workpack-2026-07-29T17-05-37-525Z-192677e4/state/closures/closure-2026-07-29T17-15-26-049Z-30ab311c.json`，SHA-256 `0c6df74e42a01be739d07c3443d7d9fa7ce28825a3547b2cf62f690634114e6e`。它覆盖 6/6 lanes、17/17 tasks、4/4 人工视觉 review 与 20 张协议认可截图，且 `inputDrift=[]`。Graph CLI 与 stop fence 的历史专项证据继续保留，不替代该完整 closure。

图片专项固定检查真实 PNG/JPEG/WebP 生成字节与 PNG/JPEG/WebP/AVIF/TIFF 本地导出；GUI 和 `canvas.export-image` 共享同一格式注册表。Bundle 采用 hard/advisory 分层，产品性能使用独立发布门禁；后续优先自然异步模块，但不得仅为跨越任何 Bundle 硬门禁或 advisory 数字牺牲可维护性、增加高风险重构或复杂拆分。AIDEBUG workpack 默认不会运行正式 build、Bundle 或发布全量门禁。

## 安全的日常入口

先校验 catalog，不运行测试：

```powershell
node AIDEBUG/run.mjs --check
node AIDEBUG/run.mjs --list
```

只验证 AIDEBUG 本轮改动，五个独立 lane 最多四路并行：

```powershell
node AIDEBUG/run.mjs --profile aidebug-infra --jobs 4
```

只验证一个发生改动的长期目标 lane：

```powershell
node AIDEBUG/run.mjs --profile super-goal-specialists --agent node-interaction-agent --jobs 1
```

只运行一个明确专项：

```powershell
node AIDEBUG/run.mjs --task image-batch-scheduler
```

Skill 节点、重复导入、异常 frontmatter 以及主/独立 Agent TaskScope 控件的真实 GUI 专项：

```powershell
corepack pnpm run aidebug:skills
```

不带 `--profile` 或 `--task` 会直接失败，不存在隐式全量套件。`super-goal-specialists` 和 `ui-specialists` 即使显式选择 profile，也必须再提供 `--agent` 才允许运行。正式发布的全量验证仍由用户明确要求后使用 `release:final`。

## 多 Codex Agent 工作包

为最终 closure 生成覆盖该 profile 全部 owner lane 的不可变 workpack v2，不启动测试或模型：

```powershell
node AIDEBUG/run.mjs --profile super-goal-specialists --emit-workpack
```

`--emit-workpack` 未提供 `--agent` 时会纳入整个 profile；提供一个或多个重复的 `--agent` 时只冻结明确选择的 lane。`super-goal-specialists` 的完整 profile 必须覆盖 `SUPER_GOAL.*` 中每个 workstream 的 owner lane，包括独立的 `gui-smoke-agent`，否则该 workpack 不能作为最终完成证据。

输出位于 `.diagnostics/aidebug-agents/workpack-*/`，其中 `workpack.json` 与 `workpack.integrity.json` 固化：

- 每个 Agent 的精确 task IDs、超时、资源、网络授权、底层 runner 命令和 workpack wrapper 命令；
- 可并行 wave，以及“前一 wave 全部 passed 才能启动”的执行屏障；
- `GOAL.md`、`SUPER_GOAL.*`、catalog、package scripts、`run.mjs`、`super-goal-contract.mjs` 和 `workpack.mjs` 的字节数与 SHA-256；
- 原始 manifest UTF-8 字节的独立 SHA-256，任何重排、改写或旧 v1 manifest 都不能执行。

查看状态、执行一个 lane 和聚合最终报告：

```powershell
node AIDEBUG/workpack.mjs status --workpack <workpack.json>
node AIDEBUG/workpack.mjs run-agent --workpack <workpack.json> --agent aidebug-agent
node AIDEBUG/workpack.mjs collect --workpack <workpack.json>
```

同一 wave 的 wrapper 可以由真正的 Codex 多 Agent 并行启动；原子目录 claim 保证同一 lane 只有一个实际 runner。每个 attempt 在 `state/agents/<agent>/` 保存不可变 claim、追加式哈希链 checkpoint、stdout/stderr、确定性 `runner-result.json` 和终态 `result.json`。`run.mjs` 不再依赖解析混杂 stdout 来猜报告路径。

共享 `electron-ui` 等资源使用 `.diagnostics/aidebug-agents/resource-locks/` 下按规范化资源 SHA-256 命名的全局目录锁，所以不同 workpack 的 wrapper 也会互斥。锁按排序后的资源集合获取，冲突时释放本轮部分锁后等待，避免多资源死锁。这个保证只覆盖 `workpack.mjs` wrapper；直接手工并发多个 `run.mjs` 仍不受跨进程锁保护。

wrapper 异常退出且 parent/child PID 都已消失、heartbeat 超过阈值后，必须显式恢复：

```powershell
node AIDEBUG/workpack.mjs reclaim --workpack <workpack.json> --agent <agent-id> --stale-after-ms 120000
```

reclaim 不删除旧证据：Agent state 目录先以单次 rename 移入 history，随后逐个核对并归档它拥有的资源锁。多个锁并不是一次跨目录事务；若中途发生文件系统错误，可能只完成部分归档，必须检查 history/lock owner 后再恢复。终态 passed/failed 不允许 reclaim，必须生成新 workpack。若记录的 parent 或 child PID 仍存活则拒绝恢复，避免重复启动仍在执行的测试。

`collect` 会重新验证 manifest、当前目标/控制面哈希、Agent/task 精确集合、checkpoint 链、launcher 日志、runner 结果、报告回链和所有文件哈希。Agent 侧 JSON 损坏会记录 `evidence-json-invalid:<relative-path>` 并写出不可变失败 closure，不会让整个收集器崩溃；manifest 或 integrity JSON 损坏仍会在建立可信 workpack 身份之前直接拒绝。每次 collect 都写入不可变的 `state/closures/closure-*.json`；根目录 `closure-report.json` 只是最新派生视图。状态只有 `passed`、`failed`、`incomplete` 或 `stale-inputs`，缺 Agent、运行中、hash 漂移和 GUI 证据缺失都不能伪装为通过。

包含 GUI task 的 lane 还必须先生成 montage，再显式绑定真实 Electron 报告与审阅结论：

```powershell
node AIDEBUG/visual-review.mjs --input <electron-report.json> --max-images 100
node AIDEBUG/workpack.mjs review `
  --workpack <workpack.json> `
  --agent <gui-agent-id> `
  --gui-report <electron-report.json> `
  --visual-review <review.json> `
  --verdict approved `
  --reviewer "Codex/root"
```

review 会核对 GUI report 的启动 checkpoint、执行时间窗、CDP/原生截图来源、`visualReliability`、全部截图与 montage 的真实文件 hash。`visual-review --self-test` 或带 fixture/selftest 标记的合成证据只能测试协议，生产 CLI 不接受它作为视觉闭环。

这里的本地 worker 是确定性的测试执行 lane，不伪装成 AI Agent。真正的 Codex 多 Agent 仍由上层调度器读取 workpack 后分派；workpack 协议负责证明每个 lane 真实执行、没有资源冲突、目标没有漂移，并能被最终 closure 收集。

## UI 截图裁切与拼接

从一轮 GUI 报告收集截图并拼接：

```powershell
node AIDEBUG/visual-review.mjs --input .diagnostics/electron/aidebug-<time>/report.json
```

对每张输入截图裁切 Agent 面板与画布区域并与全图一起拼接：

```powershell
node AIDEBUG/visual-review.mjs `
  --input .diagnostics/electron/aidebug-<time>/report.json `
  --crop agent:980,80,420,720 `
  --crop canvas:0,80,980,720 `
  --columns 3
```

裁切坐标是截图像素，越界会明确失败，不会静默缩小区域或产生误导证据。默认输出到 `.diagnostics/aidebug-review/review-*`：

- `montage.png`：全图与裁切图的联系表；
- `crops/*.png`：独立裁切证据；
- `review.json`：源图/裁切/拼接图尺寸、字节数、SHA-256 与错误。

输出目录必须是新目录或空目录，避免覆盖旧证据。工具自测：

```powershell
node AIDEBUG/visual-review.mjs --self-test
```

## 最小闭环

1. 根据实际改动只选一个 task 或受影响 Agent lane，先用 `--dry-run` 核对计划。
2. 运行后查看 `.diagnostics/aidebug-agents/run-*/report.json`；每个 worker 的日志与状态分别在 `workers/<agent>/`。
3. 只有用户可见改动才运行对应 GUI 专项；不要把 `ui-surface` 与多个专项无差别重复执行。
4. 对 GUI `report.json` 运行 `aidebug:evidence`，再用 `visual-review.mjs` 生成 montage 并真实查看关键状态。
5. 功能、状态、视觉或证据任一失败都不算闭环；审美仍需要人工验收，自动绿色不能代替截图观察。

workpack 协议自身的定向回归只运行：

```powershell
corepack pnpm run test:aidebug-workpack
```

它覆盖 16 路同 Agent 竞态、wave 屏障、passed 幂等、跨 workpack/大小写归一化资源锁、stale reclaim、损坏 Agent JSON 的失败 closure、不可变 closure 历史、输入漂移、manifest 字节篡改，以及真实证据策略拒绝合成 fixture。它不会启动 Electron、访问网络或调用图片模型。

## 已知边界

- catalog 只登记离线或 mock 专项，不会读取真实凭证、调用真实图片服务或产生模型费用。
- `workpack.mjs` 能跨进程、跨 workpack 互斥已声明资源；直接手工启动的 `run.mjs` 不会加入这把全局锁，因此多 Agent 分派必须使用 manifest 中的 wrapper command。
- stale 只在 heartbeat 超时且记录的 parent/child PID 都不存在时允许显式 reclaim。Node 没有 Windows Job Object，超时/终止无法在所有外部启动方式下证明整个后代进程树都已退出；PID 不可见、被复用或状态不确定时协议会保守拒绝，而不会冒险双跑。
- 多资源 reclaim 是“state 目录单次 rename + 各资源锁逐个归档”，不是跨多个目录的原子事务；文件系统错误可能留下可审计的部分进度。
- manifest、checkpoint、result 与 closure 的发布依赖普通文件系统原子操作和 SHA-256 绑定，没有额外 `fsync`/目录 flush，因此不承诺断电级持久性。
- `visual-review.mjs` 负责可复核证据整理，不进行审美打分，也不会根据截图自动修改产品代码。
- 当前工作区处于测试开发阶段，本目录不会自动运行 `build`、`test:bundle`、`release:final` 或未明确选择的测试。
