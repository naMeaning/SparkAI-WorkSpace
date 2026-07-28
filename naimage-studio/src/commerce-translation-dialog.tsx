import { useState } from "react";
import { Languages, Send } from "lucide-react";
import {
  COMMERCE_LANGUAGES,
  DEFAULT_COMMERCE_LANGUAGE_CODES,
  MAX_COMMERCE_TARGET_LANGUAGES,
  normalizeCommerceLanguageCodes
} from "./plugins/commerce-translation";
import { ActionButton, DialogShell, InlineNotice, SurfaceBody, SurfaceFooter, SurfaceHeader } from "./ui";

export default function CommerceTranslationDialog({ sourceCount, sourceLabel, executionBusy, close, submit }: {
  sourceCount: number;
  sourceLabel: string;
  executionBusy?: boolean;
  close: () => void;
  submit: (payload: { languageCodes: string[] }) => void;
}) {
  const [languageCodes, setLanguageCodes] = useState(() => normalizeCommerceLanguageCodes(DEFAULT_COMMERCE_LANGUAGE_CODES));

  function toggleLanguage(code: string, checked: boolean) {
    setLanguageCodes((current) => normalizeCommerceLanguageCodes(checked ? [...current, code] : current.filter((item) => item !== code)));
  }

  return (
    <DialogShell surface="commerce-translation" ariaLabel="多国语言套图" className="commerce-translation-dialog" onRequestClose={close}>
      {({ requestClose }) => (
        <>
          <SurfaceHeader
            title="一键翻译多国语言套图"
            description="按语言分别生成商品图成果，保留商品、品牌和整体版式。"
            onClose={() => requestClose("close-button")}
          />
          <SurfaceBody className="commerce-translation-body">
            <InlineNotice tone="info" icon={<Languages size={15} />}>当前来源：{sourceLabel}，共 {sourceCount} 个图片成果或容器。</InlineNotice>
            <div className="commerce-language-header">
              <strong>目标语言</strong>
              <span>{languageCodes.length}/{MAX_COMMERCE_TARGET_LANGUAGES}</span>
            </div>
            <div className="commerce-language-grid" role="group" aria-label="目标语言多选">
              {COMMERCE_LANGUAGES.map((language) => {
                const checked = languageCodes.includes(language.code);
                const limitReached = !checked && languageCodes.length >= MAX_COMMERCE_TARGET_LANGUAGES;
                return (
                  <label key={language.code} className={`commerce-language-option ${checked ? "selected" : ""}`}>
                    <input type="checkbox" checked={checked} disabled={limitReached} onChange={(event) => toggleLanguage(language.code, event.target.checked)} />
                    <span>
                      <strong>{language.label}</strong>
                      <small>{language.nativeLabel}</small>
                    </span>
                  </label>
                );
              })}
            </div>
            <InlineNotice tone="neutral">每种语言建立独立结果组；只修改文字与必要排版，不新增商品卖点。阿拉伯语会使用从右到左布局。</InlineNotice>
          </SurfaceBody>
          <SurfaceFooter>
            <ActionButton onClick={() => requestClose("action")}>取消</ActionButton>
            <ActionButton
              variant="primary"
              disabled={executionBusy || languageCodes.length === 0}
              icon={<Send size={16} />}
              onClick={() => submit({ languageCodes })}
            >
              {executionBusy ? "Agent 正在工作" : `生成 ${languageCodes.length} 种语言`}
            </ActionButton>
          </SurfaceFooter>
        </>
      )}
    </DialogShell>
  );
}
