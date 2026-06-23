/*
 * SonarQube CLI
 * Copyright (C) SonarSource Sàrl
 * mailto:info AT sonarsource DOT com
 *
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 3 of the License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this program; if not, write to the Free Software Foundation,
 * Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
 */

// MOCKUP ONLY — Approach D2: status-first, two-verb reconfigure flow (Install / Remove). Install handles both existing + new scopes; Remove folds in uninstall. Not production code.

import { isCancel, Prompt } from '@clack/core';

import { bold, cyan, dim, green, red } from '../../../ui/colors.js';
import { selectPrompt } from '../../../ui/components/prompts.js';
import { print } from '../../../ui/messages.js';
import {
  AGENT_FEATURE_CATALOG,
  AGENTS,
  type FakeInstall,
  FEATURE_LABELS,
  type MockupOption,
  multiSelectWithInitial,
} from './shared.js';

const CURRENT_PROJECT = '~/source/repos/sonarqube-cli';
// Hide non-interactive flag hints in the summary. Flip to true to re-enable.
const SHOW_FLAG_HINTS = false as boolean;

const AGENT_CLI_SLUGS: Record<string, string> = {
  'Claude Code': 'claude',
  Cursor: 'cursor',
  Copilot: 'copilot',
  Codex: 'codex',
  Antigravity: 'antigravity',
  Git: 'git',
};

type TaskAction = 'install' | 'remove' | 'done' | 'quit';

interface PendingChange {
  agent: string;
  scope: string;
  toRemove: string[];
  toAdd: string[];
  uninstall?: boolean;
  newScope?: boolean;
}

interface AgentScopeOption extends MockupOption {
  agent: string;
  install: FakeInstall;
}

interface NewScopeChoice {
  agent: string;
  scopeKind: 'global' | 'current-project';
  scopeLabel: string;
  availableFeatures: string[];
}

function cliSlug(agent: string): string {
  return AGENT_CLI_SLUGS[agent] ?? agent.toLowerCase().replace(/\s+/g, '-');
}

function scopeDisplay(install: FakeInstall): string {
  if (install.scope === 'global') return 'Global';
  if (install.label === CURRENT_PROJECT) return `${install.label}  (current project)`;
  return install.label;
}

function shortScopeLabel(install: FakeInstall): string {
  return install.scope === 'global' ? 'Global' : install.label;
}

function featureOptions(ids: string[]): MockupOption[] {
  return ids.map((id) => ({ id, label: FEATURE_LABELS[id] ?? id }));
}

function featureNames(ids: string[]): string {
  if (ids.length === 0) return 'none';
  return ids.map((id) => FEATURE_LABELS[id] ?? id).join(', ');
}

function flattenAgentScopeOptions(
  predicate: (install: FakeInstall) => boolean,
): AgentScopeOption[] {
  const out: AgentScopeOption[] = [];
  for (const [agent, installs] of Object.entries(AGENTS)) {
    for (const install of installs) {
      if (!predicate(install)) continue;
      const id = `${agent}::${install.label}`;
      const label = `${agent} · ${scopeDisplay(install)}`;
      out.push({ id, label, agent, install });
    }
  }
  return out;
}

function buildNewScopeChoices(): NewScopeChoice[] {
  const out: NewScopeChoice[] = [];
  for (const [agent, installs] of Object.entries(AGENTS)) {
    const hasGlobal = installs.some((i) => i.scope === 'global');
    const hasCurrent = installs.some((i) => i.scope === 'project' && i.label === CURRENT_PROJECT);
    const catalog = AGENT_FEATURE_CATALOG[agent];
    if (!catalog) continue;
    if (!hasGlobal) {
      out.push({
        agent,
        scopeKind: 'global',
        scopeLabel: 'Global',
        availableFeatures: catalog.global,
      });
    }
    if (!hasCurrent) {
      out.push({
        agent,
        scopeKind: 'current-project',
        scopeLabel: CURRENT_PROJECT,
        availableFeatures: catalog.project,
      });
    }
  }
  return out;
}

function renderStatusPanel(): void {
  print('');
  print(`  ${bold('Current integrations')}`);
  print('');

  for (const [agent, installs] of Object.entries(AGENTS)) {
    if (installs.length === 0) {
      print(`  ${dim('●')}  ${dim(`${agent} — not integrated`)}`);
      continue;
    }
    print(`  ${cyan('●')}  ${agent}`);
    for (const install of installs) {
      print(`      ${dim(scopeDisplay(install))}`);
      if (install.installedFeatures.length === 0) {
        print(`        ${dim('(no features)')}`);
      } else {
        for (const id of install.installedFeatures) {
          print(`        ${green('✓')} ${FEATURE_LABELS[id] ?? id}`);
        }
      }
    }
    print('');
  }
}

