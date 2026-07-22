# AI Native — 全面 UI + 功能审查与重构计划

## Context

当前项目 AI Native（IIimage）是 Electron + React 生图客户端 + Agent 运行时。Codex（GPT）最近两次大改引入了多项功能性退化：
- **模型选择器损坏**：`openComposerModelPicker` / `selectComposerModel` 中 image provider 逻辑被误删，生图模型无法选择
- **HMR 热更新失效**：全页重载而非模块热替换，迭代效率降低
- **工具名整合过于激进**：删除了前端 agent.ts 仍在使用的工具名映射
- **INDEX.md 未同步更新**：代码索引偏移

用户需要一次**彻底的 UI 和功能审查与复改**，目标：
- VS Code 风格的块状 IDE 布局（纯拼接化）
- 扁平化设计，块与块之间不留空隙
- 充分占用空间
- 现代化-泛未来化 UI 风格
- 修复所有功能退化和 Bug

---

## 一、需要修改的文件

| 文件 | 行数 | 改动范围 |
|------|------|---------|
| `apps/image-studio/src/styles.css` | 7257 | **大幅重写**布局系统，修复间距/嵌套/圆角/阴影等 |
| `apps/image-studio/src/main.tsx` | 8152 | 修复模型选择器 Bug，重构渲染树结构，剥离可复用组件 |
| `apps/image-studio/src/core.ts` | 2519 | 修正 `mergedSettings` 中 agentModelPool 初始化顺序，导出修复 |
| `apps/image-studio/src/agent.ts` | 229 | 对齐 agent.ts 中工具名映射与 agent-runtime.cjs |
| `apps/image-studio/agent-runtime.cjs` | 4599 | 还原被误删的工具名映射，确保前端 bridge 兼容 |
| `apps/image-studio/electron-main.cjs` | 2568 | 保留 IPC debug 新增，无需改 |
| `apps/image-studio/src/server.ts` | 548 | 无需改动 |
| `apps/image-studio/src/ui.tsx` | 418 | 无需改动 |
| `INDEX.md` | 项目根 | 更新代码索引 |
| `AGENTS.md` | 项目根 | 更新警戒线中常犯错误的修正记录 |

---

## 二、改造方案

### Phase A: CSS 布局重构（核心）— styles.css

#### A1. 移除所有 padding/gap/border-radius/box-shadow 中的多余空间

目前布局有大量层叠的空间占用：

```
.ide-main {
  gap: 2px;                    ← 去掉
  padding: 4px;                 ← 去掉
}
.canvas-panel, .agent-panel, .node-inspector, .settings-drawer {
  border: 1px solid var(--line); ← 改为 0 或 hairline（inset shadow 替代）
  border-radius: var(--radius);  ← 改为 0
  box-shadow: ...;               ← 去掉
}
.workspace-resize-handle::before {
  inset: 9px 1px;               ← 改为 inset: 0
}
```

新布局理念：

```
.ide-shell
  grid-template-rows: 38px 1fr    (更紧凑的顶栏)
  
.ide-main
  display: grid
  grid-template-columns: var(--inspector-w, 200px) 4px 1fr 4px var(--agent-w, 420px)
  gap: 0                          ← gap = 0
  padding: 0                      ← padding = 0
```

#### A2. 组件面板扁平化改造

每个面板（NodeInspector / Canvas / AgentPanel）去掉：
- border → 换成 `box-shadow: inset -1px 0 0 ...`（仅分隔线）
- border-radius → 0
- 内部 padding 压缩

#### A3. 顶栏（ide-topbar）紧凑化

```css
.ide-topbar {
  height: 38px;
  padding: 0 8px;
  gap: 6px;
}
```

#### A4. 浮动元素（对话框、弹出菜单）保留圆角

- 对话框/弹出菜单/提示框这些"浮动层"保留适当的圆角和阴影（它们是 UI 中的"前景"）
- 但去掉套嵌的 card 结构

#### A5. Canvas 区域全屏化

- Canvas 面板内部移除多余的 padding/margin
- Node 之间的间距由用户控制（画布拖拽），不施加额外间距

#### A6. 响应式优化

- 在小屏下不是简单地堆叠，而是合理的隐藏/折叠
- 保留 `inspector-collapsed` / `agent-collapsed` 状态

---

### Phase B: 功能修复 — main.tsx + core.ts + agent.ts

#### B1. 修复模型选择器（最高优先级）

还原 `openComposerModelPicker`、`selectComposerModel` 中的 image provider 分支：

```typescript
function openComposerModelPicker(provider: ModelProvider) {
  const shouldOpen = modelPicker.open !== provider;
  setModelPicker((current) => ({ ...current, open: current.open === provider ? null : provider, error: "" }));
  if (!shouldOpen) return;
  // 恢复：image provider 也需要打开模型列表
}

function selectComposerModel(provider: ModelProvider, model: string) {
  if (provider === "image") {
    setSettings((current) => toggleImageModelSelection(current, model));  // 恢复
    setModelPicker((current) => ({ ...current, open: null }));
    return;
  }
  setSettings((current) => setPrimaryAgentModelSelection(current, model));
  setModelPicker((current) => ({ ...current, open: null }));
}
```

