const rootElement = document.getElementById("root");

void import("./main").catch((error: unknown) => {
  if (!rootElement) return;
  rootElement.dataset.bootState = "failed";
  const status = rootElement.querySelector<HTMLElement>(".boot-shell-line");
  const detail = rootElement.querySelector<HTMLElement>(".boot-shell p");
  if (status) status.textContent = "工作台加载失败";
  if (detail) {
    detail.textContent = error instanceof Error && error.message
      ? `请重新启动软件。错误：${error.message}`
      : "请重新启动软件；如果问题持续，请查看本地诊断记录。";
  }
});
