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

// MOCKUP ONLY — Approach F2: F with collapsible agents and scopes. Agents start collapsed; →/← expand/collapse. Not production code.

import { isCancel, Prompt } from '@clack/core';

import { bold, cyan, dim, green, red, yellow } from '../../../ui/colors.js';
import { selectPrompt } from '../../../ui/components/prompts.js';
import { print } from '../../../ui/messages.js';
import { AGENTS, FEATURE_LABELS } from './shared.js';

const CURRENT_PROJECT = '~/source/repos/sonarqube-cli';
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

// ─── tree nodes ───────────────────────────────────────────────────────────────

type NodeKind = 'agent' | 'scope' | 'feature';
interface Node {
  id: string;
  kind: NodeKind;
  agent: string;
  scopeLabel?: string;
  featureId?: string;
  scopeIsGlobal?: boolean;
  label: string;
  indent: number;
  leafIds: string[];
  parentId?: string;
  isLeaf: boolean;
}

const SEP = '‖';
const cid = (agent: string, scope: string, feature: string): string =>
  `${agent}${SEP}${scope}${SEP}${feature}`;

function scopeDisplay(scopeLabel: string, isGlobal: boolean): string {
  if (isGlobal) return 'Global';
  if (scopeLabel === CURRENT_PROJECT) return `${scopeLabel}  (current project)`;
  return scopeLabel;
}

function cliSlug(agent: string): string {
  return AGENT_CLI_SLUGS[agent] ?? agent.toLowerCase().replace(/\s+/g, '-');
}

function featureNames(ids: string[]): string {
  return ids.map((id) => FEATURE_LABELS[id] ?? id).join(', ');
}

function buildTree(): { nodes: Node[]; initialSelected: string[] } {
  const nodes: Node[] = [];
  const initialSelected: string[] = [];

  for (const [agent, installs] of Object.entries(AGENTS)) {
    if (installs.length === 0) continue;

    const agentLeafIds: string[] = [];
    const agentNodeId = `agent::${agent}`;
    const scopeNodes: Node[] = [];

    for (const install of installs) {
      const scopeLabel = install.label;
      const scopeIsGlobal = install.scope === 'global';
      const scopeNodeId = `scope::${agent}::${scopeLabel}`;
      const scopeLeafIds: string[] = [];
      const featureNodes: Node[] = [];

      for (const f of install.availableFeatures) {
        const id = cid(agent, scopeLabel, f);
        agentLeafIds.push(id);
        scopeLeafIds.push(id);
        featureNodes.push({
          id,
          kind: 'feature',
          agent,
          scopeLabel,
          featureId: f,
          scopeIsGlobal,
          label: FEATURE_LABELS[f] ?? f,
          indent: 4,
          leafIds: [id],
          parentId: scopeNodeId,
          isLeaf: true,
        });
        if (install.installedFeatures.includes(f)) initialSelected.push(id);
      }

      scopeNodes.push({
        id: scopeNodeId,
        kind: 'scope',
        agent,
        scopeLabel,
        scopeIsGlobal,
        label: scopeDisplay(scopeLabel, scopeIsGlobal),
        indent: 2,
        leafIds: scopeLeafIds,
        parentId: agentNodeId,
        isLeaf: false,
      });
      scopeNodes.push(...featureNodes);
    }

    nodes.push({
      id: agentNodeId,
      kind: 'agent',
      agent,
      label: agent,
      indent: 0,
      leafIds: agentLeafIds,
      isLeaf: false,
    });
    nodes.push(...scopeNodes);
  }

  return { nodes, initialSelected };
}

// ─── checkboxes ──────────────────────────────────────────────────────────────

function checkbox(state: 'full' | 'partial' | 'empty'): string {
  if (state === 'full') return green('◼');
  if (state === 'partial') return yellow('▣');
  return dim('◻');
}

