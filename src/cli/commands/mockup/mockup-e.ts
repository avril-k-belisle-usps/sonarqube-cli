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

// MOCKUP ONLY — Approach E: status-first, single-action reconfigure flow (set-feature-set-per-scope). Not production code.

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

interface PendingChange {
  agent: string;
  scope: string;
  scopeIsGlobal: boolean;
  before: string[];
  after: string[];
}

interface ExistingScope {
  kind: 'existing';
  agent: string;
  install: FakeInstall;
}

interface NewScope {
  kind: 'new';
  agent: string;
  scopeIsGlobal: boolean;
  scopeLabel: string;
  availableFeatures: string[];
}

type ScopeChoice = ExistingScope | NewScope;

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

function renderStatusPanel(): void {
  print('');
  print(`${cyan('┌')} Current integrations`);
  print(cyan('└' + '─'.repeat(HEADER_WIDTH)));
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

function existingScopeOptions(): ExistingScope[] {
  const out: ExistingScope[] = [];
  for (const [agent, installs] of Object.entries(AGENTS)) {
    for (const install of installs) {
      out.push({ kind: 'existing', agent, install });
    }
  }
  return out;
}

function emptyScopeOptions(): NewScope[] {
  const out: NewScope[] = [];
  for (const [agent, installs] of Object.entries(AGENTS)) {
    const hasGlobal = installs.some((i) => i.scope === 'global');
    const hasCurrent = installs.some((i) => i.scope === 'project' && i.label === CURRENT_PROJECT);
    const unionFeatures = [...new Set(installs.flatMap((i) => i.availableFeatures))];
    if (!hasGlobal) {
      out.push({
        kind: 'new',
        agent,
        scopeIsGlobal: true,
        scopeLabel: 'Global',
        availableFeatures: unionFeatures,
      });
    }
    if (!hasCurrent) {
      out.push({
        kind: 'new',
        agent,
        scopeIsGlobal: false,
        scopeLabel: CURRENT_PROJECT,
        availableFeatures: unionFeatures,
      });
    }
  }
  return out;
}

async function pickScope(skipScopeKeys: Set<string>): Promise<ScopeChoice | 'new' | 'done' | null> {
  const existing = existingScopeOptions().filter((e) => !skipScopeKeys.has(scopeKey(e)));
  const hasEmpty = emptyScopeOptions().length > 0;

  if (existing.length === 0 && !hasEmpty) {
    print(`\n  ${dim('Nothing else to modify.')}`);
    return 'done';
  }

  type ScopeMenuValue = ScopeChoice | 'new' | 'done' | null;
  const options: { value: ScopeMenuValue; label: string }[] = existing.map((e) => ({
    value: e,
    label: `${e.agent} · ${scopeDisplay(e.install)}`,
  }));
  if (hasEmpty) {
    options.push({ value: 'new', label: '+ Install in a new scope…' });
  }
  options.push({ value: 'done', label: 'Done — review & apply' });
  options.push({ value: null, label: 'Cancel' });

  return selectPrompt<ScopeMenuValue>('Which scope to modify?', options);
}

async function pickNewScope(): Promise<NewScope | null> {
  const empty = emptyScopeOptions();
  if (empty.length === 0) return null;
  return selectPrompt<NewScope | null>('New install — which agent and scope?', [
    ...empty.map((c) => ({
      value: c,
      label: `${c.agent} · ${c.scopeIsGlobal ? 'Global' : `${c.scopeLabel}  (current project)`}`,
    })),
    { value: null, label: 'Cancel' },
  ]);
}

async function editScope(choice: ScopeChoice): Promise<PendingChange | null> {
  const agent = choice.agent;
  const scope = choice.kind === 'existing' ? shortScopeLabel(choice.install) : choice.scopeLabel;
  const scopeIsGlobal =
    choice.kind === 'existing' ? choice.install.scope === 'global' : choice.scopeIsGlobal;
  const available =
    choice.kind === 'existing' ? choice.install.availableFeatures : choice.availableFeatures;
  const before = choice.kind === 'existing' ? choice.install.installedFeatures : [];
  const isNew = choice.kind === 'new';

  const heading = isNew
    ? `Install ${agent} in ${scope === CURRENT_PROJECT ? `${scope}  (current project)` : scope}`
    : `${agent} · ${scope} — set installed features`;

  print('');
  const picked = await multiSelectWithInitial(
    heading,
    featureOptions(available),
    isNew ? [...available] : [...before],
  );
  if (picked === null) return null;

  // Same set? No-op.
  const sameSet = picked.length === before.length && picked.every((f) => before.includes(f));
  if (sameSet) return null;

  // Empty selection on existing install = uninstall this scope. Warn.
  if (!isNew && picked.length === 0) {
    print('');
    print(`  ${red('⚠')}  Removing all features will fully uninstall ${agent} from ${scope}.`);
    const confirm = await selectPrompt<boolean>('Continue?', [
      { value: true, label: 'Yes — uninstall this scope' },
      { value: false, label: 'Cancel' },
    ]);
    if (!confirm) return null;
  }

  return { agent, scope, scopeIsGlobal, before, after: picked };
}

function scopeKey(choice: ScopeChoice): string {
  const scopeLabel =
    choice.kind === 'existing' ? shortScopeLabel(choice.install) : choice.scopeLabel;
  return `${choice.agent}::${scopeLabel}`;
}

function scopeFlagFor(change: PendingChange): string {
  return change.scopeIsGlobal ? '--global' : `--project ${change.scope}`;
}

function equivalentCommand(change: PendingChange): string {
  const slug = cliSlug(change.agent);
  const scopeFlag = scopeFlagFor(change);
  if (change.after.length === 0) {
    return `sonar integrate ${slug} ${scopeFlag} --uninstall`;
  }
  return `sonar integrate ${slug} ${scopeFlag} --features ${change.after.join(',')} --non-interactive`;
}

function printDiff(change: PendingChange): void {
  const tag = dim(`[${change.agent} · ${change.scope}]`);
  const removed = change.before.filter((f) => !change.after.includes(f));
  const added = change.after.filter((f) => !change.before.includes(f));

  if (change.after.length === 0) {
    print(`  ${red('✗')}  ${tag} Uninstall (remove all features)`);
    for (const id of change.before) print(`       ${dim('−')} ${FEATURE_LABELS[id] ?? id}`);
  } else {
    if (removed.length > 0) {
      print(`  ${red('−')}  ${tag} Remove:`);
      for (const id of removed) print(`       ${FEATURE_LABELS[id] ?? id}`);
    }
    if (added.length > 0) {
      print(`  ${green('+')}  ${tag} Install:`);
      for (const id of added) print(`       ${FEATURE_LABELS[id] ?? id}`);
    }
  }
  if (SHOW_FLAG_HINTS) {
    print(`     ${dim('≡ ' + equivalentCommand(change))}`);
  }
  print('');
}

export async function runMockupE(): Promise<void> {
  renderStatusPanel();

  const pendingChanges: PendingChange[] = [];
  const editedKeys = new Set<string>();

  for (;;) {
    const pick = await pickScope(editedKeys);
    if (pick === null) {
      print(`\n  ${red('✗')}  Cancelled.`);
      return;
    }
    if (pick === 'done') break;

    let choice: ScopeChoice | null;
    if (pick === 'new') {
      choice = await pickNewScope();
    } else {
      choice = pick;
    }
    if (!choice) continue;

    const change = await editScope(choice);
    if (change) {
      pendingChanges.push(change);
      editedKeys.add(scopeKey(choice));
    }
  }

  print('');
  if (pendingChanges.length === 0) {
    print(`  ${green('✓')}  No changes.`);
    return;
  }

  print(`${cyan('┌')} Summary of changes`);
  print(cyan('└' + '─'.repeat(HEADER_WIDTH)));
  print('');
  for (const change of pendingChanges) printDiff(change);

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
