# Completion Audit

Run this audit before declaring a nontrivial task complete.

## Requirement Check

- [ ] Every explicit user request is mapped to an observable outcome or an explicit out-of-scope decision.
- [ ] Later user direction has replaced older conflicting direction in the relevant goal/ledger.
- [ ] The live code and current contracts were inspected after implementation; no claim relies only on an earlier assistant response.
- [ ] Any shared GUI/CLI/MCP, IPC/API, persistence, schema, or cross-repository consequence was updated or explicitly left unverified.

## Evidence Check

- [ ] Each completion claim has evidence at the correct tier in the verification matrix.
- [ ] Visible behavior has visible/exercised evidence, not merely source or DOM-presence evidence.
- [ ] Commands described as passed actually completed successfully in this task.
- [ ] Builds, EXEs, hashes, release state and screenshots are reported only when they exist now.
- [ ] Mocked or static evidence is not presented as real provider, billing, production or full integration evidence.

## Safety Check

- [ ] No secrets, cookies, tokens, signed URLs or restricted paths were placed in output or persistent project data.
- [ ] No unapproved paid request, duplicate creation, external publish or destructive action was taken.
- [ ] Unrelated dirty worktree changes were preserved.

## Memory Check

- [ ] Goal/progress reflect an active goal change where applicable.
- [ ] Context maps reflect any ownership, contract, persistence or test-entry-point change.
- [ ] A durable decision is recorded only when it is active and supported by user direction or current product authority.

If any item cannot be checked, do not call the work fully complete. Report the bounded gap in the handoff and continue or request the missing authority.