// ─── Grouped scope picker — agent headers + indented items ───────────────────

interface GroupedItem<T> {
  label: string;
  value: T;
}

interface AgentGroup<T> {
  agent: string;
  items: GroupedItem<T>[];
}

type GroupedRow<T> =
  | { kind: 'header'; agent: string }
  | { kind: 'item'; label: string; value: T }
  | { kind: 'cancel' };

async function pickGrouped<T>(message: string, groups: AgentGroup<T>[]): Promise<T | null> {
  const rows: GroupedRow<T>[] = [];
  for (const g of groups) {
    if (g.items.length === 0) continue;
    rows.push({ kind: 'header', agent: g.agent });
    for (const item of g.items) rows.push({ kind: 'item', label: item.label, value: item.value });
  }
  rows.push({ kind: 'cancel' });

  const firstItem = rows.findIndex((r) => r.kind === 'item' || r.kind === 'cancel');
  let cursor = firstItem >= 0 ? firstItem : 0;

  const isSelectable = (i: number): boolean => {
    const r = rows[i];
    return r.kind === 'item' || r.kind === 'cancel';
  };

  const moveUp = (): void => {
    let next = cursor - 1;
    while (next >= 0 && !isSelectable(next)) next--;
    if (next >= 0) cursor = next;
  };
  const moveDown = (): void => {
    let next = cursor + 1;
    while (next < rows.length && !isSelectable(next)) next++;
    if (next < rows.length) cursor = next;
  };

  let chosen: T | null = null;
  let didCancel = false as boolean;

  const prompt = new Prompt<T | null>(
    {
      render() {
        if (this.state === 'submit') {
          const r = rows[cursor];
          const label = r.kind === 'item' ? r.label : '';
          return `  ${green('✓')}  ${message} ${dim(label)}`;
        }
        if (this.state === 'cancel') return `  ${red('✗')}  ${message}`;

        const lines = [`  ${cyan('?')}  ${message}`];
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          const isCursor = i === cursor;
          if (r.kind === 'header') {
            lines.push(`     ${cyan('●')}  ${cyan(r.agent)}`);
          } else if (r.kind === 'cancel') {
            const arrow = isCursor ? cyan('❯') : ' ';
            const label = isCursor ? 'Cancel' : dim('Cancel');
            lines.push('');
            lines.push(`    ${arrow} ${label}`);
          } else {
            const arrow = isCursor ? cyan('❯') : ' ';
            const label = isCursor ? r.label : dim(r.label);
            lines.push(`    ${arrow}     ${label}`);
          }
        }
        return lines.join('\n');
      },
    },
    false,
  );

  prompt.on('cursor', (dir) => {
    if (dir === 'up') moveUp();
    else if (dir === 'down') moveDown();
  });

  prompt.on('key', (_key, s) => {
    if (s.name === 'return') {
      const r = rows[cursor];
      if (r.kind === 'cancel') {
        didCancel = true;
        prompt.state = 'cancel';
      } else if (r.kind === 'item') {
        chosen = r.value;
        prompt.value = r.value;
      }
    } else if (s.name === 'q') {
      didCancel = true;
      prompt.state = 'cancel';
    }
  });

  const out = await prompt.prompt();
  if (isCancel(out) || didCancel) return null;
  return chosen;
}

async function pickTask(hasPending: boolean): Promise<TaskAction> {
  const options: { value: TaskAction; label: string }[] = [
    { value: 'install', label: 'Install / add features' },
    { value: 'remove', label: 'Remove features' },
  ];
  if (hasPending) {
    options.push({ value: 'done', label: 'Done — review & apply' });
  }
  options.push({ value: 'quit', label: 'Quit' });

  const choice = await selectPrompt<TaskAction>(
    hasPending ? 'What next?' : 'What would you like to do?',
    options,
  );
  return choice ?? 'quit';
}

async function confirmDiscard(count: number): Promise<boolean> {
  const choice = await selectPrompt<boolean>(
    `Discard ${count} staged change${count === 1 ? '' : 's'}?`,
    [
      { value: false, label: 'Keep editing' },
      { value: true, label: 'Discard and quit' },
    ],
  );
  return choice === true;
}

// ─── Install / add features (merged: existing-with-room OR new scope) ─────────

interface InstallTargetExisting {
  kind: 'existing';
  option: AgentScopeOption;
}
interface InstallTargetNew {
  kind: 'new';
  choice: NewScopeChoice;
}
type InstallTarget = InstallTargetExisting | InstallTargetNew;

