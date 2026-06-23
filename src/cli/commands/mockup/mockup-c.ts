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

// MOCKUP ONLY — Approach C: hierarchical multi-select (agent → scope → features). Not production code.

import { cyan, dim, green, red } from '../../../ui/colors.js';
import { selectPrompt } from '../../../ui/components/prompts.js';
import { print } from '../../../ui/messages.js';
import {
  AGENTS,
  FEATURE_LABELS,
  type FakeInstall,
  type MockupOption,
  multiSelectWithInitial,
} from './shared.js';

const CURRENT_PROJECT = '~/source/repos/sonarqube-cli';
const HEADER_WIDTH = 57;
const ALREADY = dim(' (integrated)');

interface PendingChange {
  agent: string;
  scope: string;
  install: FakeInstall;
  toRemove: string[];
  toAdd: string[];
}

function scopeOptionsFor(installs: FakeInstall[]): MockupOption[] {
  const globalInstall = installs.find((i) => i.scope === 'global');
  const currentInstall = installs.find(
    (i) => i.scope === 'project' && i.label === CURRENT_PROJECT,
  );
  const otherInstalls = installs.filter(
    (i) => i.scope === 'project' && i.label !== CURRENT_PROJECT,
  );

  return [
    {
      id: 'Global',
      label: `Global (user home — applies across projects)${globalInstall ? ALREADY : ''}`,
    },
    {
      id: CURRENT_PROJECT,
      label: `${CURRENT_PROJECT} — current project${currentInstall ? ALREADY : ''}`,
    },
    ...otherInstalls.map((i) => ({ id: i.label, label: `${i.label}${ALREADY}` })),
  ];
}

function resolveInstall(installs: FakeInstall[], scopeId: string): FakeInstall | undefined {
  return scopeId === 'Global'
    ? installs.find((i) => i.scope === 'global')
    : installs.find((i) => i.label === scopeId);
}

function featureOptionsFor(availableFeatures: string[]): MockupOption[] {
  return availableFeatures.map((f) => ({ id: f, label: FEATURE_LABELS[f] ?? f }));
}

function printSummary(changes: PendingChange[]): void {
  for (const { agent, scope, toRemove, toAdd } of changes) {
    const tag = dim(`[${agent} · ${scope}]`);
    if (toRemove.length > 0) {
      print(`  ${red('−')}  ${tag} Remove:`);
      for (const id of toRemove) print(`       ${FEATURE_LABELS[id] ?? id}`);
    }
    if (toAdd.length > 0) {
      print(`  ${green('+')}  ${tag} Install:`);
      for (const id of toAdd) print(`       ${FEATURE_LABELS[id] ?? id}`);
    }
  }
}

// Step 3 helper for a scope with no prior install (fresh scope).
async function collectNewScopeChange(
  agentName: string,
  scopeId: string,
  installs: FakeInstall[],
): Promise<PendingChange | null> {
  const uniqueFeatures = [...new Set(installs.flatMap((i) => i.availableFeatures))];
  const scopeLabel = scopeId === 'Global' ? 'Global' : scopeId;
  const step3label = `Step 3 of 3 — ${agentName} · ${scopeLabel}: select features to install`;
  print('');
  const result = await multiSelectWithInitial(step3label, featureOptionsFor(uniqueFeatures), []);
  if (result === null || result.length === 0) return null;
  return {
    agent: agentName,
    scope: scopeLabel,
    install: { scope: 'project', label: scopeId, installedFeatures: [], availableFeatures: uniqueFeatures },
    toRemove: [],
    toAdd: result,
  };
}

// Step 3 helper for a scope that already has an install.
async function collectExistingScopeChange(
  agentName: string,
  scopeId: string,
  install: FakeInstall,
): Promise<PendingChange | null> {
  const scopeLabel = scopeId === 'Global' ? 'Global' : scopeId;
  const step3label = `Step 3 of 3 — ${agentName} · ${scopeLabel}: select features`;
  print('');
  const result = await multiSelectWithInitial(
    step3label,
    featureOptionsFor(install.availableFeatures),
    [...install.installedFeatures],
  );
  if (result === null) {
    const skippedMsg = dim(`Skipped ${scopeLabel}.`);
    print(`  ${skippedMsg}`);
    return null;
  }
  const toRemove = install.installedFeatures.filter((id) => !result.includes(id));
  const toAdd = result.filter((id) => !install.installedFeatures.includes(id));
  if (toRemove.length === 0 && toAdd.length === 0) return null;
  return { agent: agentName, scope: scopeLabel, install, toRemove, toAdd };
}

// Step 2 + 3: collect all pending changes for one agent.
async function collectAgentChanges(
  agentName: string,
  installs: FakeInstall[],
): Promise<PendingChange[]> {
  print('');
  print(`  ${cyan('●')}  ${agentName}`);
  print('');

  const selectedScopes = await multiSelectWithInitial(
    `Step 2 of 3 — ${agentName}: which scopes to configure?`,
    scopeOptionsFor(installs),
    [],
  );
  if (selectedScopes === null || selectedScopes.length === 0) {
    print(`  ${dim('No scopes selected — skipping.')}`);
    return [];
  }

  const changes: PendingChange[] = [];
  for (const scopeId of selectedScopes) {
    const install = resolveInstall(installs, scopeId);
    const change = install
      ? await collectExistingScopeChange(agentName, scopeId, install)
      : await collectNewScopeChange(agentName, scopeId, installs);
    if (change) changes.push(change);
  }
  return changes;
}

export async function runMockupC(): Promise<void> {
  print('');
  print(`${cyan('┌')} Reconfigure integrations — step by step`);
  print(cyan('└' + '─'.repeat(HEADER_WIDTH)));
  print('');

  // Step 1: pick which agents to modify
  const agentOptions: MockupOption[] = Object.keys(AGENTS).map((name) => ({
    id: name,
    label: name,
  }));

  const selectedAgents = await multiSelectWithInitial(
    'Step 1 of 3 — Which integrations do you want to modify?',
    agentOptions,
    [],
  );
  if (selectedAgents === null || selectedAgents.length === 0) {
    print(`\n  ${red('✗')}  Cancelled.`);
    return;
  }

  // Steps 2 & 3: for each agent → scopes → features
  const pendingChanges: PendingChange[] = [];
  for (const agentName of selectedAgents) {
    const installs = AGENTS[agentName] ?? [];
    const changes = await collectAgentChanges(agentName, installs);
    pendingChanges.push(...changes);
  }

  // Final: summary + confirm
  print('');
  if (pendingChanges.length === 0) {
    print(`  ${green('✓')}  No changes.`);
    return;
  }

  print(`${cyan('┌')} Summary of changes`);
  print(cyan('└' + '─'.repeat(HEADER_WIDTH)));
  print('');
  printSummary(pendingChanges);
  print('');

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
