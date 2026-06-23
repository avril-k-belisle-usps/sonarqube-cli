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

// MOCKUP ONLY — Approach A: flat list across all agents and scopes. Not production code.

import { cyan, dim, green, red } from '../../../ui/colors.js';
import { selectPrompt } from '../../../ui/components/prompts.js';
import { print } from '../../../ui/messages.js';
import {
  FAKE_CLAUDE_INSTALLS,
  FAKE_CURSOR_INSTALLS,
  type FakeInstall,
  FEATURE_LABELS,
  type MockupOption,
  multiSelectWithInitial,
} from './shared.js';

const DIVIDER_WIDTH = 56;
const HEADER_WIDTH = 57;

function buildFlatList(
  agentLabel: string,
  installs: FakeInstall[],
): { options: MockupOption[]; initialSelected: string[] } {
  const options: MockupOption[] = [];
  const initialSelected: string[] = [];

  for (let i = 0; i < installs.length; i++) {
    const install = installs[i];
    const group = install.scope === 'global' ? 'Global' : install.label;
    const featureIds = install.availableFeatures.map((f) => `${agentLabel}::${group}::${f}`);

    if (i > 0) options.push({ id: `__blank__${agentLabel}${group}`, label: '', blank: true });

    const divider = `── ${agentLabel} · ${group} `;
    options.push({
      id: `__sep__${agentLabel}${group}`,
      label: divider.padEnd(DIVIDER_WIDTH, '─'),
      groupIds: featureIds,
    });

    for (const featureId of install.availableFeatures) {
      const id = `${agentLabel}::${group}::${featureId}`;
      const isInstalled = install.installedFeatures.includes(featureId);
      const featureLabel = FEATURE_LABELS[featureId] ?? featureId;
      const hint = isInstalled ? '' : '  (not installed)';
      options.push({ id, label: `    ${featureLabel}${hint}` });
      if (isInstalled) initialSelected.push(id);
    }
  }

  return { options, initialSelected };
}

const AGENTS: Record<string, FakeInstall[]> = {
  Cursor: FAKE_CURSOR_INSTALLS,
  Claude: FAKE_CLAUDE_INSTALLS,
};

export async function runMockupA(): Promise<void> {
  print('');
  print(`${cyan('┌')} Reconfigure integrations`);
  print(cyan('└' + '─'.repeat(HEADER_WIDTH)));
  print('');

  const agentChoice = await selectPrompt<string>(
    'Which integration do you want to reconfigure?',
    Object.keys(AGENTS).map((name) => ({ value: name, label: name })),
  );
  if (agentChoice === null) {
    print(`\n  ${red('✗')}  Cancelled.`);
    return;
  }

  const installs = AGENTS[agentChoice] ?? [];

  print('');
  print(`${cyan('│')} Checked = currently installed. Uncheck to remove, check to add.`);
  print(cyan('└' + '─'.repeat(HEADER_WIDTH)));
  print('');

  const { options, initialSelected } = buildFlatList(agentChoice, installs);

  const result = await multiSelectWithInitial(
    'Select features to keep installed:',
    options,
    initialSelected,
  );

  if (result === null) {
    print(`\n  ${red('✗')}  Cancelled.`);
    return;
  }

  const realSelected = result.filter((id) => !id.startsWith('__sep__'));
  const toRemove = initialSelected.filter((id) => !realSelected.includes(id));
  const toAdd = realSelected.filter((id) => !initialSelected.includes(id));

  print('');
  if (toRemove.length === 0 && toAdd.length === 0) {
    print(`  ${green('✓')}  No changes.`);
    return;
  }

  const formatId = (id: string): string => {
    const parts = id.split('::');
    const agent = parts[0] ?? '';
    const group = parts[1] ?? '';
    const featureId = parts[2] ?? '';
    const scope = dim(`[${agent} · ${group}]`);
    return `${scope} ${FEATURE_LABELS[featureId] ?? featureId}`;
  };

  if (toRemove.length > 0) {
    print(`  ${red('−')}  Would remove:`);
    for (const id of toRemove) print(`       ${formatId(id)}`);
  }
  if (toAdd.length > 0) {
    print(`  ${green('+')}  Would install:`);
    for (const id of toAdd) print(`       ${formatId(id)}`);
  }

  const confirm = await selectPrompt<boolean>('Apply these changes?', [
    { value: true, label: 'Yes, apply' },
    { value: false, label: 'Cancel' },
  ]);

  if (confirm) {
    print(`\n  ${green('✓')}  Done. (mockup — no real changes made)`);
  } else {
    print(`\n  ${red('✗')}  Cancelled.`);
  }
}
