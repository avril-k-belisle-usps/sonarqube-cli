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

// MOCKUP ONLY — shared fake data and helpers. Not production code.

import { isCancel, Prompt } from '@clack/core';

import { bold, cyan, dim, green, red, yellow } from '../../../ui/colors.js';

export const FEATURE_LABELS: Record<string, string> = {
  'sonar-secrets-hooks': 'Secrets scanning hooks',
  'sqaa-instructions': 'Agentic analysis',
  'mcp-server': 'MCP server',
  'context-augmentation': 'Context augmentation',
};

// Static catalog of features an agent supports per scope kind. Used when no install
// exists yet (e.g. brand-new agent integration) and we still need to know what can be set up.
export const AGENT_FEATURE_CATALOG: Record<string, { global: string[]; project: string[] }> = {
  Cursor: {
    global: ['sonar-secrets-hooks', 'mcp-server', 'context-augmentation'],
    project: ['sonar-secrets-hooks', 'sqaa-instructions', 'mcp-server', 'context-augmentation'],
  },
  Claude: {
    global: ['sonar-secrets-hooks', 'mcp-server', 'context-augmentation'],
    project: ['sonar-secrets-hooks', 'sqaa-instructions', 'mcp-server', 'context-augmentation'],
  },
  Copilot: {
    global: ['sonar-secrets-hooks', 'mcp-server', 'context-augmentation'],
    project: ['sonar-secrets-hooks', 'sqaa-instructions', 'mcp-server', 'context-augmentation'],
  },
};

export interface FakeInstall {
  scope: 'global' | 'project';
  label: string;
  installedFeatures: string[];
  availableFeatures: string[];
}

// Cursor: 1 global + 3 project installs — simulates a "quite long" flat list
export const FAKE_CURSOR_INSTALLS: FakeInstall[] = [
  {
    scope: 'global',
    label: 'Global',
    installedFeatures: ['sonar-secrets-hooks', 'mcp-server'],
    availableFeatures: ['sonar-secrets-hooks', 'mcp-server', 'context-augmentation'],
    // sqaa-instructions is project-only
  },
  {
    scope: 'project',
    label: '~/source/repos/sonarqube-cli',
    installedFeatures: [
      'sonar-secrets-hooks',
      'sqaa-instructions',
      'mcp-server',
      'context-augmentation',
    ],
    availableFeatures: [
      'sonar-secrets-hooks',
      'sqaa-instructions',
      'mcp-server',
      'context-augmentation',
    ],
  },
  {
    scope: 'project',
    label: '~/source/repos/sonarlint-core',
    installedFeatures: ['sqaa-instructions', 'mcp-server', 'context-augmentation'],
    availableFeatures: [
      'sonar-secrets-hooks',
      'sqaa-instructions',
      'mcp-server',
      'context-augmentation',
    ],
  },
  {
    scope: 'project',
    label: '~/source/repos/sonarqube-core',
    installedFeatures: ['sonar-secrets-hooks', 'mcp-server'],
    availableFeatures: [
      'sonar-secrets-hooks',
      'sqaa-instructions',
      'mcp-server',
      'context-augmentation',
    ],
  },
];

// Claude: 1 global + 1 project — included in Mockup A to show multi-agent length
export const FAKE_CLAUDE_INSTALLS: FakeInstall[] = [
  {
    scope: 'global',
    label: 'Global',
    installedFeatures: ['sonar-secrets-hooks'],
    availableFeatures: ['sonar-secrets-hooks', 'mcp-server', 'context-augmentation'],
  },
  {
    scope: 'project',
    label: '~/source/repos/sonarqube-cli',
    installedFeatures: ['sonar-secrets-hooks', 'sqaa-instructions', 'context-augmentation'],
    availableFeatures: [
      'sonar-secrets-hooks',
      'sqaa-instructions',
      'mcp-server',
      'context-augmentation',
    ],
  },
];

export interface MockupOption {
  id: string;
  label: string;
  /** If set, this is a group header: toggling selects/deselects all these IDs. */
  groupIds?: string[];
  /** If true, rendered as a blank spacer line — not selectable. */
  blank?: boolean;
  /** Extra leading spaces before the checkbox, for hierarchical indentation. */
  indent?: number;
  /** Per-row color scheme. When set, non-cursor rows keep their accent (no wholesale dim). */
  accent?: 'agent' | 'scope' | 'feature';
}

export interface MultiSelectOpts {
  /** Checkbox glyph style. Default 'circle' (◉◐◯); 'square' uses [✓] / [~] / [ ]. */
  checkboxStyle?: 'circle' | 'square';
}

