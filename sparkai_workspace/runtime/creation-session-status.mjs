/** Both windows describe the same owner evidence, including its invalidation. */
export function creationResultStatus(result) {
  const localExpired = result.fileCheck && result.invalidReasons.some(reason =>
    reason === "requirements-changed" || reason === "asset-changed-or-unavailable");
  return {
    generated: result.generated ? "已生成" : "尚未生成",
    saved: result.saved ? "已保存" : "未保存",
    local: !result.fileCheck ? "本地未检查" : localExpired ? "本地检查已过期"
      : result.fileCheck.status === "passed" ? "本地检查通过" : "本地检查失败",
    localStatus: localExpired ? "stale" : result.fileCheck?.status,
    ai: !result.visualReview ? "AI 未检查" : !result.current ? "AI 检查已过期"
      : result.visualReview.verdict === "pass" ? "AI 检查通过" : result.visualReview.verdict === "revise" ? "AI 建议修改" : "AI 无法确定",
    aiStatus: result.visualReview ? result.current ? result.visualReview.verdict : "stale" : undefined,
    decision: result.decision.state === "approved" ? "用户已采用" : result.decision.state === "rejected" ? "用户已拒绝" : "待用户决定"
  };
}

export function creationSessionSummary(session) {
  const results = session.results || [];
  const targetCount = session.requirements?.slots.length || 0;
  const savedCount = results.filter(result => result.saved).length;
  const pendingCheckCount = results.filter(result => {
    const status = creationResultStatus(result);
    return !result.fileCheck || status.localStatus === "stale" || !result.visualReview || !result.current;
  }).length;
  const doubtCount = results.filter(result => {
    const status = creationResultStatus(result);
    return status.localStatus === "failed" || result.current && result.visualReview && result.visualReview.verdict !== "pass";
  }).length;
  const adoptedCount = results.filter(result => result.decision.state === "approved").length;
  return { targetCount, savedCount, pendingCheckCount, doubtCount, adoptedCount,
    text: `${targetCount ? `目标 ${targetCount} 项` : "目标待确认"} · 已保存 ${savedCount} 项 · 待检查 ${pendingCheckCount} 项 · 有疑问 ${doubtCount} 项 · 已采用 ${adoptedCount} 项` };
}