function nodeCheckbox(node: Node, selected: string[]): string {
  if (node.isLeaf) {
    return checkbox(selected.includes(node.id) ? 'full' : 'empty');
  }
  const total = node.leafIds.length;
  const count = node.leafIds.filter((id) => selected.includes(id)).length;
  if (count === total) return checkbox('full');
  if (count > 0) return checkbox('partial');
  return checkbox('empty');
}

function nodeChildCount(node: Node, selected: string[]): { count: number; total: number } {
  const total = node.leafIds.length;
  const count = node.leafIds.filter((id) => selected.includes(id)).length;
  return { count, total };
}

// ─── label styling ───────────────────────────────────────────────────────────

function styledLabel(node: Node, isCursor: boolean, selected: string[]): string {
  if (node.kind === 'agent') {
    return isCursor ? bold(cyan(node.label)) : cyan(node.label);
  }
  if (node.kind === 'scope') {
    return isCursor ? bold(node.label) : dim(node.label);
  }
  // feature: dim when unchecked
  const isSelected = selected.includes(node.id);
  if (isSelected) return isCursor ? bold(node.label) : node.label;
  return isCursor ? bold(dim(node.label)) : dim(node.label);
}

function expandHint(node: Node, expanded: Set<string>, selected: string[]): string {
  if (node.isLeaf) return ' ';
  const open = expanded.has(node.id);
  if (open) return dim('▾');
  const { count, total } = nodeChildCount(node, selected);
  // Show installed/total count when collapsed so the user sees state at a glance.
  return `${dim('▸')} ${dim(`(${count}/${total})`)}`;
}

// ─── visibility ──────────────────────────────────────────────────────────────

function isNodeVisible(node: Node, expanded: Set<string>): boolean {
  if (node.kind === 'agent') return true;
  if (node.kind === 'scope') return expanded.has(node.parentId ?? '');
  // feature
  return expanded.has(node.parentId ?? '');
}

// ─── prompt ──────────────────────────────────────────────────────────────────

async function runTreePrompt(
  message: string,
  nodes: Node[],
  initialSelected: string[],
): Promise<string[] | null> {
  const selected: string[] = [...initialSelected];
  const expanded = new Set<string>();
  let cursor = 0;

  const visible = (): Node[] => nodes.filter((n) => isNodeVisible(n, expanded));

  const ensureCursor = (): void => {
    const v = visible();
    cursor = Math.max(0, Math.min(cursor, v.length - 1));
  };

  const moveUp = (): void => {
    cursor = Math.max(0, cursor - 1);
  };
  const moveDown = (): void => {
    cursor = Math.min(visible().length - 1, cursor + 1);
  };

  const expand = (): void => {
    const node = visible()[cursor];
    if (node.isLeaf) return;
    if (!expanded.has(node.id)) expanded.add(node.id);
  };

  const collapse = (): void => {
    const v = visible();
    const node = v[cursor];
    if (node.isLeaf) {
      if (!node.parentId) return;
      expanded.delete(node.parentId);
      cursor = v.findIndex((n) => n.id === node.parentId);
      ensureCursor();
      return;
    }
    if (expanded.has(node.id)) {
      expanded.delete(node.id);
      return;
    }
    if (node.parentId) {
      expanded.delete(node.parentId);
      cursor = v.findIndex((n) => n.id === node.parentId);
      ensureCursor();
    }
  };

  const toggleCurrent = (): void => {
    const node = visible()[cursor];
    const allSelected = node.leafIds.every((id) => selected.includes(id));
    for (const id of node.leafIds) {
      const idx = selected.indexOf(id);
      if (allSelected && idx >= 0) selected.splice(idx, 1);
      else if (!allSelected && idx < 0) selected.push(id);
    }
  };

  const prompt = new Prompt<string[]>(
    {
      render() {
        if (this.state === 'submit') {
          return `  ${green('✓')}  ${message} ${dim(`${selected.length} selected`)}`;
        }
        if (this.state === 'cancel') {
          return `  ${red('✗')}  ${message}`;
        }

        const lines = [
          `  ${cyan('?')}  ${message}`,
          `     ${dim('Space toggle • →/← expand/collapse • Enter confirm • q quit')}`,
          '',
        ];

        const v = visible();
        for (let i = 0; i < v.length; i++) {
          const node = v[i];
          const isCursor = i === cursor;
          const arrow = isCursor ? cyan('❯') : ' ';
          const indent = ' '.repeat(node.indent);
          const cb = nodeCheckbox(node, selected);
          const label = styledLabel(node, isCursor, selected);
          const hint = expandHint(node, expanded, selected);
          lines.push(`    ${arrow} ${indent}${cb}  ${label}${node.isLeaf ? '' : '  ' + hint}`);
        }

        return lines.join('\n');
      },
    },
    false,
  );

  prompt.on('cursor', (dir) => {
    if (dir === 'up') moveUp();
    else if (dir === 'down') moveDown();
    else if (dir === 'space') toggleCurrent();
    else if (dir === 'right') expand();
    else if (dir === 'left') collapse();
  });

  prompt.on('key', (_key, s) => {
    if (s.name === 'return') {
      prompt.value = [...selected];
    } else if (s.name === 'q') {
      prompt.state = 'cancel';
    }
  });

  const result = await prompt.prompt();
  if (isCancel(result)) return null;
  return result ?? [];
}

