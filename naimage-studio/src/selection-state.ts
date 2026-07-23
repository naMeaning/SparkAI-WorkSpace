export type NodeSelectionMode = "none" | "single" | "multiple";

export type NodeSelectionState = {
  primaryId: string;
  ids: string[];
};

export type NodeSelectionAction =
  | { type: "clear" }
  | { type: "replace"; id: string }
  | { type: "focus"; id: string }
  | { type: "plain-click"; id: string }
  | { type: "toggle"; id: string }
  | { type: "replace-group"; ids: string[]; primaryId?: string; preserveOnEmpty?: boolean }
  | { type: "remove"; ids: string[] };

const cleanId = (value: unknown): string => String(value ?? "").trim();

const uniqueIds = (values: readonly string[], availableIds?: ReadonlySet<string>): string[] => {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const value of values) {
    const id = cleanId(value);
    if (!id || seen.has(id) || (availableIds && !availableIds.has(id))) continue;
    seen.add(id);
    next.push(id);
  }
  return next;
};

export const emptyNodeSelection = (): NodeSelectionState => ({ primaryId: "", ids: [] });

export const nodeSelectionMode = (selection: NodeSelectionState): NodeSelectionMode => {
  if (selection.ids.length === 0) return "none";
  if (selection.ids.length === 1) return "single";
  return "multiple";
};

export const normalizeNodeSelection = (
  selection: NodeSelectionState,
  availableIds?: ReadonlySet<string>,
): NodeSelectionState => {
  const ids = uniqueIds(selection.ids, availableIds);
  if (!ids.length) return emptyNodeSelection();
  const requestedPrimaryId = cleanId(selection.primaryId);
  return {
    primaryId: ids.includes(requestedPrimaryId) ? requestedPrimaryId : ids[0],
    ids,
  };
};

export const reduceNodeSelection = (
  currentValue: NodeSelectionState,
  action: NodeSelectionAction,
  availableIds?: ReadonlySet<string>,
): NodeSelectionState => {
  const current = normalizeNodeSelection(currentValue, availableIds);

  if (action.type === "clear") return emptyNodeSelection();

  if (action.type === "replace") {
    const id = cleanId(action.id);
    if (!id || (availableIds && !availableIds.has(id))) return emptyNodeSelection();
    return { primaryId: id, ids: [id] };
  }

  if (action.type === "focus") {
    const id = cleanId(action.id);
    if (!id) return emptyNodeSelection();
    if (availableIds && !availableIds.has(id)) return current;
    if (!current.ids.length) return { primaryId: id, ids: [id] };
    if (!current.ids.includes(id)) return current;
    return current.primaryId === id ? current : { primaryId: id, ids: [...current.ids] };
  }

  if (action.type === "plain-click") {
    const id = cleanId(action.id);
    if (!id || (availableIds && !availableIds.has(id))) return current;
    if (nodeSelectionMode(current) === "multiple") return current;
    return current.primaryId === id && current.ids.length === 1
      ? current
      : { primaryId: id, ids: [id] };
  }

  if (action.type === "toggle") {
    const id = cleanId(action.id);
    if (!id || (availableIds && !availableIds.has(id))) return current;
    if (current.ids.includes(id)) {
      const ids = current.ids.filter((candidate) => candidate !== id);
      if (!ids.length) return emptyNodeSelection();
      return {
        primaryId: current.primaryId === id ? ids[0] : current.primaryId,
        ids,
      };
    }
    return { primaryId: id, ids: [...current.ids, id] };
  }

  if (action.type === "replace-group") {
    const ids = uniqueIds(action.ids, availableIds);
    if (!ids.length) return action.preserveOnEmpty ? current : emptyNodeSelection();
    const requestedPrimaryId = cleanId(action.primaryId);
    return {
      primaryId: ids.includes(requestedPrimaryId) ? requestedPrimaryId : ids[0],
      ids,
    };
  }

  const removeIds = new Set(uniqueIds(action.ids));
  const ids = current.ids.filter((id) => !removeIds.has(id));
  if (!ids.length) return emptyNodeSelection();
  return {
    primaryId: ids.includes(current.primaryId) ? current.primaryId : ids[0],
    ids,
  };
};
