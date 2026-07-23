export async function captureSelectionCommandSuite({ client, targetId, setWindowSize, evaluate, captureState }) {
  await setWindowSize(client, targetId, 1280, 820);
  const suite = await evaluate(client, `new Promise((resolve) => {
    const delay = (ms) => new Promise((done) => setTimeout(done, ms));
    const state = () => window.__naimageDebugAgentState?.() || {};
    const key = (value, options = {}) => window.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...options }));
    const openMenu = async (id) => {
      const node = document.querySelector('.flow-node[data-node-id="' + id + '"]');
      const rect = node?.getBoundingClientRect();
      node?.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: rect ? rect.left + Math.min(80, rect.width / 2) : 420,
        clientY: rect ? rect.top + Math.min(60, rect.height / 2) : 280
      }));
      await delay(180);
      const menu = document.querySelector(".selection-context-menu");
      const buttons = [...(menu?.querySelectorAll("button") || [])];
      return {
        visible: Boolean(menu),
        texts: buttons.map((button) => String(button.textContent || "").replace(/\s+/g, " ").trim()),
        groupDisabled: Boolean(buttons.find((button) => String(button.textContent || "").includes("合并"))?.disabled),
        deleteDisabled: Boolean(buttons.find((button) => String(button.textContent || "").includes("删除"))?.disabled)
      };
    };
    (async () => {
      const api = window.__naimageAIDebug;
      if (!api?.seedSelectionCanvas || !api?.selectNodes) {
        resolve({ ok: false, error: "selection debug bridge unavailable" });
        return;
      }
      await api.seedSelectionCanvas();
      key("a", { ctrlKey: true });
      await delay(220);
      const selectAllState = state();
      const selectAllOk = selectAllState.selectionMode === "multiple" && selectAllState.selectedNodeIds.length === 6;
      const allMenu = await openMenu("A");
      const allMenuOk = allMenu.visible && allMenu.texts.some((text) => text.includes("基于 3 个图片成果提要求")) && allMenu.texts.some((text) => text.includes("合并 3 个")) && allMenu.texts.some((text) => text.includes("删除 5 个"));

      await api.selectNodes({ ids: ["A", "L1", "L2"], primaryId: "A" });
      const mixedMenu = await openMenu("A");
      const mixedMenuOk = mixedMenu.visible && mixedMenu.groupDisabled && !mixedMenu.deleteDisabled && mixedMenu.texts.some((text) => text.includes("删除 3 个"));
      key("Delete");
      await delay(260);
      const deletedState = state();
      const deleteOk = deletedState.nodeCount === 3 && !deletedState.nodes.some((node) => ["A", "L1", "L2"].includes(node.id));
      key("z", { ctrlKey: true });
      await delay(260);
      const undoState = state();
      const undoOk = undoState.nodeCount === 6 && ["A", "L1", "L2"].every((id) => undoState.nodes.some((node) => node.id === id));

      await api.selectNodes({ ids: ["A", "B", "L1"], primaryId: "A" });
      key("g", { ctrlKey: true });
      await delay(280);
      const groupedState = state();
      const grouped = groupedState.layoutGroups?.[0];
      const groupOk = groupedState.layoutGroups?.length === 1 && grouped?.memberNodeIds?.length === 2 && grouped.memberNodeIds.includes("A") && grouped.memberNodeIds.includes("B") && groupedState.nodes.some((node) => node.id === "L1");
      key("g", { ctrlKey: true, shiftKey: true });
      await delay(280);
      const dissolvedState = state();
      const dissolveOk = dissolvedState.layoutGroups?.length === 0 && dissolvedState.nodeCount === 6;

      await api.selectNodes({ ids: ["A", "B"], primaryId: "A" });
      const beforeNudge = state().nodes.filter((node) => ["A", "B"].includes(node.id)).map((node) => ({ id: node.id, x: node.x, y: node.y }));
      key("ArrowRight", { shiftKey: true });
      await delay(180);
      const afterNudge = state().nodes.filter((node) => ["A", "B"].includes(node.id));
      const nudgeOk = beforeNudge.every((before) => afterNudge.some((node) => node.id === before.id && node.x === before.x + 10 && node.y === before.y));

      await api.seedSelectionCanvas();
      await api.selectNodes({ ids: ["A", "B"], primaryId: "A" });
      const requirementMenu = await openMenu("A");
      const requirementAction = [...(document.querySelectorAll(".selection-context-menu button") || [])]
        .find((button) => String(button.textContent || "").replace(/\s+/g, " ").trim().includes("基于 2 个图片成果提要求"));
      requirementAction?.click();
      const editorDeadline = Date.now() + 3000;
      while (Date.now() < editorDeadline && !document.querySelector(".requirement-editor-dialog")) await delay(50);
      const editor = document.querySelector(".requirement-editor-dialog");
      const textarea = editor?.querySelector("textarea");
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "将所选图片作为一个容器，统一生成克制的蓝金电商版本。");
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
      const create = [...(editor?.querySelectorAll("footer button") || [])].find((button) => String(button.textContent || "").trim() === "仅创建");
      create?.click();
      const createDeadline = Date.now() + 3000;
      while (Date.now() < createDeadline && (!state().nodes.some((node) => node.type === "requirement") || document.querySelector(".requirement-editor-dialog"))) await delay(50);
      const requirementState = state();
      const requirementNode = requirementState.nodes.find((node) => node.type === "requirement");
      const requirementGroup = requirementState.layoutGroups?.find((group) => group.hostNodeId === "A");
      const selectionRequirementOk = requirementMenu.visible && Boolean(requirementAction && create && requirementNode?.parentId === "A" && requirementGroup?.memberNodeIds?.includes("A") && requirementGroup?.memberNodeIds?.includes("B"));
      await delay(180);
      key("z", { ctrlKey: true });
      await delay(260);
      const requirementUndoState = state();
      const requirementUndoOk = !requirementUndoState.nodes.some((node) => node.type === "requirement") && requirementUndoState.layoutGroups?.some((group) => group.hostNodeId === "A" && group.memberNodeIds?.includes("B"));

      await api.seedSelectionCanvas();
      await api.selectNodes({ ids: ["A", "L1", "L2"], primaryId: "A" });
      const finalMenu = await openMenu("A");
      const checks = { selectAllOk, allMenuOk, mixedMenuOk, deleteOk, undoOk, groupOk, dissolveOk, nudgeOk, selectionRequirementOk, requirementUndoOk, finalMenuVisible: finalMenu.visible };
      resolve({ ok: Object.values(checks).every(Boolean), checks, allMenu, mixedMenu, requirementMenu, finalMenu, finalState: state() });
    })().catch((error) => resolve({ ok: false, error: error instanceof Error ? error.message : String(error), state: state() }));
  })`, 30000);
  const capture = await captureState(client, targetId, "selection-command-suite-1280", null, null, {
    settingsOpen: false,
    historyOpen: false,
    modalOpen: false,
    accountOpen: false,
    titlebarOverlay: true,
    imageNodeViewportOk: true,
    selectionSurfacesConsistentOk: true
  });
  capture.suite = suite;
  if (!suite?.ok) capture.stateIssues.push(`selection command suite failed: ${suite?.error || JSON.stringify(suite?.checks || {})}`);
  return [capture];
}