// Copilot: not yet integrated anywhere — demoes the "+ Install in a new scope" path.
export const FAKE_COPILOT_INSTALLS: FakeInstall[] = [];

export const AGENTS: Record<string, FakeInstall[]> = {
  Cursor: FAKE_CURSOR_INSTALLS,
  Claude: FAKE_CLAUDE_INSTALLS,
  Copilot: FAKE_COPILOT_INSTALLS,
};

function checkboxGlyph(style: 'circle' | 'square', state: 'full' | 'partial' | 'empty'): string {
  if (style === 'square') {
    if (state === 'full') return green('◼');
    if (state === 'partial') return yellow('▣');
    return dim('◻');
  }
  if (state === 'full') return cyan('◉');
  if (state === 'partial') return cyan('◐');
  return '◯';
}

function groupCheckbox(
  groupIds: string[],
  selected: string[],
  style: 'circle' | 'square' = 'circle',
): string {
  const total = groupIds.length;
  const count = groupIds.filter((id) => selected.includes(id)).length;
  if (count === total) return checkboxGlyph(style, 'full');
  if (count > 0) return checkboxGlyph(style, 'partial');
  return checkboxGlyph(style, 'empty');
}

function styledLabel(opt: MockupOption, isCursor: boolean, isSelected: boolean): string {
  if (opt.accent) {
    if (opt.accent === 'agent') {
      return isCursor ? bold(cyan(opt.label)) : cyan(opt.label);
    }
    if (opt.accent === 'scope') {
      return isCursor ? bold(opt.label) : dim(opt.label);
    }
    // 'feature' — dim when unchecked so installed vs available reads at a glance
    if (isSelected) return isCursor ? bold(opt.label) : opt.label;
    return isCursor ? bold(dim(opt.label)) : dim(opt.label);
  }
  return isCursor ? opt.label : dim(opt.label);
}

function toggleGroup(groupIds: string[], selected: string[]): void {
  const allSelected = groupIds.every((id) => selected.includes(id));
  for (const id of groupIds) {
    const idx = selected.indexOf(id);
    if (allSelected && idx >= 0) selected.splice(idx, 1);
    else if (!allSelected && idx < 0) selected.push(id);
  }
}

// Multi-select that starts with pre-selected items (production multiSelectPrompt always starts empty).
export async function multiSelectWithInitial(
  message: string,
  options: MockupOption[],
  initialSelected: string[],
  opts: MultiSelectOpts = {},
): Promise<string[] | null> {
  const style = opts.checkboxStyle ?? 'circle';
  const selected: string[] = [...initialSelected];
  let cursor = 0;

  const prompt = new Prompt<string[]>(
    {
      render() {
        if (this.state === 'submit') {
          const countLabel = dim(`${selected.length} selected`);
          return `  ${green('✓')}  ${message} ${countLabel}`;
        }
        if (this.state === 'cancel') {
          return `  ${red('✗')}  ${message}`;
        }

        const lines = [
          `  ${cyan('?')}  ${message}  ${dim('(Space to toggle, Enter to confirm, q to quit)')}`,
        ];

        for (let i = 0; i < options.length; i++) {
          const opt = options[i];
          if (opt.blank) {
            lines.push('');
            continue;
          }
          const isCursor = i === cursor;
          const isSelected = selected.includes(opt.id);
          const cb = opt.groupIds
            ? groupCheckbox(opt.groupIds, selected, style)
            : checkboxGlyph(style, isSelected ? 'full' : 'empty');
          const arrow = isCursor ? cyan('❯') : ' ';
          const indent = ' '.repeat(opt.indent ?? 0);
          const label = styledLabel(opt, isCursor, isSelected);
          lines.push(`    ${arrow} ${indent}${cb}  ${label}`);
        }

        return lines.join('\n');
      },
    },
    false,
  );

  const moveUp = (): void => {
    let next = cursor - 1;
    while (next > 0 && options[next]?.blank) next--;
    cursor = Math.max(0, next);
  };

  const moveDown = (): void => {
    let next = cursor + 1;
    while (next < options.length - 1 && options[next]?.blank) next++;
    cursor = Math.min(options.length - 1, next);
  };

  const toggleCurrent = (): void => {
    const opt = options[cursor];
    if (!opt) return;
    if (opt.groupIds) {
      toggleGroup(opt.groupIds, selected);
    } else {
      const idx = selected.indexOf(opt.id);
      if (idx >= 0) selected.splice(idx, 1);
      else selected.push(opt.id);
    }
  };

  prompt.on('cursor', (dir) => {
    if (dir === 'up') moveUp();
    else if (dir === 'down') moveDown();
    else if (dir === 'space') toggleCurrent();
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