async function pickInstallTarget(): Promise<InstallTarget | null> {
  const existing = flattenAgentScopeOptions((i) =>
    i.availableFeatures.some((f) => !i.installedFeatures.includes(f)),
  );
  const newScopes = buildNewScopeChoices();

  if (existing.length === 0 && newScopes.length === 0) {
    print(
      `\n  ${dim('Nothing to install — every agent already has every feature in every scope.')}`,
    );
    return null;
  }

  // Build per-agent groups, keeping the AGENTS declaration order.
  const groups: AgentGroup<InstallTarget>[] = Object.keys(AGENTS).map((agent) => {
    const items: GroupedItem<InstallTarget>[] = [];
    for (const o of existing) {
      if (o.agent !== agent) continue;
      items.push({
        label: scopeDisplay(o.install),
        value: { kind: 'existing', option: o },
      });
    }
    for (const c of newScopes) {
      if (c.agent !== agent) continue;
      const label =
        c.scopeKind === 'global'
          ? `+ Install in Global`
          : `+ Install in ${c.scopeLabel}  (current project)`;
      items.push({ label, value: { kind: 'new', choice: c } });
    }
    return { agent, items };
  });

  return pickGrouped('Install / add features — which scope?', groups);
}

async function runInstallFlow(): Promise<PendingChange | null> {
  const target = await pickInstallTarget();
  if (!target) return null;

  if (target.kind === 'existing') {
    const install = target.option.install;
    const addable = install.availableFeatures.filter((f) => !install.installedFeatures.includes(f));
    print('');
    print(
      `  ${dim(`${target.option.agent} · ${shortScopeLabel(install)}  — currently installed: ${featureNames(install.installedFeatures)}`)}`,
    );
    const picked = await multiSelectWithInitial(
      'Which features to add?',
      featureOptions(addable),
      [],
    );
    if (picked === null || picked.length === 0) return null;
    return {
      agent: target.option.agent,
      scope: shortScopeLabel(install),
      toAdd: picked,
      toRemove: [],
    };
  }

  // new scope
  const c = target.choice;
  if (c.availableFeatures.length === 0) {
    print(`\n  ${dim('No features known for this agent (mockup limitation).')}`);
    return null;
  }
  const scopeLabel = c.scopeKind === 'global' ? 'Global' : c.scopeLabel;
  print('');
  print(`  ${dim(`${c.agent} · ${scopeLabel}  — new scope (no features installed yet)`)}`);
  const picked = await multiSelectWithInitial(
    'Which features to install?',
    featureOptions(c.availableFeatures),
    [...c.availableFeatures],
  );
  if (picked === null || picked.length === 0) return null;
  return {
    agent: c.agent,
    scope: scopeLabel,
    toAdd: picked,
    toRemove: [],
    newScope: true,
  };
}

// ─── Remove features (folds in full uninstall) ───────────────────────────────

async function runRemoveFlow(): Promise<PendingChange | null> {
  const options = flattenAgentScopeOptions((i) => i.installedFeatures.length > 0);
  if (options.length === 0) {
    print(`\n  ${dim('Nothing to remove — no features installed anywhere.')}`);
    return null;
  }
  const groups: AgentGroup<AgentScopeOption>[] = Object.keys(AGENTS).map((agent) => ({
    agent,
    items: options
      .filter((o) => o.agent === agent)
      .map((o) => ({ label: scopeDisplay(o.install), value: o })),
  }));
  const chosen = await pickGrouped('Remove features — which scope?', groups);
  if (!chosen) return null;

  print('');
  print(
    `  ${dim(`${chosen.agent} · ${shortScopeLabel(chosen.install)}  — currently installed: ${featureNames(chosen.install.installedFeatures)}`)}`,
  );
  const picked = await multiSelectWithInitial(
    'Which features to remove?',
    featureOptions(chosen.install.installedFeatures),
    [],
  );
  if (picked === null || picked.length === 0) return null;

  const isFullUninstall = picked.length === chosen.install.installedFeatures.length;
  if (isFullUninstall) {
    print('');
    print(
      `  ${red('⚠')}  Removing all features will fully uninstall ${chosen.agent} from ${shortScopeLabel(chosen.install)} (integration files & hooks will be removed).`,
    );
    const confirm = await selectPrompt<boolean>('Continue?', [
      { value: true, label: 'Yes — uninstall this scope' },
      { value: false, label: 'Cancel' },
    ]);
    if (!confirm) return null;
  }

  return {
    agent: chosen.agent,
    scope: shortScopeLabel(chosen.install),
    toAdd: [],
    toRemove: picked,
    uninstall: isFullUninstall,
  };
}

// ─── Stage confirmation (per task) ───────────────────────────────────────────