#### B2. 恢复被误删的函数

- 恢复 `setComposerPrimaryImageModel`（被 Codex 删除的）
- 恢复 `refreshModelPicker`（从服务器拉取模型列表）—— 更简洁版本
- 恢复 `toggleImageModelSelection`（从 core.ts 中被删除的）

#### B3. 修复 core.ts 的 export 路径

- 在 core.ts 中重新导出 `toggleImageModelSelection`
- 还原 `setPrimaryImageModelSelection`（而不仅仅是 `setPrimaryAgentModelSelection`）
- 检查所有 import 路径是否匹配

#### B4. 修复 agent.ts 工具名映射

还原被 Codex 删除但在前端仍然需要的工具名：

```typescript
export function agentToolLabel(tool?: string, phase?: string) {
  const map = {
    "image_gen": "Image Gen",
    "iiimage_generate_image": "Image Gen",
    "image_generate": "Image Gen",
    "image_edit": "Image Edit",
    "image_redraw": "区域重绘",
    "image_cutout": "AI 抠图",
    "image_layer_merge": "图层合成",
    "workflow": "工作台",
    "workflow_workbench": "工作台",
    "memory": "Memory",
    "memory_add": "写日记",
    "memory_check": "Memory Check",
    ...
  };
}
```

#### B5. 修复 HMR / Fast Refresh

Vite 报错 `"true" export is incompatible`，这是 React Fast Refresh 的限制。解决方案：

1. 确保 main.tsx 没有导出字面量 true（已在 export 中添加守卫）
2. 组件必须使用命名函数或默认导出，且文件名与函数名匹配（或者用 `React.memo`/forwardRef）
3. 检查是否有模块级副作用代码

---

### Phase C: UI 组件结构调整 — main.tsx

#### C1. 提取共享 UI 组件

当前 inline 组件移到文件级或 ui.tsx：

| 当前内联位置 | 提取到 | 理由 |
|---|---|---|
| `BootScreen` | main.tsx 底部 | 已独立 |
| `AuthGate` | 保持 main.tsx | 与状态紧密耦合 |
| `OverflowTooltipLayer` | 已存在 ui.tsx | 良好 |
| `ModelConfigDialog` | 保持 main.tsx | 需要深度耦合状态 |

不拆成多文件，保持"巨型单文件"架构（按用户 AGENTS.md 要求），但合理组织区域

#### C2. 重构渲染树

当前 `App()` 的 return 有 600+ 行（4036-4650），包含整个 render tree。需要：

1. 拆分 render tree 为多个具名 section 函数（如 `renderTopBar`, `renderCanvas`, `renderDialogs` 等）
2. 每个 section 函数有清晰的 props 接口
3. 缩短 `App()` 函数体至可维护范围

---

### Phase D: 开发体验改善

#### D1. Git 分支管理

当前 Codex 直接在 `dev/frontend` 上提交。我们的改动应在新的 feature 分支上：

```bash
git checkout dev/frontend
git checkout -b dev/frontend/ui-flat-redesign
```

#### D2. INDEX.md 同步更新

每次修改后更新 INDEX.md 中的行号映射。
修改 AGENTS.md 记录本轮修复的要点。

---

## 三、执行顺序

```
Phase A — CSS 重构
  A1 → A2 → A3 → A4 → A5 → A6
      ↓ (样式到位后)
Phase B — 功能修复
  B1 → B2 → B3 → B4 → B5
      ↓
Phase C — 组件结构调整
  C1 → C2
      ↓
Phase D — 文档同步
  D1 → D2
```

---

## 四、验证方案

1. **Vite dev server**: `pnpm run dev:image-web` — 启动后无编译错误
2. **模型选择器**: 打开设置 → 生图模型 → 配置 → 能看到模型列表并选择（B1）
3. **Agent 工具调用**: 检查 agent.ts 工具名映射与 agent-runtime.cjs 一致（B4）
4. **HMR**: 修改 main.tsx 后，Vite 控制台应显示 `hmr update` 而非 `page reload`（B5）
5. **布局检查**: 打开应用，检查：
   - 节点检查器左栏无多余边框/圆角/间距
   - Canvas 区域无缝拼接
   - Agent 面板右栏无多余边框/圆角/间距
   - 顶栏紧凑化
   - 对话框弹出保持圆角但内部无嵌套卡
6. **INDEX.md 准确性**: 关键组件行号与实际匹配

---

## 五、风险与注意事项

| 风险 | 缓解 |
|------|------|
| CSS 改动影响其他布局 | 逐步验证，每改一个 section 就检查 |
| 功能修复引入新 Bug | 修复后人工测试基本流程：登录→选模型→生图 |
| main.tsx 代码拆分破坏引用 | 保持单文件架构，仅内联重组 |
| Codex 后续提交覆盖 | 确保分支独立，审核后再合入 dev/frontend |
