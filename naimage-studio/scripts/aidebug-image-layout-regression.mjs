export async function runCanvasLayoutMutationRegression({ client, evaluate, fixturePath, fixturePaths = [] }) {
  return evaluate(
    client,
    `(async () => {
      const delay = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
      const externalFixturePaths = ${JSON.stringify(fixturePaths.length ? fixturePaths : [fixturePath])};
      const state = () => window.__naimageDebugAgentState?.();
      const assetKey = (node) => node?.assets?.[0]?.path || node?.assets?.[0]?.assetUrl || node?.assets?.[0]?.url || "";
      const position = (node) => ({ x: Number(node?.x || 0), y: Number(node?.y || 0) });
      const samePosition = (left, right) => Number(left?.x) === Number(right?.x) && Number(left?.y) === Number(right?.y);
      const causality = (nodes) => Object.fromEntries((nodes || []).map((node) => [node.id, [node.parentId || "", node.relationType || ""]]));
      const causalityPreserved = (before, nodes) => (nodes || []).every((node) => !before[node.id] || (
        before[node.id][0] === (node.parentId || "") && before[node.id][1] === (node.relationType || "")
      ));
      const uniqueZOrders = (nodes) => {
        const values = (nodes || []).map((node) => Number(node.zOrder));
        return values.length > 0 && values.every(Number.isFinite) && new Set(values).size === values.length;
      };
      const overlapPairs = (nodes) => {
        const list = nodes || [];
        const pairs = [];
        for (let leftIndex = 0; leftIndex < list.length; leftIndex += 1) {
          const left = list[leftIndex];
          const leftWidth = Math.max(1, Number(left?.width || 364));
          const leftHeight = Math.max(1, Number(left?.height || 520));
          for (let rightIndex = leftIndex + 1; rightIndex < list.length; rightIndex += 1) {
            const right = list[rightIndex];
            const rightWidth = Math.max(1, Number(right?.width || 364));
            const rightHeight = Math.max(1, Number(right?.height || 520));
            const width = Math.max(0, Math.min(Number(left.x) + leftWidth, Number(right.x) + rightWidth) - Math.max(Number(left.x), Number(right.x)));
            const height = Math.max(0, Math.min(Number(left.y) + leftHeight, Number(right.y) + rightHeight) - Math.max(Number(left.y), Number(right.y)));
            if (width * height > 0) pairs.push({ first: left.id, second: right.id, area: Math.round(width * height) });
          }
        }
        return pairs;
      };
      const clear = async () => {
        const result = await window.__naimageAIDebug.runTool({
          name: "workflow",
          input: { operation: "clear_canvas", brief: "清理图片布局边界回归画布。" }
        });
        await delay(320);
        return Boolean(result?.ok && Number(state()?.nodeCount || 0) === 0 && Number(state()?.layoutGroups?.length || 0) === 0);
      };
      const createSingle = async (label) => {
        const beforeIds = new Set((state()?.nodes || []).map((node) => node.id));
        const result = await window.__naimageAIDebug.runTool({
          name: "image_gen",
          selectedNodeId: "",
          input: {
            operation: "generate",
            prompt: "AIDebug 图片布局边界回归 " + label + "，干净商品缩略图，无文字。",
            ratio: "1:1",
            resolution: "720P",
            count: 1,
            quality: "auto",
            brief: "创建图片布局回归单图 " + label + "。"
          }
        });
        await delay(260);
        const node = [...(state()?.nodes || [])].reverse().find((item) => !beforeIds.has(item.id) && item.type === "image" && item.imageState === "done" && Number(item.assetCount || 0) === 1);
        if (!result?.ok || !node) throw new Error("cannot create single image fixture " + label);
        return node.id;
      };
      const createSingles = async (count, prefix) => {
        const ids = [];
        for (let index = 0; index < count; index += 1) ids.push(await createSingle(prefix + "-" + (index + 1)));
        return ids;
      };
      const createBatch = async (count, label) => {
        const beforeIds = new Set((state()?.nodes || []).map((node) => node.id));
        const result = await window.__naimageAIDebug.runTool({
          name: "image_gen",
          selectedNodeId: "",
          input: {
            operation: "generate",
            prompt: "AIDebug 外部导入图片组回归 " + label + "，干净商品缩略图，无文字。",
            ratio: "1:1",
            resolution: "720P",
            count,
            quality: "auto",
            brief: "创建外部导入回归批量图片组。"
          }
        });
        await delay(360);
        const node = [...(state()?.nodes || [])].reverse().find((item) => !beforeIds.has(item.id) && item.imageCollection?.kind === "batch" && Number(item.assetCount || 0) === count);
        if (!result?.ok || !node) throw new Error("cannot create batch fixture " + label);
        return node.id;
      };
      const groupInto = async (sourceNodeId, targetNodeId) => {
        const source = state()?.nodes?.find((node) => node.id === sourceNodeId);
        const viewportBefore = { ...(state()?.viewport || {}) };
        const fitAttempts = [];
        let fittedState = state();
        let sourceRendered = false;
        let targetRendered = false;
        let sourceWithinCanvas = false;
        let targetWithinCanvas = false;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          const fit = await window.__naimageAIDebug.fitCanvas();
          await delay(220);
          fittedState = state();
          const canvasRect = document.querySelector('.workflow-canvas')?.getBoundingClientRect();
          const sourceElement = document.querySelector('.flow-node.image[data-node-id="' + sourceNodeId + '"]');
          const targetElement = document.querySelector('.flow-node.image[data-node-id="' + targetNodeId + '"]');
          const sourceRect = sourceElement?.getBoundingClientRect();
          const targetRect = targetElement?.getBoundingClientRect();
          const centerWithinCanvas = (rect) => Boolean(
            rect && canvasRect &&
            rect.left + rect.width / 2 >= Math.max(0, canvasRect.left) + 2 &&
            rect.left + rect.width / 2 <= Math.min(window.innerWidth, canvasRect.right) - 2 &&
            rect.top + rect.height / 2 >= Math.max(0, canvasRect.top) + 2 &&
            rect.top + rect.height / 2 <= Math.min(window.innerHeight, canvasRect.bottom) - 2
          );
          sourceRendered = fittedState?.domNodeIds?.includes(sourceNodeId) === true && Boolean(sourceElement);
          targetRendered = fittedState?.domNodeIds?.includes(targetNodeId) === true && Boolean(targetElement);
          sourceWithinCanvas = centerWithinCanvas(sourceRect);
          targetWithinCanvas = centerWithinCanvas(targetRect);
          fitAttempts.push({
            attempt,
            apiOk: fit?.ok === true,
            viewport: { ...(fittedState?.viewport || {}) },
            sourceRendered,
            targetRendered,
            sourceWithinCanvas,
            targetWithinCanvas,
            sourceRect: sourceRect ? { left: sourceRect.left, top: sourceRect.top, right: sourceRect.right, bottom: sourceRect.bottom } : null,
            targetRect: targetRect ? { left: targetRect.left, top: targetRect.top, right: targetRect.right, bottom: targetRect.bottom } : null
          });
          if (fit?.ok && sourceRendered && targetRendered && sourceWithinCanvas && targetWithinCanvas) break;
          await delay(280);
        }
        const result = await window.__naimageAIDebug.nativeAssetDrop({ sourceNodeId, targetContainerId: targetNodeId, assetKey: assetKey(source) });
        await delay(300);
        const group = state()?.layoutGroups?.find((item) => item.hostNodeId === targetNodeId && item.memberNodeIds?.includes(sourceNodeId));
        return {
          ...result,
          layoutApplied: Boolean(group),
          group,
          viewportFit: {
            ok: Boolean(sourceRendered && targetRendered && sourceWithinCanvas && targetWithinCanvas),
            before: viewportBefore,
            after: { ...(fittedState?.viewport || {}) },
            sourceRendered,
            targetRendered,
            sourceWithinCanvas,
            targetWithinCanvas,
            attempts: fitAttempts,
            domNodeIds: [...(fittedState?.domNodeIds || [])],
            projectedCanvasNodeIds: [...(fittedState?.projectedCanvasNodeIds || [])]
          }
        };
      };
      const deleteNode = async (id) => {
        const applied = window.__naimageDebugApplyAgentActions?.([{ type: "workflow.node.delete", id, mode: "only" }]);
        await delay(520);
        return applied === true;
      };
      const dissolveGroup = async (hostNodeId) => {
        const node = document.querySelector('.flow-node[data-node-id="' + hostNodeId + '"]');
        const rect = node?.getBoundingClientRect();
        node?.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: (rect?.left || 0) + 40,
          clientY: (rect?.top || 0) + 30
        }));
        await delay(100);
        const button = Array.from(document.querySelectorAll(".canvas-context-menu button")).find((item) => String(item.textContent || "").includes("解散图片容器"));
        button?.click();
        await delay(320);
        return Boolean(button && !(state()?.layoutGroups || []).some((group) => group.hostNodeId === hostNodeId));
      };
      const measureGroup = async (hostNodeId, expectedCount) => {
        let host = null;
        let preview = null;
        let tiles = [];
        let images = [];
        for (let attempt = 0; attempt < 60; attempt += 1) {
          host = document.querySelector('.flow-node[data-node-id="' + hostNodeId + '"]');
          preview = host?.querySelector('.image-container-preview') || null;
          tiles = Array.from(preview?.querySelectorAll('.container-image-tile') || []);
          images = tiles.map((tile) => tile.querySelector('img')).filter(Boolean);
          if (images.length === expectedCount && images.every((image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0)) break;
          images.forEach((image) => { image.loading = "eager"; });
          if (images.length === expectedCount) {
            await Promise.race([
              Promise.allSettled(images.map((image) => image.decode?.())),
              delay(240)
            ]);
          }
          await delay(100);
        }
        const hostRect = host?.getBoundingClientRect();
        const previewRect = preview?.getBoundingClientRect();
        const tileRects = tiles.map((tile) => {
          const rect = tile.getBoundingClientRect();
          return { width: Math.round(rect.width), height: Math.round(rect.height), left: Math.round(rect.left), top: Math.round(rect.top) };
        });
        const style = preview ? getComputedStyle(preview) : null;
        const columnCount = String(style?.gridTemplateColumns || "").split(/\\s+/).filter(Boolean).length;
        const rowCount = String(style?.gridTemplateRows || "").split(/\\s+/).filter(Boolean).length;
        const expectedPlan = expectedCount === 2 ? [2, 1] : expectedCount === 3 ? [3, 1] : expectedCount === 4 ? [2, 2] : [3, 2];
        const thumbnailsComplete = images.length === expectedCount && images.every((image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0 && getComputedStyle(image).objectFit === "contain");
        const minimumTileWidth = expectedCount === 3 ? 44 : 58;
        const tilesSized = tileRects.length === expectedCount && tileRects.every((rect) => rect.width >= minimumTileWidth && rect.height >= 48);
        const threeTileRowBalanced = expectedCount !== 3 || Boolean(
          tileRects.length === 3 &&
          preview?.getAttribute("data-container-layout") === "triple-row" &&
          Math.abs(tileRects[0].width - tileRects[1].width) <= 2 &&
          Math.abs(tileRects[1].width - tileRects[2].width) <= 2 &&
          Math.abs(tileRects[0].height - tileRects[1].height) <= 2 &&
          Math.abs(tileRects[1].height - tileRects[2].height) <= 2
        );
        const previewInsideNode = Boolean(hostRect && previewRect && previewRect.left >= hostRect.left - 1 && previewRect.right <= hostRect.right + 1 && previewRect.top >= hostRect.top - 1 && previewRect.bottom <= hostRect.bottom + 1);
        return {
          ok: Boolean(host && preview && host.classList.contains("image-container") && preview.getAttribute("data-image-count") === String(expectedCount) && tiles.length === expectedCount && columnCount === expectedPlan[0] && rowCount === expectedPlan[1] && thumbnailsComplete && tilesSized && threeTileRowBalanced && previewInsideNode),
          expectedCount,
          expectedColumns: expectedPlan[0],
          expectedRows: expectedPlan[1],
          columnCount,
          rowCount,
          tileCount: tiles.length,
          thumbnailsComplete,
          tilesSized,
          threeTileRowBalanced,
          previewInsideNode,
          hostRect: hostRect ? { width: Math.round(hostRect.width), height: Math.round(hostRect.height) } : null,
          previewRect: previewRect ? { width: Math.round(previewRect.width), height: Math.round(previewRect.height) } : null,
          tileRects
        };
      };

      const results = {};

      await clear();
      {
        const [hostId, memberId] = await createSingles(2, "drag-host");
        const grouped = await groupInto(memberId, hostId);
        const before = state();
        const group = before?.layoutGroups?.find((item) => item.hostNodeId === hostId);
        const host = before?.nodes?.find((node) => node.id === hostId);
        const member = before?.nodes?.find((node) => node.id === memberId);
        const oldHostPosition = position(host);
        const memberPositionBefore = position(member);
        const beforeCausality = causality(before?.nodes);
        const canvasRect = document.querySelector('.workflow-canvas')?.getBoundingClientRect();
        const move = await window.__naimageDebugMoveContainerAsset({ sourceContainerId: hostId, assetKey: assetKey(host), clientX: (canvasRect?.left || 0) + 720, clientY: (canvasRect?.top || 0) + 480 });
        await delay(420);
        const after = state();
        const remaining = after?.nodes?.find((node) => node.id === memberId);
        const dragged = after?.nodes?.find((node) => node.id === hostId);
        results.dragHostOut = {
          ok: Boolean(grouped?.ok && grouped?.layoutApplied && group?.memberNodeIds?.length === 2 && move?.ok && !after?.layoutGroups?.some((item) => item.id === group.id) && remaining && dragged && samePosition(position(remaining), oldHostPosition) && !samePosition(position(dragged), oldHostPosition) && causalityPreserved(beforeCausality, after?.nodes)),
          grouped,
          move,
          group,
          oldHostPosition,
          memberPositionBefore,
          remainingPosition: position(remaining),
          draggedPosition: position(dragged),
          causalityPreserved: causalityPreserved(beforeCausality, after?.nodes)
        };
      }

      await clear();
      {
        const canvasRect = document.querySelector('.workflow-canvas')?.getBoundingClientRect();
        const imported = await window.__naimageDebugImportPathsToCanvas?.({ paths: [${JSON.stringify(fixturePath)}], clientX: (canvasRect?.left || 0) + 260, clientY: (canvasRect?.top || 0) + 220 });
        await delay(420);
        const before = state();
        const classic = before?.nodes?.find((node) => node.imageContainer === true && Number(node.assetCount || 0) === 1);
        const beforePosition = position(classic);
        const beforeCausality = causality(before?.nodes);
        const move = await window.__naimageDebugMoveContainerAsset?.({ sourceContainerId: classic?.id || "", assetKey: assetKey(classic), clientX: (canvasRect?.left || 0) + 690, clientY: (canvasRect?.top || 0) + 470 });
        await delay(420);
        const after = state();
        const normalized = after?.nodes?.find((node) => node.id === classic?.id);
        const layout = after?.nodeLayouts?.find((item) => item.id === classic?.id);
        const domNode = document.querySelector('.flow-node[data-node-id="' + (classic?.id || "") + '"]');
        results.classicSingleContainer = {
          ok: Boolean(imported?.ok && classic && move?.ok && normalized && normalized.imageContainer !== true && !normalized.imageCollection && Number(normalized.assetCount || 0) === 1 && !samePosition(position(normalized), beforePosition) && Number.isFinite(Number(normalized.x)) && Number.isFinite(Number(normalized.y)) && layout?.viewportOk && domNode && !domNode.classList.contains("image-container") && causalityPreserved(beforeCausality, after?.nodes)),
          imported,
          move,
          beforePosition,
          normalizedPosition: position(normalized),
          normalized: normalized ? { id: normalized.id, imageContainer: normalized.imageContainer === true, assetCount: normalized.assetCount, x: normalized.x, y: normalized.y } : null,
          viewportOk: Boolean(layout?.viewportOk),
          causalityPreserved: causalityPreserved(beforeCausality, after?.nodes)
        };
      }

      await clear();
      {
        const [hostId, memberId] = await createSingles(2, "delete-two-host");
        const grouped = await groupInto(memberId, hostId);
        const before = state();
        const group = before?.layoutGroups?.find((item) => item.hostNodeId === hostId);
        const oldHostPosition = position(before?.nodes?.find((node) => node.id === hostId));
        const beforeCausality = causality(before?.nodes?.filter((node) => node.id !== hostId));
        const deleted = await deleteNode(hostId);
        const after = state();
        const remaining = after?.nodes?.find((node) => node.id === memberId);
        results.deleteTwoGroupHost = {
          ok: Boolean(grouped?.ok && grouped?.layoutApplied && deleted && group?.memberNodeIds?.length === 2 && after?.nodes?.length === 1 && remaining && !after?.layoutGroups?.length && samePosition(position(remaining), oldHostPosition) && causalityPreserved(beforeCausality, after?.nodes)),
          grouped,
          deleted,
          group,
          oldHostPosition,
          remainingPosition: position(remaining),
          causalityPreserved: causalityPreserved(beforeCausality, after?.nodes)
        };
      }

      await clear();
      {
        const [hostId, memberOneId, memberTwoId] = await createSingles(3, "delete-three-host");
        const groupedOne = await groupInto(memberOneId, hostId);
        const groupedTwo = await groupInto(memberTwoId, hostId);
        const before = state();
        const group = before?.layoutGroups?.find((item) => item.hostNodeId === hostId);
        const expectedNewHostId = group?.memberNodeIds?.find((id) => id !== hostId) || "";
        const oldHostPosition = position(before?.nodes?.find((node) => node.id === hostId));
        const beforeCausality = causality(before?.nodes?.filter((node) => node.id !== hostId));
        const deleted = await deleteNode(hostId);
        const after = state();
        const nextGroup = after?.layoutGroups?.find((item) => item.id === group?.id);
        const nextHost = after?.nodes?.find((node) => node.id === nextGroup?.hostNodeId);
        results.deleteThreeGroupHost = {
          ok: Boolean(groupedOne?.ok && groupedOne?.layoutApplied && groupedTwo?.ok && groupedTwo?.layoutApplied && deleted && group?.memberNodeIds?.length === 3 && after?.nodes?.length === 2 && nextGroup && nextGroup.hostNodeId === expectedNewHostId && nextGroup.memberNodeIds?.length === 2 && nextHost && samePosition(position(nextHost), oldHostPosition) && causalityPreserved(beforeCausality, after?.nodes)),
          groupedOne,
          groupedTwo,
          deleted,
          group,
          nextGroup,
          expectedNewHostId,
          oldHostPosition,
          nextHostPosition: position(nextHost),
          causalityPreserved: causalityPreserved(beforeCausality, after?.nodes)
        };
      }

      await clear();
      {
        const ids = await createSingles(6, "adaptive-grid");
        const hostId = ids[0];
        const checks = [];
        for (let index = 1; index < ids.length; index += 1) {
          const grouped = await groupInto(ids[index], hostId);
          const count = index + 1;
          if ([2, 3, 4, 6].includes(count)) {
            const measurement = await measureGroup(hostId, count);
            checks.push({ ...measurement, groupedOk: Boolean(grouped?.ok && grouped?.layoutApplied), ok: Boolean(grouped?.ok && grouped?.layoutApplied && measurement.ok) });
          }
        }
        const finalState = state();
        const finalGroup = finalState?.layoutGroups?.find((item) => item.hostNodeId === hostId);
        const identityItems = ids.map((id) => {
          const node = finalState?.nodes?.find((item) => item.id === id);
          const asset = node?.assets?.[0];
          return { id, displayCode: node?.displayCode || "", assetId: asset?.assetId || "", assetCode: asset?.displayCode || "" };
        });
        const identityReady = identityItems.every((item) => item.displayCode && item.assetId && item.assetCode) &&
          new Set(identityItems.map((item) => item.displayCode)).size === identityItems.length &&
          new Set(identityItems.map((item) => item.assetId)).size === identityItems.length &&
          new Set(identityItems.map((item) => item.assetCode)).size === identityItems.length;
        results.adaptiveGrid = {
          ok: Boolean(checks.length === 4 && checks.every((item) => item.ok) && finalGroup?.memberNodeIds?.length === ids.length && ids.every((id) => finalGroup.memberNodeIds.includes(id)) && identityReady),
          ids,
          finalGroup,
          identityReady,
          identityItems,
          checks
        };
      }

      await clear();
      {
        const nodeId = "aspect-aware-wide-outlier";
        const fixtureDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGklEQVR4nGP8z8Dwn4GBgYGJAQkwMaACDAwAFwICBXS9U/8AAAAASUVORK5CYII=";
        const assets = [
          { index: 1, type: "url", url: fixtureDataUrl, width: 720, height: 1200, title: "竖版对照 A", prompt: "竖版对照 A", status: "done" },
          { index: 2, type: "url", url: fixtureDataUrl, width: 1600, height: 800, title: "横版主视觉", prompt: "横版主视觉", status: "done" },
          { index: 3, type: "url", url: fixtureDataUrl, width: 720, height: 1200, title: "竖版对照 B", prompt: "竖版对照 B", status: "done" }
        ];
        const applied = window.__naimageDebugApplyAgentActions?.([{
          type: "workflow.node.create",
          toolRunId: nodeId,
          node: {
            id: nodeId,
            title: "宽高比感知图片组",
            prompt: "AIDebug 宽高比感知图片组。",
            nodeType: "image",
            status: "done",
            imageState: "done",
            x: 240,
            y: 180,
            outputs: 3,
            assets,
            imageParams: { operation: "generate", prompt: "AIDebug 宽高比感知图片组。", ratio: "1:1", resolution: "720P", size: "1024x1024", count: 3, quality: "auto", background: "opaque" },
            imageProgress: { total: 3, completed: 3, failed: 0, message: "已完成 3/3 张" },
            imageCollection: {
              id: "aspect-aware-wide-outlier-collection",
              kind: "batch",
              generationMode: "parallel",
              createdAt: new Date().toISOString(),
              autoFit: true,
              items: assets.map((asset, index) => ({ id: "aspect-item-" + index, assetIndex: index + 1, title: asset.title, prompt: asset.prompt, status: "done" }))
            }
          }
        }]);
        await delay(520);
        await window.__naimageAIDebug.fitCanvas();
        await delay(320);
        const host = document.querySelector('.flow-node[data-node-id="' + nodeId + '"]');
        const preview = host?.querySelector('.node-image-preview');
        const tiles = Array.from(preview?.querySelectorAll('.node-image-tile') || []);
        const images = tiles.map((tile) => tile.querySelector('img')).filter(Boolean);
        images.forEach((image) => { image.loading = "eager"; });
        await Promise.race([Promise.allSettled(images.map((image) => image.decode?.())), delay(1800)]);
        const style = preview ? getComputedStyle(preview) : null;
        const columnCount = String(style?.gridTemplateColumns || "").split(/\\s+/).filter(Boolean).length;
        const rowCount = String(style?.gridTemplateRows || "").split(/\\s+/).filter(Boolean).length;
        const tileOrder = tiles.map((tile) => Number(tile.getAttribute("data-asset-index")));
        const tileRects = tiles.map((tile) => {
          const rect = tile.getBoundingClientRect();
          return { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) };
        });
        const imageBackgrounds = images.map((image) => getComputedStyle(image).backgroundImage);
        const imagesReady = images.length === 3 && images.every((image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
        const rawNode = state()?.nodes?.find((node) => node.id === nodeId);
        const visualIdentitySeparated = Boolean(
          rawNode?.assets?.[0]?.title === "竖版对照 A" &&
          rawNode?.assets?.[1]?.title === "横版主视觉" &&
          rawNode?.assets?.[2]?.title === "竖版对照 B" &&
          tileOrder.join(",") === "1,0,2"
        );
        const mosaicGeometry = Boolean(
          tileRects.length === 3 &&
          tileRects[0].top < tileRects[1].top &&
          Math.abs(tileRects[1].top - tileRects[2].top) <= 2 &&
          tileRects[0].width >= tileRects[1].width * 1.7 &&
          Math.abs(tileRects[1].width - tileRects[2].width) <= 2
        );
        results.aspectAwareWideOutlier = {
          ok: Boolean(
            applied && host && preview && host.classList.contains("image-collection") &&
            preview.getAttribute("data-container-layout") === "triple-mosaic-top" &&
            preview.classList.contains("opaque-assets") && columnCount === 2 && rowCount === 2 &&
            imagesReady &&
            imageBackgrounds.every((background) => background === "none") && visualIdentitySeparated && mosaicGeometry
          ),
          applied: Boolean(applied),
          layout: preview?.getAttribute("data-container-layout") || "",
          opaqueAssets: Boolean(preview?.classList.contains("opaque-assets")),
          columnCount,
          rowCount,
          tileOrder,
          tileRects,
          imageBackgrounds,
          imagesReady,
          visualIdentitySeparated,
          mosaicGeometry
        };
      }

      await clear();
      {
        const nodeId = "aspect-aware-mixed-six";
        const fixtureDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGklEQVR4nGP8z8Dwn4GBgYGJAQkwMaACDAwAFwICBXS9U/8AAAAASUVORK5CYII=";
        const dimensions = [
          [600, 1200],
          [744, 1200],
          [960, 1200],
          [1440, 1200],
          [1700, 1000],
          [2100, 1000]
        ];
        const assets = dimensions.map(([width, height], index) => ({
          index: index + 1,
          type: "url",
          url: fixtureDataUrl,
          width,
          height,
          title: "比例素材 " + (index + 1),
          prompt: "比例素材 " + (index + 1),
          status: "done"
        }));
        const applied = window.__naimageDebugApplyAgentActions?.([{
          type: "workflow.node.create",
          toolRunId: nodeId,
          node: {
            id: nodeId,
            title: "混合比例六图容器",
            prompt: "AIDebug 混合比例六图容器。",
            nodeType: "image",
            status: "done",
            imageState: "done",
            x: 240,
            y: 180,
            outputs: 6,
            assets,
            imageParams: { operation: "generate", prompt: "AIDebug 混合比例六图容器。", ratio: "1:1", resolution: "720P", size: "1024x1024", count: 6, quality: "auto", background: "opaque" },
            imageProgress: { total: 6, completed: 6, failed: 0, message: "已完成 6/6 张" },
            imageCollection: {
              id: "aspect-aware-mixed-six-collection",
              kind: "batch",
              generationMode: "parallel",
              createdAt: new Date().toISOString(),
              autoFit: true,
              items: assets.map((asset, index) => ({ id: "mixed-six-item-" + index, assetIndex: index + 1, title: asset.title, prompt: asset.prompt, status: "done" }))
            }
          }
        }]);
        await delay(520);
        await window.__naimageAIDebug.fitCanvas();
        await delay(320);
        const host = document.querySelector('.flow-node[data-node-id="' + nodeId + '"]');
        const preview = host?.querySelector('.node-image-preview');
        const tiles = Array.from(preview?.querySelectorAll('.node-image-tile') || []);
        const tileOrder = tiles.map((tile) => Number(tile.getAttribute("data-asset-index")));
        const tileRects = tiles.map((tile) => {
          const rect = tile.getBoundingClientRect();
          return { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) };
        });
        const firstRow = tileRects.slice(0, 3);
        const secondRow = tileRects.slice(3, 6);
        const firstRowHeight = firstRow.length ? Math.round(firstRow.reduce((sum, rect) => sum + rect.height, 0) / firstRow.length) : 0;
        const secondRowHeight = secondRow.length ? Math.round(secondRow.reduce((sum, rect) => sum + rect.height, 0) / secondRow.length) : 0;
        const rowsSeparated = Boolean(
          firstRow.length === 3 && secondRow.length === 3 &&
          Math.max(...firstRow.map((rect) => rect.top)) - Math.min(...firstRow.map((rect) => rect.top)) <= 2 &&
          Math.max(...secondRow.map((rect) => rect.top)) - Math.min(...secondRow.map((rect) => rect.top)) <= 2 &&
          Math.min(...secondRow.map((rect) => rect.top)) > Math.max(...firstRow.map((rect) => rect.top))
        );
        const ratioWeightedRows = firstRowHeight >= secondRowHeight * 1.55;
        results.aspectAwareMixedSix = {
          ok: Boolean(
            applied && host && preview && host.classList.contains("image-collection") &&
            preview.getAttribute("data-container-layout") === "grid" &&
            tileOrder.join(",") === "0,1,2,5,4,3" && rowsSeparated && ratioWeightedRows
          ),
          applied: Boolean(applied),
          layout: preview?.getAttribute("data-container-layout") || "",
          tileOrder,
          tileRects,
          firstRowHeight,
          secondRowHeight,
          rowsSeparated,
          ratioWeightedRows
        };
      }

      await clear();
      {
        const batchId = await createBatch(3, "batch-three");
        const before = state();
        const batchBefore = before?.nodes?.find((node) => node.id === batchId);
        const collectionBefore = JSON.stringify(batchBefore?.imageCollection || null);
        const assetsBefore = JSON.stringify(batchBefore?.assets || []);
        const causalityBefore = causality(before?.nodes);
        const canvasRect = document.querySelector('.workflow-canvas')?.getBoundingClientRect();
        const imported = await window.__naimageDebugImportPathsToCanvas?.({
          paths: externalFixturePaths.slice(0, 2),
          clientX: (canvasRect?.left || 0) + 480,
          clientY: (canvasRect?.top || 0) + 280,
          targetContainerId: batchId
        });
        await delay(520);
        const after = state();
        const batchAfter = after?.nodes?.find((node) => node.id === batchId);
        const group = after?.layoutGroups?.find((item) => item.hostNodeId === batchId);
        const importedIds = (group?.memberNodeIds || []).filter((id) => id !== batchId);
        const importedNodes = importedIds.map((id) => after?.nodes?.find((node) => node.id === id)).filter(Boolean);
        const hostElement = document.querySelector('.flow-node[data-node-id="' + batchId + '"]');
        const tiles = Array.from(hostElement?.querySelectorAll('.node-image-tile') || []);
        const memberTile = tiles[3];
        memberTile?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, button: 0 }));
        await delay(180);
        const editorNodeId = state()?.nodeEditorNodeId || "";
        document.querySelector('.node-editor-dialog .ui-surface-close')?.click();
        await delay(100);
        results.externalIntoGeneratedCollection = {
          ok: Boolean(
            imported?.ok && imported?.added === 2 && group?.memberNodeIds?.length === 3 &&
            importedNodes.length === 2 && importedNodes.every((node) => !node.imageContainer && !node.imageCollection && Number(node.assetCount || 0) === 1) &&
            JSON.stringify(batchAfter?.imageCollection || null) === collectionBefore && JSON.stringify(batchAfter?.assets || []) === assetsBefore &&
            tiles.length === 5 && editorNodeId === importedIds[0] && causalityPreserved(causalityBefore, after?.nodes) &&
            uniqueZOrders(after?.nodes) && !(after?.nodes || []).some((node) => node.imageContainer === true)
          ),
          imported,
          batchId,
          group,
          importedIds,
          tileCount: tiles.length,
          editorNodeId,
          expectedEditorNodeId: importedIds[0] || "",
          collectionUnchanged: JSON.stringify(batchAfter?.imageCollection || null) === collectionBefore,
          assetsUnchanged: JSON.stringify(batchAfter?.assets || []) === assetsBefore,
          causalityPreserved: causalityPreserved(causalityBefore, after?.nodes),
          zOrdersUnique: uniqueZOrders(after?.nodes)
        };
      }

      await clear();
      {
        const [a, b, c, d] = await createSingles(4, "z-order-host-transfer");
        const createdState = state();
        const originalHost = createdState?.nodes?.find((node) => node.id === c);
        const originalHostSize = { width: Number(originalHost?.width || 0), height: Number(originalHost?.height || 0) };
        const groupedAB = await groupInto(b, a);
        const groupedCD = await groupInto(d, c);
        const before = state();
        const beforeCausality = causality(before?.nodes);
        const source = before?.nodes?.find((node) => node.id === a);
        const sourceGroupBefore = before?.layoutGroups?.find((item) => item.hostNodeId === a);
        const targetGroupBefore = before?.layoutGroups?.find((item) => item.hostNodeId === c);
        await window.__naimageAIDebug.fitCanvas();
        await delay(260);
        const moved = await window.__naimageAIDebug.nativeAssetDrop({
          sourceNodeId: a,
          targetContainerId: c,
          assetKey: assetKey(source)
        });
        await delay(420);
        const afterMove = state();
        const sourceGroupRemoved = Boolean(sourceGroupBefore && !afterMove?.layoutGroups?.some((item) => item.id === sourceGroupBefore.id));
        const targetGroupAfter = afterMove?.layoutGroups?.find((item) => item.id === targetGroupBefore?.id && item.hostNodeId === c);
        const expectedTargetMemberIds = [c, a, d];
        const targetMemberOrderExact = Boolean(
          targetGroupAfter && JSON.stringify(targetGroupAfter.memberNodeIds || []) === JSON.stringify(expectedTargetMemberIds)
        );
        const formerSourceMemberExposed = Boolean(
          afterMove?.nodes?.some((node) => node.id === b) &&
          !afterMove?.layoutGroups?.some((item) => item.memberNodeIds?.includes(b))
        );
        const pointerGestureProven = Boolean(
          ["pointer-node-drag", "html-drag-drop"].includes(String(moved?.gesture?.kind || "")) &&
          moved?.checks?.dragStartRouted &&
          moved?.checks?.distanceThresholdCrossed &&
          moved?.checks?.expectedTargetInHitStack &&
          (moved?.gesture?.kind === "html-drag-drop" || moved?.checks?.expectedGroupingCandidate) &&
          (moved?.gesture?.kind === "html-drag-drop" ? moved?.checks?.dragOverAccepted && moved?.checks?.dropAccepted : moved?.checks?.absorbArmed) &&
          moved?.checks?.targetHighlighted &&
          moved?.checks?.dropHighlightCleared
        );
        const moveUnique = uniqueZOrders(afterMove?.nodes);
        const beforeDissolveZOrders = Object.fromEntries((afterMove?.nodes || []).map((node) => [node.id, Number(node.zOrder)]));
        const beforeDissolveAssets = Object.fromEntries((afterMove?.nodes || []).map((node) => [node.id, JSON.stringify(node.assets || [])]));
        const dissolveHostPosition = position(afterMove?.nodes?.find((node) => node.id === c));
        const dissolved = await dissolveGroup(c);
        const afterDissolve = state();
        const dissolveOverlapPairs = overlapPairs(afterDissolve?.nodes || []);
        const dissolveZOrderPreserved = (afterDissolve?.nodes || []).every((node) => beforeDissolveZOrders[node.id] === Number(node.zOrder));
        const dissolveAssetsPreserved = (afterDissolve?.nodes || []).every((node) => beforeDissolveAssets[node.id] === JSON.stringify(node.assets || []));
        const dissolveHostPositionPreserved = samePosition(position(afterDissolve?.nodes?.find((node) => node.id === c)), dissolveHostPosition);
        const dissolvedHost = afterDissolve?.nodes?.find((node) => node.id === c);
        const dissolveHostSizeRestored = Boolean(
          dissolvedHost && Number(dissolvedHost.width) === originalHostSize.width && Number(dissolvedHost.height) === originalHostSize.height
        );
        results.zOrderHostTransfer = {
          ok: Boolean(
            groupedAB?.ok && groupedAB?.layoutApplied && groupedCD?.ok && groupedCD?.layoutApplied &&
            moved?.ok && pointerGestureProven && sourceGroupRemoved && targetMemberOrderExact && formerSourceMemberExposed &&
            moveUnique && dissolved && uniqueZOrders(afterDissolve?.nodes) && dissolveZOrderPreserved &&
            dissolveAssetsPreserved && dissolveHostPositionPreserved && dissolveHostSizeRestored && dissolveOverlapPairs.length === 0 &&
            Number(afterDissolve?.nodes?.length || 0) === 4 && causalityPreserved(beforeCausality, afterDissolve?.nodes)
          ),
          ids: { a, b, c, d },
          groupedAB,
          groupedCD,
          moved,
          pointerGestureProven,
          sourceGroupBefore,
          targetGroupBefore,
          sourceGroupRemoved,
          targetGroupAfter,
          expectedTargetMemberIds,
          targetMemberOrderExact,
          formerSourceMemberExposed,
          moveUnique,
          dissolved,
          dissolveUnique: uniqueZOrders(afterDissolve?.nodes),
          dissolveZOrderPreserved,
          dissolveAssetsPreserved,
          dissolveHostPositionPreserved,
          dissolveHostSizeRestored,
          dissolveHostPosition,
          originalHostSize,
          dissolvedHostSize: dissolvedHost ? { width: Number(dissolvedHost.width), height: Number(dissolvedHost.height) } : null,
          dissolveOverlapPairs,
          zAfterMove: (afterMove?.nodes || []).map((node) => ({ id: node.id, zOrder: node.zOrder })),
          zAfterDissolve: (afterDissolve?.nodes || []).map((node) => ({ id: node.id, zOrder: node.zOrder })),
          causalityPreserved: causalityPreserved(beforeCausality, afterDissolve?.nodes)
        };
      }

      return { ok: Object.values(results).every((item) => item?.ok === true), results, state: state() };
    })()`,
    180000
  );
}