// ─── status panel (collapsed default view, mirrors the editor's first frame) ─

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

// ─── diff + summary ──────────────────────────────────────────────────────────

function diff(nodes: Node[], initial: string[], picked: string[]): PendingChange[] {
  const initialSet = new Set(initial);
  const pickedSet = new Set(picked);
  const byScope = new Map<string, PendingChange>();

  for (const node of nodes) {
    if (!node.isLeaf || !node.featureId || !node.scopeLabel) continue;
    const was = initialSet.has(node.id);
    const is = pickedSet.has(node.id);
    if (was === is) continue;

    const key = `${node.agent}${SEP}${node.scopeLabel}`;
    let change = byScope.get(key);
    if (!change) {
      change = {
        agent: node.agent,
        scope: scopeDisplay(node.scopeLabel, node.scopeIsGlobal ?? false),
        scopeIsGlobal: node.scopeIsGlobal ?? false,
        toAdd: [],
        toRemove: [],
        uninstall: false,
      };
      byScope.set(key, change);
    }
    if (is) change.toAdd.push(node.featureId);
    else change.toRemove.push(node.featureId);
  }

  // Mark full uninstalls.
  for (const [key, change] of byScope.entries()) {
    const [agent, scopeLabel] = key.split(SEP);
    const allLeavesForScope = nodes.filter(
      (n) => n.isLeaf && n.agent === agent && n.scopeLabel === scopeLabel,
    );
    const initiallyInstalledHere = allLeavesForScope
      .filter((n) => initialSet.has(n.id))
      .map((n) => n.featureId ?? '');
    const finallyInstalledHere = allLeavesForScope.filter((n) => pickedSet.has(n.id));
    if (initiallyInstalledHere.length > 0 && finallyInstalledHere.length === 0) {
      change.uninstall = true;
    }
  }

  return [...byScope.values()];
}

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

export async function runMockupF2(): Promise<void> {
  renderStatusPanel();

  const ack = await selectPrompt<boolean | null>('Edit integrations?', [
    { value: true, label: 'Edit — collapsed view, →/← to expand/collapse' },
    { value: false, label: 'Quit' },
  ]);
  if (!ack) return;

  print('');
  print(
    `  ${bold('Edit integrations')}  ${dim('— agents start collapsed; expand to see scopes / features')}`,
  );
  print('');

  const { nodes, initialSelected } = buildTree();
  const picked = await runTreePrompt(
    'Toggle features (Space) — expand with →, collapse with ←',
    nodes,
    initialSelected,
  );
  if (picked === null) {
    print(`\n  ${red('✗')}  Cancelled.`);
    return;
  }

  const changes = diff(nodes, initialSelected, picked);
  print('');
  if (changes.length === 0) {
    print(`  ${green('✓')}  No changes.`);
    return;
  }

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
