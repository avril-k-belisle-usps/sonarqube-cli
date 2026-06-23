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

// MOCKUP ONLY — Approach F3: F2 with Enter-only interactions. Enter expands/collapses groups, toggles features, and triggers Apply/Cancel rows at the bottom. Space is a hidden power-user shortcut for batch-toggling a whole group. Not production code.

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

// ─── tree nodes ──────────────────────────────────────────────────────────────

type NodeKind = 'agent' | 'scope' | 'feature' | 'apply' | 'cancel' | 'separator';
interface Node {
  id: string;
  kind: NodeKind;
  agent?: string;
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
    const subNodes: Node[] = [];

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

      subNodes.push({
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
      subNodes.push(...featureNodes);
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
    nodes.push(...subNodes);
  }

  // Action rows at the bottom.
  nodes.push({
    id: 'separator::actions',
    kind: 'separator',
    label: '',
    indent: 0,
    leafIds: [],
    isLeaf: true,
  });
  nodes.push({
    id: 'action::apply',
    kind: 'apply',
    label: 'Apply changes',
    indent: 0,
    leafIds: [],
    isLeaf: true,
  });
  nodes.push({
    id: 'action::cancel',
    kind: 'cancel',
    label: 'Cancel',
    indent: 0,
    leafIds: [],
    isLeaf: true,
  });

  return { nodes, initialSelected };
}

// ─── checkboxes ──────────────────────────────────────────────────────────────

function checkbox(state: 'full' | 'partial' | 'empty'): string {
  if (state === 'full') return green('◼');
  if (state === 'partial') return yellow('▣');
  return dim('◻');
}

function nodeCheckbox(node: Node, selected: string[]): string {
  if (node.kind === 'feature') {
    return checkbox(selected.includes(node.id) ? 'full' : 'empty');
  }
  if (node.kind === 'agent' || node.kind === 'scope') {
    const total = node.leafIds.length;
    const count = node.leafIds.filter((id) => selected.includes(id)).length;
    if (count === total) return checkbox('full');
    if (count > 0) return checkbox('partial');
    return checkbox('empty');
  }
  return ' ';
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
  if (node.kind === 'feature') {
    const isSelected = selected.includes(node.id);
    if (isSelected) return isCursor ? bold(node.label) : node.label;
    return isCursor ? bold(dim(node.label)) : dim(node.label);
  }
  if (node.kind === 'apply') {
    return isCursor ? bold(green(node.label)) : green(node.label);
  }
  if (node.kind === 'cancel') {
    return isCursor ? bold(red(node.label)) : red(node.label);
  }
  return node.label;
}

function expandHint(node: Node, expanded: Set<string>, selected: string[]): string {
  if (node.kind !== 'agent' && node.kind !== 'scope') return '';
  const open = expanded.has(node.id);
  if (open) return dim('▾');
  const { count, total } = nodeChildCount(node, selected);
  return `${dim('▸')} ${dim(`(${count}/${total})`)}`;
}

// ─── visibility ──────────────────────────────────────────────────────────────

function isNodeVisible(node: Node, expanded: Set<string>): boolean {
  if (node.kind === 'agent') return true;
  if (node.kind === 'scope') return expanded.has(node.parentId ?? '');
  if (node.kind === 'feature') return expanded.has(node.parentId ?? '');
  // separators and action rows always visible
  return true;
}

// ─── prompt ──────────────────────────────────────────────────────────────────

type SubmitResult = { kind: 'apply'; picked: string[] } | { kind: 'cancel' };

async function runTreePrompt(
  message: string,
  nodes: Node[],
  initialSelected: string[],
): Promise<SubmitResult> {
  const selected: string[] = [...initialSelected];
  const expanded = new Set<string>();
  let cursor = 0;

  const visible = (): Node[] => nodes.filter((n) => isNodeVisible(n, expanded));

  const moveUp = (): void => {
    const v = visible();
    let next = cursor - 1;
    while (next > 0 && v[next]?.kind === 'separator') next--;
    cursor = Math.max(0, next);
  };
  const moveDown = (): void => {
    const v = visible();
    let next = cursor + 1;
    while (next < v.length - 1 && v[next]?.kind === 'separator') next++;
    cursor = Math.min(v.length - 1, next);
  };

  const activate = (): void => {
    const v = visible();
    const node = v[cursor];
    if (node.kind === 'apply') {
      prompt.value = [...selected];
      return;
    }
    if (node.kind === 'cancel') {
      prompt.state = 'cancel';
      return;
    }
    if (node.kind === 'feature') {
      const idx = selected.indexOf(node.id);
      if (idx >= 0) selected.splice(idx, 1);
      else selected.push(node.id);
      return;
    }
    if (node.kind === 'agent' || node.kind === 'scope') {
      if (expanded.has(node.id)) expanded.delete(node.id);
      else expanded.add(node.id);
    }
  };

  // Hidden power-user batch toggle: Space on a group row toggles all leaves.
  const groupBatchToggle = (): void => {
    const node = visible()[cursor];
    if (node.kind !== 'agent' && node.kind !== 'scope') return;
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
          return `  ${green('✓')}  ${message}`;
        }
        if (this.state === 'cancel') {
          return `  ${red('✗')}  ${message}`;
        }

        const lines = [
          `  ${cyan('?')}  ${message}`,
          `     ${dim('Enter to expand / toggle / apply  •  ↑↓ to move  •  q to quit')}`,
          '',
        ];

        const v = visible();
        for (let i = 0; i < v.length; i++) {
          const node = v[i];
          if (node.kind === 'separator') {
            lines.push('');
            continue;
          }
          const isCursor = i === cursor;
          const arrow = isCursor ? cyan('❯') : ' ';
          const indent = ' '.repeat(node.indent);
          const cb = nodeCheckbox(node, selected);
          const label = styledLabel(node, isCursor, selected);
          const hint = expandHint(node, expanded, selected);
          const suffix = hint ? '  ' + hint : '';
          if (node.kind === 'apply' || node.kind === 'cancel') {
            const glyph = node.kind === 'apply' ? green('▶') : red('✗');
            lines.push(`    ${arrow} ${indent}${glyph}  ${label}`);
            continue;
          }
          lines.push(`    ${arrow} ${indent}${cb}  ${label}${suffix}`);
        }

        return lines.join('\n');
      },
    },
    false,
  );

  prompt.on('cursor', (dir) => {
    if (dir === 'up') moveUp();
    else if (dir === 'down') moveDown();
    else if (dir === 'space') groupBatchToggle();
  });

  prompt.on('key', (_key, s) => {
    if (s.name === 'return') {
      activate();
    } else if (s.name === 'q') {
      prompt.state = 'cancel';
    }
  });

  const result = await prompt.prompt();
  if (isCancel(result)) return { kind: 'cancel' };
  return { kind: 'apply', picked: result ?? [] };
}

