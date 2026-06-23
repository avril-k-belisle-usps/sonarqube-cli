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

// MOCKUP ONLY — Approach F: the status panel IS the editor. Read-only view → press Enter → it becomes a grouped multi-select with tri-state checkboxes at the agent and scope levels. Not production code.

import { bold, cyan, dim, green, red } from '../../../ui/colors.js';
import { selectPrompt } from '../../../ui/components/prompts.js';
import { print } from '../../../ui/messages.js';
import { AGENTS, FEATURE_LABELS, type MockupOption, multiSelectWithInitial } from './shared.js';

const CURRENT_PROJECT = '~/source/repos/sonarqube-cli';
// Hide non-interactive flag hints in the summary. Flip to true to re-enable.
const SHOW_FLAG_HINTS = false as boolean;

const AGENT_CLI_SLUGS: Record<string, string> = {
  'Claude Code': 'claude',
  Claude: 'claude',
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
  toAdd: string[];
  toRemove: string[];
  uninstall: boolean;
}

function cliSlug(agent: string): string {
  return AGENT_CLI_SLUGS[agent] ?? agent.toLowerCase().replace(/\s+/g, '-');
}

function scopeDisplay(scopeLabel: string, isGlobal: boolean): string {
  if (isGlobal) return 'Global';
  if (scopeLabel === CURRENT_PROJECT) return `${scopeLabel}  (current project)`;
  return scopeLabel;
}

function featureNames(ids: string[]): string {
  return ids.map((id) => FEATURE_LABELS[id] ?? id).join(', ');
}

// ─── compound id: agent ‖ scopeLabel ‖ featureId ──────────────────────────────

const SEP = '‖';

function compoundId(agent: string, scopeLabel: string, featureId: string): string {
  return `${agent}${SEP}${scopeLabel}${SEP}${featureId}`;
}

function parseCompoundId(id: string): { agent: string; scopeLabel: string; featureId: string } {
  const [agent = '', scopeLabel = '', featureId = ''] = id.split(SEP);
  return { agent, scopeLabel, featureId };
}

// ─── read-only status panel ───────────────────────────────────────────────────

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
      print(`      ${dim(scopeDisplay(install.label, install.scope === 'global'))}`);
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

// ─── editor: same tree, now grouped multi-select ─────────────────────────────

interface EditorBuild {
  options: MockupOption[];
  initialSelected: string[];
}

function buildEditorOptions(): EditorBuild {
  const options: MockupOption[] = [];
  const initialSelected: string[] = [];
  const agentEntries = Object.entries(AGENTS);

  agentEntries.forEach(([agent, installs], agentIdx) => {
    if (installs.length === 0) return;

    const agentIds: string[] = [];
    for (const install of installs) {
      for (const f of install.availableFeatures) {
        agentIds.push(compoundId(agent, install.label, f));
      }
    }

    options.push({
      id: `agent::${agent}`,
      label: agent,
      groupIds: agentIds,
      accent: 'agent',
      indent: 0,
    });

    for (const install of installs) {
      const scopeLabel = scopeDisplay(install.label, install.scope === 'global');
      const scopeIds = install.availableFeatures.map((f) => compoundId(agent, install.label, f));
      options.push({
        id: `scope::${agent}::${install.label}`,
        label: scopeLabel,
        groupIds: scopeIds,
        accent: 'scope',
        indent: 2,
      });
      for (const f of install.availableFeatures) {
        const id = compoundId(agent, install.label, f);
        options.push({
          id,
          label: FEATURE_LABELS[f] ?? f,
          accent: 'feature',
          indent: 4,
        });
        if (install.installedFeatures.includes(f)) initialSelected.push(id);
      }
    }

    if (agentIdx < agentEntries.length - 1) {
      options.push({ id: `blank::${agent}`, label: '', blank: true });
    }
  });

  return { options, initialSelected };
}

// ─── diff: produce PendingChange[] from selection delta ──────────────────────

