import { Maximize2, Minus, X } from "lucide-react";

import { ButtonBase } from "./ui";

export function WindowControls() {
  if (!window.iiimageConfig?.windowControl) return null;

  const invoke = (action: "minimize" | "toggle-maximize" | "close") => {
    void window.iiimageConfig?.windowControl?.({ action });
  };

  return (
    <div className="window-controls" aria-label="窗口控制">
      <ButtonBase
        className="window-control-button"
        type="button"
        onClick={() => invoke("minimize")}
        aria-label="最小化"
        title="最小化"
        data-window-control="minimize"
      >
        <Minus size={14} />
      </ButtonBase>
      <ButtonBase
        className="window-control-button"
        type="button"
        onClick={() => invoke("toggle-maximize")}
        aria-label="最大化或还原"
        title="最大化或还原"
        data-window-control="maximize"
      >
        <Maximize2 size={13} />
      </ButtonBase>
      <ButtonBase
        className="window-control-button close"
        type="button"
        onClick={() => invoke("close")}
        aria-label="关闭"
        title="关闭"
        data-window-control="close"
      >
        <X size={14} />
      </ButtonBase>
    </div>
  );
}