function printStageConfirmation(change: PendingChange): void {
  const where = `${change.agent} · ${change.scope}`;
  if (change.uninstall) {
    print(`  ${green('✓')}  Staged: ${red('uninstall')} ${where}`);
    return;
  }
  if (change.newScope) {
    print(
      `  ${green('✓')}  Staged: ${green('+ new scope')} ${where} (${featureNames(change.toAdd)})`,
    );
    return;
  }
  const parts: string[] = [];
  if (change.toAdd.length > 0) parts.push(green(`+ ${featureNames(change.toAdd)}`));
  if (change.toRemove.length > 0) parts.push(red(`− ${featureNames(change.toRemove)}`));
  print(`  ${green('✓')}  Staged: ${parts.join(', ')} on ${where}`);
}

// ─── Summary ─────────────────────────────────────────────────────────────────

function scopeFlagFor(change: PendingChange): string {
  if (change.scope === 'Global') return '--global';
  return `--project ${change.scope}`;
}

function buildEquivalentCommand(change: PendingChange): string {
  const slug = cliSlug(change.agent);
  const scopeFlag = scopeFlagFor(change);
  if (change.uninstall) {
    return `sonar integrate ${slug} ${scopeFlag} --uninstall`;
  }
  const parts = [`sonar integrate ${slug}`, scopeFlag];
  if (change.toAdd.length > 0) parts.push(`--add ${change.toAdd.join(',')}`);
  if (change.toRemove.length > 0) parts.push(`--remove ${change.toRemove.join(',')}`);
  return parts.join(' ');
}

function declarativeEquivalent(change: PendingChange): string | null {
  if (change.uninstall) return null;
  if (change.toAdd.length === 0 && change.toRemove.length === 0) return null;
  const slug = cliSlug(change.agent);
  const scopeFlag = scopeFlagFor(change);
  return `sonar integrate ${slug} ${scopeFlag} --features <comma-list> --non-interactive`;
}

function scopeAnnotation(change: PendingChange): string {
  if (change.uninstall) return dim('  (uninstall)');
  if (change.newScope) return dim('  (new scope)');
  return '';
}

function printSummary(changes: PendingChange[]): void {
  // Group by agent in the same order the status panel uses.
  const byAgent = new Map<string, PendingChange[]>();
  for (const c of changes) {
    const list = byAgent.get(c.agent) ?? [];
    list.push(c);
    byAgent.set(c.agent, list);
  }

  const agentOrder = Object.keys(AGENTS).filter((a) => byAgent.has(a));
  agentOrder.forEach((agent, idx) => {
    print(`  ${cyan('●')}  ${agent}`);
    const list = byAgent.get(agent) ?? [];
    for (const change of list) {
      print(`      ${dim(change.scope)}${scopeAnnotation(change)}`);
      for (const id of change.toRemove) {
        print(`        ${red('−')} ${FEATURE_LABELS[id] ?? id}`);
      }
      for (const id of change.toAdd) {
        print(`        ${green('+')} ${FEATURE_LABELS[id] ?? id}`);
      }
      if (SHOW_FLAG_HINTS) {
        print(`          ${dim('≡ ' + buildEquivalentCommand(change))}`);
        const declarative = declarativeEquivalent(change);
        if (declarative) {
          print(`          ${dim('  or: ' + declarative)}`);
        }
      }
    }
    if (idx < agentOrder.length - 1) print('');
  });
  print('');
}

// ─── main entry ──────────────────────────────────────────────────────────────

async function runOneTask(task: TaskAction): Promise<PendingChange | null> {
  if (task === 'install') return runInstallFlow();
  if (task === 'remove') return runRemoveFlow();
  return null;
}

export async function runMockupD2(): Promise<void> {
  renderStatusPanel();

  const pendingChanges: PendingChange[] = [];

  for (;;) {
    const task = await pickTask(pendingChanges.length > 0);
    if (task === 'quit') {
      if (pendingChanges.length === 0) return;
      const discard = await confirmDiscard(pendingChanges.length);
      if (discard) {
        print(`\n  ${red('✗')}  Discarded ${pendingChanges.length} staged change(s).`);
        return;
      }
      continue; // back to menu
    }
    if (task === 'done') break;

    const change = await runOneTask(task);
    if (change) {
      pendingChanges.push(change);
      print('');
      printStageConfirmation(change);
      print('');
    }
  }

  print('');
  if (pendingChanges.length === 0) {
    print(`  ${green('✓')}  No changes.`);
    return;
  }

  print(`  ${bold('Summary of changes')}`);
  print('');
  printSummary(pendingChanges);

  const confirm = await selectPrompt<boolean>('Apply all changes?', [
    { value: true, label: 'Yes, apply all' },
    { value: false, label: 'Cancel' },
  ]);

  if (confirm) {
    print(`\n  ${green('✓')}  Done. (mockup — no real changes made)`);
  } else {
    print(`\n  ${red('✗')}  Cancelled.`);
  }
}
