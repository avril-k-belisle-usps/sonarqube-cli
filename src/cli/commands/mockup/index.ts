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

// MOCKUP ONLY — entry point for UX mockups. Not production code.

import { cyan, dim } from '../../../ui/colors.js';
import { selectPrompt } from '../../../ui/components/prompts.js';
import { print } from '../../../ui/messages.js';
import { runMockupA } from './mockup-a.js';
import { runMockupB } from './mockup-b.js';
import { runMockupC } from './mockup-c.js';

export async function mockupCommand(): Promise<void> {
  print('');
  print(`  ${cyan('UX Mockup')} — reconfigure flow prototypes`);
  print('');
  print(`  ${dim('A')}  Flat list — all scopes in one big selector`);
  print(`  ${dim('B')}  Scope-first — agent → scope → features`);
  print(`  ${dim('C')}  Hierarchical — pick agents, then scopes, then features for each`);
  print('');

  const choice = await selectPrompt<'a' | 'b' | 'c'>('Which mockup to preview?', [
    { value: 'a', label: 'A — Flat list (all scopes in one selector)' },
    { value: 'b', label: 'B — Scope-first (agent → scope → features)' },
    { value: 'c', label: 'C — Hierarchical multi-select (agents → scopes → features per scope)' },
  ]);

  if (choice === 'a') {
    await runMockupA();
  } else if (choice === 'b') {
    await runMockupB();
  } else if (choice === 'c') {
    await runMockupC();
  }
}
