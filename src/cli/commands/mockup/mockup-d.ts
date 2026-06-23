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

// MOCKUP ONLY — Approach D: status-first, task-oriented reconfigure flow (Add / Remove / New scope / Uninstall / Refresh). Not production code.

import { cyan, dim, green, red } from '../../../ui/colors.js';
import { selectPrompt } from '../../../ui/components/prompts.js';
import { print } from '../../../ui/messages.js';
import {
  AGENTS,
  type FakeInstall,
  FEATURE_LABELS,
  type MockupOption,
  multiSelectWithInitial,
} from './shared.js';

const CURRENT_PROJECT = '~/source/repos/sonarqube-cli';
const HEADER_WIDTH = 57;
// Hide non-interactive flag hints in the summary. Flip to true to re-enable.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
const SHOW_FLAG_HINTS = false as boolean;

const AGENT_CLI_SLUGS: Record<string, string> = {
  'Claude Code': 'claude',
  Cursor: 'cursor',
  Copilot: 'copilot',
  Codex: 'codex',
  Antigravity: 'antigravity',
  Git: 'git',
};

type TaskAction = 'add' | 'remove' | 'new-scope' | 'uninstall' | 'refresh' | 'quit';

interface PendingChange {
  agent: string;
  scope: string;
  toRemove: string[];
  toAdd: string[];
  uninstall?: boolean;
  refresh?: boolean;
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

function renderStatusPanel(): void {
  print('');
  print(`${cyan('┌')} Current integrations`);
  print(cyan('└' + '─'.repeat(HEADER_WIDTH)));
  print('');

  const entries = Object.entries(AGENTS);
  for (const [agent, installs] of entries) {
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

async function pickTask(): Promise<TaskAction> {
  const choice = await selectPrompt<TaskAction>('What would you like to do?', [
    { value: 'add', label: 'Add features to an existing integration' },
    { value: 'remove', label: 'Remove features' },
    { value: 'new-scope', label: 'Install in a new scope' },
    { value: 'uninstall', label: 'Uninstall an integration' },
    { value: 'refresh', label: 'Refresh existing installs (re-apply)' },
    { value: 'quit', label: 'Quit' },
  ]);
  return choice ?? 'quit';
}

async function pickAgentScope(
  message: string,
  options: AgentScopeOption[],
): Promise<AgentScopeOption | null> {
  const choice = await selectPrompt<AgentScopeOption | null>(message, [
    ...options.map((o) => ({ value: o, label: o.label })),
    { value: null, label: 'Cancel' },
  ]);
  return choice;
}

async function runAddFlow(): Promise<PendingChange | null> {
  const options = flattenAgentScopeOptions((i) =>
    i.availableFeatures.some((f) => !i.installedFeatures.includes(f)),
  );
  if (options.length === 0) {
    print(
      `\n  ${dim('Nothing to add — every existing scope already has all features installed.')}`,
    );
    return null;
  }
  const chosen = await pickAgentScope('Add features — which integration?', options);
  if (!chosen) return null;

  const addable = chosen.install.availableFeatures.filter(
    (f) => !chosen.install.installedFeatures.includes(f),
  );
  print('');
  const picked = await multiSelectWithInitial(
    `Add to ${chosen.agent} · ${shortScopeLabel(chosen.install)}`,
    featureOptions(addable),
    [],
  );
  if (picked === null || picked.length === 0) return null;

  return {
    agent: chosen.agent,
    scope: shortScopeLabel(chosen.install),
    toAdd: picked,
    toRemove: [],
  };
}

async function runRemoveFlow(): Promise<PendingChange | null> {
  const options = flattenAgentScopeOptions((i) => i.installedFeatures.length > 0);
  if (options.length === 0) {
    print(`\n  ${dim('Nothing to remove — no features installed anywhere.')}`);
    return null;
  }
  const chosen = await pickAgentScope('Remove features — which integration?', options);
  if (!chosen) return null;

  print('');
  const picked = await multiSelectWithInitial(
    `Remove from ${chosen.agent} · ${shortScopeLabel(chosen.install)}`,
    featureOptions(chosen.install.installedFeatures),
    [],
  );
  if (picked === null || picked.length === 0) return null;

  if (picked.length === chosen.install.installedFeatures.length) {
    print('');
    print(
      `  ${red('⚠')}  Removing all features will fully uninstall ${chosen.agent} from ${shortScopeLabel(chosen.install)}.`,
    );
    const confirm = await selectPrompt<boolean>('Continue?', [
      { value: true, label: 'Yes — remove all (full uninstall of this scope)' },
      { value: false, label: 'Cancel' },
    ]);
    if (!confirm) return null;
  }

  return {
    agent: chosen.agent,
    scope: shortScopeLabel(chosen.install),
    toAdd: [],
    toRemove: picked,
  };
}

function buildNewScopeChoices(): NewScopeChoice[] {
  const out: NewScopeChoice[] = [];
  for (const [agent, installs] of Object.entries(AGENTS)) {
    const hasGlobal = installs.some((i) => i.scope === 'global');
    const hasCurrent = installs.some((i) => i.scope === 'project' && i.label === CURRENT_PROJECT);
    const unionFeatures = [...new Set(installs.flatMap((i) => i.availableFeatures))];
    if (!hasGlobal) {
      out.push({
        agent,
        scopeKind: 'global',
        scopeLabel: 'Global',
        availableFeatures: unionFeatures,
      });
    }
    if (!hasCurrent) {
      out.push({
        agent,
        scopeKind: 'current-project',
        scopeLabel: CURRENT_PROJECT,
        availableFeatures: unionFeatures,
      });
    }
  }
  return out;
}

async function runNewScopeFlow(): Promise<PendingChange | null> {
  const choices = buildNewScopeChoices();
  if (choices.length === 0) {
    print(
      `\n  ${dim('No empty scopes — every agent already has both Global and the current project.')}`,
    );
    return null;
  }

  const chosen = await selectPrompt<NewScopeChoice | null>('Install in a new scope — which?', [
    ...choices.map((c) => ({
      value: c,
      label: `${c.agent} · ${c.scopeKind === 'global' ? 'Global' : `${c.scopeLabel}  (current project)`}`,
    })),
    { value: null, label: 'Cancel' },
  ]);
  if (!chosen) return null;

  if (chosen.availableFeatures.length === 0) {
    print(`\n  ${dim('No features known for this agent (mockup limitation).')}`);
    return null;
  }

  print('');
  const picked = await multiSelectWithInitial(
    `Install ${chosen.agent} in ${chosen.scopeKind === 'global' ? 'Global' : chosen.scopeLabel}`,
    featureOptions(chosen.availableFeatures),
    [...chosen.availableFeatures],
  );
  if (picked === null || picked.length === 0) return null;

  return {
    agent: chosen.agent,
    scope: chosen.scopeKind === 'global' ? 'Global' : chosen.scopeLabel,
    toAdd: picked,
    toRemove: [],
  };
}

async function runUninstallFlow(): Promise<PendingChange[] | null> {
  const options = flattenAgentScopeOptions((i) => i.installedFeatures.length > 0);
  if (options.length === 0) {
    print(`\n  ${dim('Nothing to uninstall.')}`);
    return null;
  }
  const picked = await multiSelectWithInitial(
    'Uninstall — which scopes to fully remove?',
    options.map((o) => ({ id: o.id, label: o.label })),
    [],
  );
  if (picked === null || picked.length === 0) return null;

  const byId = new Map(options.map((o) => [o.id, o]));
  return picked.flatMap<PendingChange>((id) => {
    const o = byId.get(id);
    if (!o) return [];
    return [
      {
        agent: o.agent,
        scope: shortScopeLabel(o.install),
        toAdd: [],
        toRemove: [...o.install.installedFeatures],
        uninstall: true,
      },
    ];
  });
}

async function runRefreshFlow(): Promise<PendingChange[] | null> {
  const agentNames = Object.keys(AGENTS).filter((a) => (AGENTS[a] ?? []).length > 0);
  if (agentNames.length === 0) {
    print(`\n  ${dim('Nothing to refresh.')}`);
    return null;
  }
  const picked = await multiSelectWithInitial(
    'Refresh — which integrations to re-apply?',
    agentNames.map((a) => ({ id: a, label: a })),
    [],
  );
  if (picked === null || picked.length === 0) return null;
  return picked.map<PendingChange>((agent) => ({
    agent,
    scope: '(all scopes)',
    toAdd: [],
    toRemove: [],
    refresh: true,
  }));
}

function scopeFlagFor(change: PendingChange): string {
  if (change.scope === 'Global') return '--global';
  if (change.scope === '(all scopes)') return '';
  return `--project ${change.scope}`;
}

function buildEquivalentCommand(change: PendingChange): string {
  const slug = cliSlug(change.agent);
  const scopeFlag = scopeFlagFor(change);

  if (change.refresh) {
    return `sonar integrate ${slug}`;
  }
  if (change.uninstall) {
    return [`sonar integrate ${slug}`, scopeFlag, '--uninstall'].filter(Boolean).join(' ');
  }
  const parts = [`sonar integrate ${slug}`, scopeFlag].filter(Boolean);
  if (change.toAdd.length > 0) parts.push(`--add ${change.toAdd.join(',')}`);
  if (change.toRemove.length > 0) parts.push(`--remove ${change.toRemove.join(',')}`);
  return parts.join(' ');
}

function declarativeEquivalent(change: PendingChange): string | null {
  if (change.refresh || change.uninstall) return null;
  if (change.toAdd.length === 0 && change.toRemove.length === 0) return null;
  const slug = cliSlug(change.agent);
  const scopeFlag = scopeFlagFor(change);
  // For declarative form we only know the *delta*, not the full intended set;
  // hint at the idempotent form so agents see it exists.
  return `${[`sonar integrate ${slug}`, scopeFlag].filter(Boolean).join(' ')} --features <comma-list> --non-interactive`;
}

function printSummaryWithEquivalent(changes: PendingChange[]): void {
  for (const change of changes) {
    const tag = dim(`[${change.agent} · ${change.scope}]`);
    if (change.refresh) {
      print(`  ${cyan('↻')}  ${tag} Refresh (re-apply current install)`);
    } else if (change.uninstall) {
      print(`  ${red('✗')}  ${tag} Uninstall (remove all features and integration files)`);
    } else {
      if (change.toRemove.length > 0) {
        print(`  ${red('−')}  ${tag} Remove:`);
        for (const id of change.toRemove) print(`       ${FEATURE_LABELS[id] ?? id}`);
      }
      if (change.toAdd.length > 0) {
        print(`  ${green('+')}  ${tag} Install:`);
        for (const id of change.toAdd) print(`       ${FEATURE_LABELS[id] ?? id}`);
      }
    }
    if (SHOW_FLAG_HINTS) {
      print(`     ${dim('≡ ' + buildEquivalentCommand(change))}`);
      const declarative = declarativeEquivalent(change);
      if (declarative) {
        print(`     ${dim('  or: ' + declarative)}`);
      }
    }
    print('');
  }
}

async function runOneTask(task: TaskAction): Promise<PendingChange[]> {
  if (task === 'add') {
    const c = await runAddFlow();
    return c ? [c] : [];
  }
  if (task === 'remove') {
    const c = await runRemoveFlow();
    return c ? [c] : [];
  }
  if (task === 'new-scope') {
    const c = await runNewScopeFlow();
    return c ? [c] : [];
  }
  if (task === 'uninstall') {
    return (await runUninstallFlow()) ?? [];
  }
  if (task === 'refresh') {
    return (await runRefreshFlow()) ?? [];
  }
  return [];
}

export async function runMockupD(): Promise<void> {
  renderStatusPanel();

  const pendingChanges: PendingChange[] = [];

  for (;;) {
    const task = await pickTask();
    if (task === 'quit') break;

    const changes = await runOneTask(task);
    pendingChanges.push(...changes);

    print('');
    const more = await selectPrompt<boolean>('Anything else?', [
      { value: false, label: 'No — review and apply' },
      { value: true, label: 'Yes — pick another task' },
    ]);
    if (!more) break;
  }

  print('');
  if (pendingChanges.length === 0) {
    print(`  ${green('✓')}  No changes.`);
    return;
  }

  print(`${cyan('┌')} Summary of changes`);
  print(cyan('└' + '─'.repeat(HEADER_WIDTH)));
  print('');
  printSummaryWithEquivalent(pendingChanges);

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