// ─── status panel ────────────────────────────────────────────────────────────

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
    if (node.kind !== 'feature') continue;
    if (!node.featureId || !node.scopeLabel || !node.agent) continue;
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

  for (const [key, change] of byScope.entries()) {
    const [agent, scopeLabel] = key.split(SEP);
    const allLeavesForScope = nodes.filter(
      (n) => n.kind === 'feature' && n.agent === agent && n.scopeLabel === scopeLabel,
    );
    const initiallyInstalledHere = allLeavesForScope.filter((n) => initialSet.has(n.id));
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

export async function runMockupF3(): Promise<void> {
  renderStatusPanel();

  const ack = await selectPrompt<boolean | null>('Edit integrations?', [
    { value: true, label: 'Edit — Enter on each row to expand or toggle' },
    { value: false, label: 'Quit' },
  ]);
  if (!ack) return;

  print('');
  print(`  ${bold('Edit integrations')}  ${dim('— navigate with ↑↓, press Enter on each row')}`);
  print('');

  const { nodes, initialSelected } = buildTree();
  const result = await runTreePrompt(
    'Toggle features — Enter to expand, toggle, or apply',
    nodes,
    initialSelected,
  );

  if (result.kind === 'cancel') {
    print(`\n  ${red('✗')}  Cancelled.`);
    return;
  }

  const changes = diff(nodes, initialSelected, result.picked);
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
