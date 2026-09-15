"use strict";

const os = require("node:os");
const path = require("node:path");
const { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");

const SKILL_NAME = "naimage-control";
const TARGET_IDS = new Set(["codex", "claude-code", "opencode", "openclaw"]);

function uniquePaths(values) {
  const seen = new Set();
  return values.flatMap((value) => {
    const resolved = path.resolve(String(value || ""));
    const key = resolved.toLowerCase();
    if (!value || seen.has(key)) return [];
    seen.add(key);
    return [resolved];
  });
}

function targetSpecs() {
  const home = os.homedir();
  return [
    {
      id: "codex",
      label: "Codex",
      candidates: uniquePaths([process.env.CODEX_HOME, path.join(home, ".codex")])
    },
    {
      id: "claude-code",
      label: "Claude Code",
      candidates: uniquePaths([process.env.CLAUDE_CONFIG_DIR, path.join(home, ".claude")])
    },
    {
      id: "opencode",
      label: "OpenCode",
      candidates: uniquePaths([path.join(home, ".config", "opencode"), path.join(home, ".opencode")])
    },
    {
      id: "openclaw",
      label: "OpenClaw",
      candidates: uniquePaths([process.env.OPENCLAW_HOME, path.join(home, ".openclaw")])
    }
  ];
}

function createAgentIntegrationService({ appRoot, endpointPath, executablePath, log }) {
  const sourceSkillPath = path.join(appRoot, "integrations", SKILL_NAME);

  function resolvedTargets() {
    return targetSpecs().map((spec) => {
      const configPath = spec.candidates.find((candidate) => existsSync(candidate)) || spec.candidates[0];
      const skillsPath = path.join(configPath, "skills");
      const installPath = path.join(skillsPath, SKILL_NAME);
      return {
        id: spec.id,
        label: spec.label,
        configPath,
        skillsPath,
        installPath,
        detected: spec.candidates.some((candidate) => existsSync(candidate)),
        installed: existsSync(path.join(installPath, "SKILL.md"))
      };
    });
  }

  function publicTargets() {
    return resolvedTargets().map(({ installPath: _installPath, ...target }) => target);
  }

  function validateTargetIds(values) {
    return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value)).filter((value) => TARGET_IDS.has(value)))];
  }

  function install(values) {
    if (!existsSync(path.join(sourceSkillPath, "SKILL.md"))) throw new Error("内置 SparkAI WorkSpace Skill 缺失，请重新安装软件。");
    const ids = validateTargetIds(values);
    const installed = [];
    const errors = [];
    for (const target of resolvedTargets().filter((item) => ids.includes(item.id))) {
      try {
        if (existsSync(target.installPath) && lstatSync(target.installPath).isSymbolicLink()) {
          throw new Error("目标 Skill 路径是符号链接，已拒绝覆盖。");
        }
        mkdirSync(target.skillsPath, { recursive: true });
        cpSync(sourceSkillPath, target.installPath, { recursive: true, force: true, errorOnExist: false });
        writeFileSync(path.join(target.installPath, ".naimage-connection.json"), `${JSON.stringify({
          version: 1,
          endpointPath,
          executablePath,
          installedBy: "naimage",
          installedAt: new Date().toISOString()
        }, null, 2)}\n`, "utf8");
        installed.push(target.id);
        log(`agent skill installed target=${target.id}`);
      } catch (error) {
        errors.push(`${target.label}：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { ok: errors.length === 0, installed, errors, targets: publicTargets() };
  }

  function remove(values) {
    const ids = validateTargetIds(values);
    const removed = [];
    const errors = [];
    for (const target of resolvedTargets().filter((item) => ids.includes(item.id))) {
      try {
        if (!existsSync(target.installPath)) continue;
        if (lstatSync(target.installPath).isSymbolicLink()) throw new Error("目标 Skill 路径是符号链接，已拒绝删除。");
        const skillText = readFileSync(path.join(target.installPath, "SKILL.md"), "utf8");
        if (!/^---[\s\S]*?^name:\s*naimage-control\s*$/m.test(skillText)) throw new Error("目标目录不是 naimage-control Skill。");
        rmSync(target.installPath, { recursive: true, force: true });
        removed.push(target.id);
        log(`agent skill removed target=${target.id}`);
      } catch (error) {
        errors.push(`${target.label}：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { ok: errors.length === 0, removed, errors, targets: publicTargets() };
  }

  return {
    detect: () => ({ ok: true, endpointPath, targets: publicTargets() }),
    install,
    remove
  };
}

module.exports = { createAgentIntegrationService, TARGET_IDS };
