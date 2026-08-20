import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const workspaceRoot = path.resolve(process.argv[2] || process.cwd());
const requiredFiles = [
  'AGENTS.md',
  'HARNESS.md',
  'WORKSPACE_CONTEXT_MAP.md',
  'harness/README.md',
  'harness/CONVERSATION_DECISIONS.md',
  'harness/TASK_PROTOCOL.md',
  'harness/VERIFICATION_MATRIX.md',
  'harness/TASK_BRIEF_TEMPLATE.md',
  'harness/COMPLETION_AUDIT.md',
];

const requiredPhrases = new Map([
  ['AGENTS.md', ['naimage-studio/', 'sparkai-extension/', 'Authority And Precedence', 'Safety Boundaries']],
  ['HARNESS.md', ['The Four Loops', 'Intent Is Not Fact', 'Evidence Discipline']],
  ['harness/CONVERSATION_DECISIONS.md', ['Active Product Decisions', 'Superseded Directions', 'Candidate Or Unverified Work']],
  ['harness/TASK_PROTOCOL.md', ['Classify Before Writing', 'Implement Along The Real Boundary', 'Verify And Handoff']],
  ['harness/VERIFICATION_MATRIX.md', ['Evidence Tiers', 'Authorization Gates', 'Quality Rules For UI Evidence']],
  ['harness/COMPLETION_AUDIT.md', ['Requirement Check', 'Evidence Check', 'Safety Check']],
]);

const errors = [];
const checked = [];

function readRequired(relativePath) {
  const absolutePath = path.join(workspaceRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    errors.push(`missing required file: ${relativePath}`);
    return null;
  }
  checked.push(relativePath);
  return fs.readFileSync(absolutePath, 'utf8');
}

function verifyLocalMarkdownLinks(relativePath, content) {
  const sourceDir = path.dirname(path.join(workspaceRoot, relativePath));
  const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of content.matchAll(linkPattern)) {
    const target = match[1].trim();
    if (!target || target.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    const targetPath = path.resolve(sourceDir, target.split('#', 1)[0]);
    if (!targetPath.startsWith(workspaceRoot + path.sep) && targetPath !== workspaceRoot) {
      errors.push(`link escapes workspace in ${relativePath}: ${target}`);
      continue;
    }
    if (!fs.existsSync(targetPath)) errors.push(`broken local link in ${relativePath}: ${target}`);
  }
}

for (const relativePath of requiredFiles) {
  const content = readRequired(relativePath);
  if (content === null) continue;
  verifyLocalMarkdownLinks(relativePath, content);
  for (const phrase of requiredPhrases.get(relativePath) || []) {
    if (!content.includes(phrase)) errors.push(`missing required section in ${relativePath}: ${phrase}`);
  }
}

const mapContent = readRequired('WORKSPACE_CONTEXT_MAP.md');
if (mapContent && !mapContent.includes('Workspace Agent Harness')) {
  errors.push('WORKSPACE_CONTEXT_MAP.md does not route to the workspace harness');
}

if (errors.length) {
  console.error('[harness] failed');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`[harness] passed ${checked.length} structural checks from ${workspaceRoot}`);
}
