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

// beforeSubmitPrompt callback handler for Cursor.
//
// Cursor expects `{ continue: false, user_message: "..." }` (or exit code 2) to block submission.

import logger from '../../../lib/logger';
import {
  CURSOR_BLOCK_EXIT_CODE,
  scanTextForSecrets,
  secretsFoundInScan,
} from './cursor-secrets-block';
import { resolveAuthAndSecrets } from './hook-dependencies';
import { readStdinJson } from './stdin';

const SECRETS_DENY_MESSAGE = 'Sonar detected secrets in prompt';

interface CursorBeforeSubmitPromptPayload {
  prompt?: string;
}

export async function cursorPromptSubmit(): Promise<void> {
  let payload: CursorBeforeSubmitPromptPayload;
  try {
    payload = await readStdinJson<CursorBeforeSubmitPromptPayload>();
  } catch (err) {
    logger.debug(`cursorPromptSubmit: failed to parse stdin — ${(err as Error).message}`);
    return; // unparseable stdin — allow
  }

  const prompt = payload.prompt;
  if (!prompt) return;

  const deps = await resolveAuthAndSecrets();
  if (!deps) return;

  try {
    const result = await scanTextForSecrets(deps, prompt);
    if (secretsFoundInScan(result)) {
      process.stdout.write(
        JSON.stringify({ continue: false, user_message: SECRETS_DENY_MESSAGE }) + '\n',
      );
      process.exit(CURSOR_BLOCK_EXIT_CODE);
    }
  } catch (err) {
    logger.debug(`cursorPromptSubmit secrets scan failed: ${(err as Error).message}`);
  }
}