function diff(initial: string[], picked: string[]): PendingChange[] {
  type Bucket = {
    agent: string;
    scope: string;
    scopeIsGlobal: boolean;
    installedBefore: Set<string>;
    selectedAfter: Set<string>;
  };
  const buckets = new Map<string, Bucket>();

  function ensureBucket(agent: string, scopeLabel: string): Bucket {
    const key = `${agent}${SEP}${scopeLabel}`;
    let b = buckets.get(key);
    if (b) return b;
    const installs = AGENTS[agent] ?? [];
    const install = installs.find((i) => i.label === scopeLabel);
    const scopeIsGlobal = install?.scope === 'global';
    b = {
      agent,
      scope: scopeDisplay(scopeLabel, scopeIsGlobal),
      scopeIsGlobal,
      installedBefore: new Set(),
      selectedAfter: new Set(),
    };
    buckets.set(key, b);
    return b;
  }

  for (const id of initial) {
    const { agent, scopeLabel, featureId } = parseCompoundId(id);
    ensureBucket(agent, scopeLabel).installedBefore.add(featureId);
  }
  for (const id of picked) {
    const { agent, scopeLabel, featureId } = parseCompoundId(id);
    ensureBucket(agent, scopeLabel).selectedAfter.add(featureId);
  }

  const changes: PendingChange[] = [];
  for (const b of buckets.values()) {
    const toAdd = [...b.selectedAfter].filter((f) => !b.installedBefore.has(f));
    const toRemove = [...b.installedBefore].filter((f) => !b.selectedAfter.has(f));
    if (toAdd.length === 0 && toRemove.length === 0) continue;
    const uninstall = b.installedBefore.size > 0 && b.selectedAfter.size === 0;
    changes.push({
      agent: b.agent,
      scope: b.scope,
      scopeIsGlobal: b.scopeIsGlobal,
      toAdd,
      toRemove,
      uninstall,
    });
  }
  return changes;
}

// ─── summary ─────────────────────────────────────────────────────────────────

function scopeFlagFor(change: PendingChange): string {
  if (change.scopeIsGlobal) return '--global';
  const rawProject = change.scope.replace(/\s+\(current project\)$/, '');
  return `--project ${rawProject}`;
}

function buildEquivalentCommand(change: PendingChange): string {
  const slug = cliSlug(change.agent);
  const scopeFlag = scopeFlagFor(change);
  if (change.uninstall) return `sonar integrate ${slug} ${scopeFlag} --uninstall`;
  const parts = [`sonar integrate ${slug}`, scopeFlag];
  if (change.toAdd.length > 0) parts.push(`--add ${change.toAdd.join(',')}`);
  if (change.toRemove.length > 0) parts.push(`--remove ${change.toRemove.join(',')}`);
  return parts.join(' ');
}

function printSummary(changes: PendingChange[]): void {
  for (const change of changes) {
    const tag = dim(`[${change.agent} · ${change.scope}]`);
    if (change.uninstall) {
      print(`  ${red('✗')}  ${tag} Uninstall (remove all features and integration files)`);
    } else {
      if (change.toRemove.length > 0) {
        print(`  ${red('−')}  ${tag} Remove: ${featureNames(change.toRemove)}`);
      }
      if (change.toAdd.length > 0) {
        print(`  ${green('+')}  ${tag} Install: ${featureNames(change.toAdd)}`);
      }
    }
    if (SHOW_FLAG_HINTS) {
      print(`     ${dim('≡ ' + buildEquivalentCommand(change))}`);
    }
    print('');
  }
}

// ─── main entry ──────────────────────────────────────────────────────────────

export async function runMockupF(): Promise<void> {
  renderStatusPanel();

  const ack = await selectPrompt<boolean | null>('Edit integrations?', [
    { value: true, label: 'Edit — the panel above becomes editable' },
    { value: false, label: 'Quit' },
  ]);
  if (!ack) return;

  print('');
  print(`  ${bold('Edit integrations')}  ${dim('— check to install, uncheck to remove')}`);
  print(`  ${dim('Cursor on an agent or scope row toggles everything beneath it.')}`);
  print('');

  const { options, initialSelected } = buildEditorOptions();
  const picked = await multiSelectWithInitial(
    'Toggle features (Space to toggle, Enter to confirm)',
    options,
    initialSelected,
    { checkboxStyle: 'square' },
  );
  if (picked === null) {
    print(`\n  ${red('✗')}  Cancelled.`);
    return;
  }

  const changes = diff(initialSelected, picked);
  print('');
  if (changes.length === 0) {
    print(`  ${green('✓')}  No changes.`);
    return;
  }

  // Warn before applying any full-scope uninstalls.
  const uninstalls = changes.filter((c) => c.uninstall);
  if (uninstalls.length > 0) {
    print(`  ${red('⚠')}  Pending full uninstalls (${uninstalls.length}):`);
    for (const u of uninstalls) print(`       ${u.agent} · ${u.scope}`);
    print('');
  }

  print(`  ${bold('Summary of changes')}`);
  print('');
  printSummary(changes);

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
