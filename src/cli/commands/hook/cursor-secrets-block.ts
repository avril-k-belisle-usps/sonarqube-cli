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

// Shared deny helpers for Cursor secrets hook handlers.

import { EXIT_CODE_SECRETS_FOUND, runSecretsBinaryOnText } from '../analyze/secrets';
import { appendToCursorIgnore } from './cursor-ignore';
import type { HookDependencies } from './hook-dependencies';

export const CURSOR_BLOCK_EXIT_CODE = 2;
export const SECRETS_IN_FILE_MESSAGE = 'Sonar detected secrets in this file';

export async function scanTextForSecrets(deps: HookDependencies, content: string) {
  return runSecretsBinaryOnText(deps.binaryPath, content, deps.auth);
}

export function secretsFoundInScan(result: { exitCode: number | null }): boolean {
  return (result.exitCode ?? 1) === EXIT_CODE_SECRETS_FOUND;
}

function buildDenyMessage(filePath: string): string {
  return `${SECRETS_IN_FILE_MESSAGE}: ${filePath}. File added to .cursorignore — do not attempt alternate read methods.`;
}

export function denyCursorReadFile(filePath: string): never {
  appendToCursorIgnore(filePath);
  const message = buildDenyMessage(filePath);
  process.stdout.write(
    JSON.stringify({ permission: 'deny', user_message: message, agent_message: message }) + '\n',
  );
  process.exit(CURSOR_BLOCK_EXIT_CODE);
}

export function denyCursorPreToolUse(filePath: string): never {
  appendToCursorIgnore(filePath);
  const message = buildDenyMessage(filePath);
  process.stdout.write(
    JSON.stringify({
      permission: 'deny',
      user_message: message,
      agent_message: message,
    }) + '\n',
  );
  process.exit(CURSOR_BLOCK_EXIT_CODE);
}
