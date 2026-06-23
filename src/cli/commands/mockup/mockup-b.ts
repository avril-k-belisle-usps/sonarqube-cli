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

// MOCKUP ONLY — Approach B: scope-first flow. Not production code.

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
const ALREADY = dim(' (already integrated)');

function buildScopeOptions(installs: FakeInstall[]): { value: string; label: string }[] {
  const globalInstall = installs.find((i) => i.scope === 'global');
  const currentInstall = installs.find((i) => i.scope === 'project' && i.label === CURRENT_PROJECT);
  const otherInstalls = installs.filter(
    (i) => i.scope === 'project' && i.label !== CURRENT_PROJECT,
  );

  return [
    {
      value: 'Global',
      label: `Global (user home — applies across projects)${globalInstall ? ALREADY : ''}`,
    },
    {
      value: CURRENT_PROJECT,
      label: `${CURRENT_PROJECT} — current project${currentInstall ? ALREADY : ''}`,
    },
    ...otherInstalls.map((i) => ({ value: i.label, label: `${i.label}${ALREADY}` })),
  ];
}

function resolveInstall(installs: FakeInstall[], scopeChoice: string): FakeInstall | undefined {
  return scopeChoice === 'Global'
    ? installs.find((i) => i.scope === 'global')
    : installs.find((i) => i.label === scopeChoice);
}

function printDiff(
  toRemove: string[],
  toAdd: string[],
  install: FakeInstall,
  agentName: string,
  scopeChoice: string,
): void {
  if (toRemove.length > 0) {
    print(`  ${red('−')}  Would remove:`);
    for (const id of toRemove) print(`       ${FEATURE_LABELS[id] ?? id}`);
  }
  if (toAdd.length > 0) {
    print(`  ${green('+')}  Would install:`);
    for (const id of toAdd) print(`       ${FEATURE_LABELS[id] ?? id}`);
  }

  const scopeFlag = install.scope === 'global' ? '--global' : `--project "${scopeChoice}"`;
  const kept = install.installedFeatures.filter((id) => !toRemove.includes(id));
  const featureFlags = [...toAdd, ...kept].map((id) => `--feature ${id}`).join(' ');
  const agentCmd = agentName.toLowerCase();
  const equivalentCmd = `sonar integrate ${agentCmd} ${scopeFlag} ${featureFlags}`;
  print('');
  print(`  ${dim('Equivalent non-interactive command:')}`);
  print(`  ${cyan(equivalentCmd)}`);
}

export async function runMockupB(): Promise<void> {
  print('');
  print(`${cyan('┌')} sonar integrate`);
  print(cyan('└' + '─'.repeat(HEADER_WIDTH)));
  print('');

  const agentChoice = await selectPrompt<string>(
    'Which integration do you want to configure?',
    Object.keys(AGENTS).map((name) => ({ value: name, label: name })),
  );
  if (agentChoice === null) {
    print(`\n  ${red('✗')}  Cancelled.`);
    return;
  }

  const installs = AGENTS[agentChoice] ?? [];

  print('');
  const scopeChoice = await selectPrompt<string>(
    `Where do you want to configure ${agentChoice}?`,
    buildScopeOptions(installs),
  );
  if (scopeChoice === null) {
    print(`\n  ${red('✗')}  Cancelled.`);
    return;
  }

  const install = resolveInstall(installs, scopeChoice);
  if (!install) {
    print(`\n  ${red('✗')}  No install found for that scope.`);
    return;
  }

  print('');
  print(`  ${dim('Existing installation found. Uncheck to remove, check to add.')}`);
  print('');

  const options: MockupOption[] = install.availableFeatures.map((featureId) => ({
    id: featureId,
    label: FEATURE_LABELS[featureId] ?? featureId,
  }));

  const result = await multiSelectWithInitial(
    `${agentChoice} features for ${scopeChoice}:`,
    options,
    [...install.installedFeatures],
  );

  if (result === null) {
    print(`\n  ${red('✗')}  Cancelled.`);
    return;
  }

  const toRemove = install.installedFeatures.filter((id) => !result.includes(id));
  const toAdd = result.filter((id) => !install.installedFeatures.includes(id));

  print('');
  if (toRemove.length === 0 && toAdd.length === 0) {
    print(`  ${green('✓')}  No changes.`);
    return;
  }

  printDiff(toRemove, toAdd, install, agentChoice, scopeChoice);

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
