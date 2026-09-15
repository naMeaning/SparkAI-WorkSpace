import React, { useEffect, useState } from "react";
import {
  CircleHelp,
  FileText,
  GraduationCap,
  Images,
  Languages,
  PackageCheck,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";

import {
  ActionButton,
  ButtonBase,
  DialogShell,
  SurfaceBody,
  SurfaceFooter,
  SurfaceHeader,
} from "./ui";

export type HelpCenterSection = "start" | "tutorial" | "workflow" | "privacy" | "terms" | "fees" | "about";

const CLOSE_BUTTON_REASON = "close-button" as const;

const sections: Array<{
  id: HelpCenterSection;
  label: string;
  icon: React.ReactNode;
}> = [
  { id: "start", label: "快速开始", icon: <Sparkles size={14} /> },
  { id: "tutorial", label: "AI 示例教学", icon: <GraduationCap size={14} /> },
  { id: "workflow", label: "使用帮助", icon: <Images size={14} /> },
  { id: "privacy", label: "隐私政策", icon: <ShieldCheck size={14} /> },
  { id: "terms", label: "用户协议", icon: <FileText size={14} /> },
  { id: "fees", label: "费用与退款", icon: <PackageCheck size={14} /> },
  { id: "about", label: "关于", icon: <UserRound size={14} /> },
];

function GuideStep({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return (
    <article className="help-guide-step">
      <span>{number}</span>
      <div><strong>{title}</strong><p>{children}</p></div>
    </article>
  );
}

function PolicySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="help-policy-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export default function HelpCenter({
  initialSection = "start",
  nested = false,
  startCommerceTutorial,
  close,
}: {
  initialSection?: HelpCenterSection;
  nested?: boolean;
  startCommerceTutorial?: () => void;
  close: () => void;
}) {
  const [activeSection, setActiveSection] = useState<HelpCenterSection>(initialSection);

  useEffect(() => setActiveSection(initialSection), [initialSection]);

  return (
    <DialogShell
      surface="help-center"
      ariaLabel="SparkAI WorkSpace 帮助与政策"
      layerLevel={nested ? "nested" : "dialog"}
      className="help-center-dialog"
      onRequestClose={close}
    >
      {({ requestClose }) => (
        <>
          <SurfaceHeader
            eyebrow="SPARKAI WORKSPACE GUIDE"
            title="帮助与政策"
            description="从导入原图到套图导出，并集中查看隐私、用户与费用规则。"
            onClose={() => requestClose(CLOSE_BUTTON_REASON)}
            closeLabel="关闭帮助中心"
          />
          <div className="help-center-layout">
            <nav className="help-center-nav" aria-label="帮助分类">
              {sections.map((section) => (
                <ButtonBase
                  key={section.id}
                  type="button"
                  className={activeSection === section.id ? "active" : ""}
                  aria-pressed={activeSection === section.id}
                  onClick={() => setActiveSection(section.id)}
                >
                  {section.icon}
                  <span>{section.label}</span>
                </ButtonBase>
              ))}
            </nav>
            <SurfaceBody className="help-center-body">
              {activeSection === "start" ? (
                <div className="help-guide-list">
                  <div className="help-center-callout">
                    <CircleHelp size={18} />
                    <div><strong>最短使用路径</strong><span>导入原图 → 选择图片 → 写要求 → 生成 → 在“专注”中切换结果 → 导出。</span></div>
                  </div>
                  <div className="help-center-callout is-agent-guide">
                    <Sparkles size={18} />
                    <div>
                      <strong>可以直接让 SparkAI WorkSpace Agent 操作软件</strong>
                      <span>例如：“把当前选中的母图生成 5 张 Amazon 套图”“把选中图片翻译成英语、日语和西班牙语”“将画布全部图片容器生成白底主图”。Agent 会读取当前选择并把结果放回画布。</span>
                    </div>
                  </div>
                  <div className="help-center-callout is-tutorial-guide">
                    <GraduationCap size={18} />
                    <div>
                      <strong>第一次做跨境套图？让 AI 陪你实操</strong>
                      <span>AI 陪练会根据画布真实状态，引导你粘贴或导入母图、找到套图工具、学会向 Agent 表达，并在你明确授权后等待真实成果。</span>
                    </div>
                    <ActionButton variant="primary" onClick={() => { close(); startCommerceTutorial?.(); }}>开始教学</ActionButton>
                  </div>
                  <GuideStep number="01" title="导入原图">拖入图片或使用左侧素材栏顶部的“+”。SparkAI WorkSpace 会复制到当前项目，不修改你的原文件。</GuideStep>
                  <GuideStep number="02" title="选中处理对象">单击画布图片。顶部上下文栏会显示当前选中内容，右侧 Agent 会同步使用这张图片。</GuideStep>
                  <GuideStep number="03" title="描述结果">在 Agent 输入自然语言要求；需要参考风格时再添加参考图。生图模型栏显示当前默认模型。</GuideStep>
                  <GuideStep number="04" title="查看整组结果">切到“专注”，下方会明确分成“原图”和“生成图片组”；单击缩略图切换，单击大图查看。</GuideStep>
                  <GuideStep number="05" title="完成跨境交付">使用底部跨境工具生成套图、翻译，再到平台导出中心检查 Amazon 或速卖通规格并按 SKU 打包。</GuideStep>
                </div>
              ) : null}

              {activeSection === "tutorial" ? (
                <div className="help-policy-copy help-tutorial-intro">
                  <div className="help-center-callout is-tutorial-guide">
                    <GraduationCap size={20} />
                    <div><strong>跨境电商套图 AI 陪练</strong><span>不是视频或死步骤：它会识别当前有没有图片、有没有选中商品、处于哪个工作台、工具是否启用，以及生成是否真的产出成果。</span></div>
                  </div>
                  <PolicySection title="你会完成什么">
                    <p>复制粘贴或导入一张商品母图，切换到电商创作，找到一键套图，并在“逐图配置”与“自然语言交给 Agent”之间自由选择。</p>
                  </PolicySection>
                  <PolicySection title="费用边界">
                    <p>浏览教学、导入、切换模式、填入 Agent 示例均不会调用模型。只有你亲自点击套图窗口中的生成按钮，或亲自发送 Agent 请求后，才可能由 Base URL / 中转站上游扣费。</p>
                  </PolicySection>
                  <PolicySection title="成功反馈">
                    <p>陪练只在检测到新的受管套图成果进入当前画布后判定完成，并提供成功动画、套图创作者徽章、专注查看和平台导出入口。</p>
                  </PolicySection>
                  <ActionButton variant="primary" onClick={() => { close(); startCommerceTutorial?.(); }}>开始 AI 陪练</ActionButton>
                </div>
              ) : null}

              {activeSection === "workflow" ? (
                <div className="help-workflow-grid">
                  <PolicySection title="三种画布视图">
                    <p><strong>工作台</strong>查看完整关系；<strong>专注</strong>切换原图与生成组；<strong>评审</strong>并排比较最近方案。</p>
                  </PolicySection>
                  <PolicySection title="套图与多语言">
                    <p>先选母图，再从底部工具栏打开“一键生成套图”或“多语言翻译”。逐张填写要求后一次执行。</p>
                    <p className="help-inline-icon"><Languages size={14} />翻译矩阵会保留每张图片、每种语言的复核状态。</p>
                  </PolicySection>
                  <PolicySection title="运行中修改">
                    <p>任务运行时只需选择“自动处理”“只修改要求”或“更换处理图片”。暂停会保留现场，结束会取消尚未开始的请求。</p>
                  </PolicySection>
                  <PolicySection title="需求与 Skill 模板">
                    <p>先在画布中选中需求或带 Skill 的需求节点，然后直接右键选择“保存为个人模板”；也可以打开左侧“模板”并点击顶部“保存”。使用时点击模板即可插入一份可编辑需求，不会自动执行或扣费。</p>
                  </PolicySection>
                  <PolicySection title="套图计划模板">
                    <p>底部跨境工具中的“模板市场”保存的是整套套图或多语言计划。打开模板市场点击“新建”，配置计划后点击窗口底部“保存到模板市场”。它与左侧需求模板互不覆盖。</p>
                  </PolicySection>
                  <PolicySection title="高并发保护">
                    <p>大批量任务先用小批量探测；探测失败会停止后续放量。点击生成即代表授权向你配置的上游接口发起可能计费的请求。</p>
                  </PolicySection>
                  <PolicySection title="快捷键与工具显隐">
                    <p>在“设置 → 工具”中自定义快捷键、启停底部工具和左侧素材模块。工具按钮悬停时会显示快捷键。</p>
                  </PolicySection>
                  <PolicySection title="找不到结果时">
                    <p>先切到“专注”查看生成图片组；也可在左侧“成果”中定位。无需记住双击等隐藏操作。</p>
                  </PolicySection>
                </div>
              ) : null}

              {activeSection === "privacy" ? (
                <div className="help-policy-copy">
                  <PolicySection title="1. 本地保存">
                    <p>项目画布、图片副本、会话、设置和缓存默认保存在你的电脑或你明确选择的项目目录。SparkAI WorkSpace 不会主动扫描项目范围之外的文件。</p>
                  </PolicySection>
                  <PolicySection title="2. 上游传输">
                    <p>当你登录中转站、刷新模型、调用 Agent 或生成图片时，必要的文字、所选图片和请求参数会发送到你配置的账号服务、Base URL 或其上游模型提供商。对应服务的隐私规则同时适用。</p>
                  </PolicySection>
                  <PolicySection title="3. 密钥与账号信息">
                    <p>自定义 API Key 由 Electron 主进程使用操作系统安全存储加密保存；普通设置文件不保存明文密钥。账号会话和授权信息不展示在公开 UI、日志或项目文件中。</p>
                  </PolicySection>
                  <PolicySection title="4. 删除与保留">
                    <p>默认卸载保留项目与设置，避免误删创作数据。卸载时明确选择“删除本地数据”才会清理内部项目、会话、缓存和设置；外部项目与原始图片不在清理范围内。</p>
                  </PolicySection>
                  <p className="help-policy-meta">生效日期：2026-08-01 · 软件制作者：namean</p>
                </div>
              ) : null}

              {activeSection === "terms" ? (
                <div className="help-policy-copy">
                  <PolicySection title="许可与使用">
                    <p>SparkAI WorkSpace 是 AI 视觉工作工具。用户获得的是在合法授权范围内使用软件的权利，不得绕过授权、破坏安全机制、转售密钥或利用软件实施违法行为。</p>
                  </PolicySection>
                  <PolicySection title="内容与权利">
                    <p>用户应确保导入图片、品牌素材、人物肖像、商标、提示词和生成用途具备必要权利，并自行复核平台规则、知识产权、广告合规与生成结果。</p>
                  </PolicySection>
                  <PolicySection title="第三方服务">
                    <p>模型、中转站、登录账号、网络代理和电商平台均可能由第三方提供。其可用性、内容政策、价格、配额和处理结果不由 SparkAI WorkSpace 控制。</p>
                  </PolicySection>
                  <PolicySection title="责任边界">
                    <p>软件会尽合理努力保护项目与任务状态，但用户仍应备份关键项目并在正式发布商品前人工检查图片、翻译、尺寸、费用和平台合规性。</p>
                  </PolicySection>
                  <p className="help-policy-meta">生效日期：2026-08-01 · 软件制作者：namean</p>
                </div>
              ) : null}

              {activeSection === "fees" ? (
                <div className="help-policy-copy">
                  <PolicySection title="AI 生成费用">
                    <p>SparkAI WorkSpace 本身是视觉生成工具。点击生成、套图或翻译生图后，会直接向用户配置的 Base URL、中转站或上游模型发起请求；相关扣费、余额、账单、退款和价格争议由用户与对应服务商处理。</p>
                  </PolicySection>
                  <PolicySection title="小批量保护不是免计费承诺">
                    <p>高并发任务会先探测再放量，以减少集中失败；探测请求本身仍可能被上游计费。SparkAI WorkSpace 不承诺第三方一定撤销失败请求费用。</p>
                  </PolicySection>
                  <PolicySection title="软件购买退款">
                    <p>软件许可或订阅退款以实际销售页面、付款渠道和适用法律展示的规则为准。AI 上游费用不包含在 SparkAI WorkSpace 软件购买价中，也不由 SparkAI WorkSpace 代收或代退。</p>
                  </PolicySection>
                  <PolicySection title="异常处理">
                    <p>发现重复派发、明显软件故障或异常请求时，应先停止任务并保存日志摘要，再联系软件销售渠道；不得在公开材料中提交 API Key、Cookie 或完整账号凭据。</p>
                  </PolicySection>
                  <p className="help-policy-meta">生效日期：2026-08-01 · 软件制作者：namean</p>
                </div>
              ) : null}

              {activeSection === "about" ? (
                <div className="help-about-card">
                  <img src="./naimage.png" alt="" draggable={false} />
                  <div>
                    <span>AI IMAGE WORKSPACE</span>
                    <h3>SparkAI WorkSpace</h3>
                    <p>面向 Amazon 与速卖通卖家的图片生成、套图、本地化与平台交付工作台。</p>
                    <dl>
                      <div><dt>软件制作者</dt><dd>namean</dd></div>
                      <div><dt>首批目标用户</dt><dd>Amazon、速卖通卖家</dd></div>
                      <div><dt>政策生效日期</dt><dd>2026-08-01</dd></div>
                    </dl>
                  </div>
                </div>
              ) : null}
            </SurfaceBody>
          </div>
          <SurfaceFooter leading={<span className="help-center-footer-note">项目关键成果请保留独立备份，并在发布前人工复核。</span>}>
            <ActionButton variant="primary" onClick={close}>知道了</ActionButton>
          </SurfaceFooter>
        </>
      )}
    </DialogShell>
  );
}
