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

import { bold, cyan, dim } from '../../../ui/colors.js';
import { selectPrompt } from '../../../ui/components/prompts.js';
import { print } from '../../../ui/messages.js';

const BANNER_RULE = '━'.repeat(42);

function printBanner(): void {
  print('');
  print(`  ${dim(BANNER_RULE)}`);
  print(`  ${bold('SonarQube Integration Setup')}`);
  print(`  ${dim(BANNER_RULE)}`);
  print('');
}
import { runMockupA } from './mockup-a.js';
import { runMockupB } from './mockup-b.js';
import { runMockupC } from './mockup-c.js';
import { runMockupD } from './mockup-d.js';
import { runMockupD2 } from './mockup-d2.js';
import { runMockupE } from './mockup-e.js';
import { runMockupF } from './mockup-f.js';
import { runMockupF2 } from './mockup-f2.js';
import { runMockupF3 } from './mockup-f3.js';

export async function mockupCommand(): Promise<void> {
  print('');
  print(`  ${cyan('UX Mockup')} — reconfigure flow prototypes`);
  print('');
  print(`  ${dim('A')}  Flat list — all scopes in one big selector`);
  print(`  ${dim('B')}  Scope-first — agent → scope → features`);
  print(`  ${dim('C')}  Hierarchical — pick agents, then scopes, then features for each`);
  print(
    `  ${dim('D')}   Status-first, task-oriented (Add / Remove / New scope / Uninstall / Refresh)`,
  );
  print(
    `  ${dim('D2')}  Status-first, three-action (Add / Remove / New scope — remove-all uninstalls)`,
  );
  print(`  ${dim('E')}   Status-first, single-action (set feature set per scope)`);
  print(`  ${dim('F')}   Status-IS-editor — the panel becomes a grouped multi-select`);
  print(`  ${dim('F2')}  Status-IS-editor with collapsible agents/scopes (→/← to expand/collapse)`);
  print(`  ${dim('F3')}  Status-IS-editor, Enter-only (Enter expands / toggles / applies)`);
  print('');

  const choice = await selectPrompt<'a' | 'b' | 'c' | 'd' | 'd2' | 'e' | 'f' | 'f2' | 'f3'>(
    'Which mockup to preview?',
    [
      { value: 'a', label: 'A — Flat list (all scopes in one selector)' },
      { value: 'b', label: 'B — Scope-first (agent → scope → features)' },
      { value: 'c', label: 'C — Hierarchical multi-select (agents → scopes → features per scope)' },
      {
        value: 'd',
        label: 'D — Status-first, task-oriented (Add / Remove / New scope / Uninstall / Refresh)',
      },
      {
        value: 'd2',
        label: 'D2 — Status-first, three-action (Add / Remove / New scope; remove-all uninstalls)',
      },
      { value: 'e', label: 'E — Status-first, single-action (set feature set per scope)' },
      { value: 'f', label: 'F — Status-IS-editor (panel becomes grouped multi-select)' },
      { value: 'f2', label: 'F2 — Status-IS-editor with collapsible agents/scopes' },
      { value: 'f3', label: 'F3 — Status-IS-editor, Enter-only interactions' },
    ],
  );

  printBanner();

  if (choice === 'a') {
    await runMockupA();
  } else if (choice === 'b') {
    await runMockupB();
  } else if (choice === 'c') {
    await runMockupC();
  } else if (choice === 'd') {
    await runMockupD();
  } else if (choice === 'd2') {
    await runMockupD2();
  } else if (choice === 'e') {
    await runMockupE();
  } else if (choice === 'f') {
    await runMockupF();
  } else if (choice === 'f2') {
    await runMockupF2();
  } else if (choice === 'f3') {
    await runMockupF3();
  }
}
