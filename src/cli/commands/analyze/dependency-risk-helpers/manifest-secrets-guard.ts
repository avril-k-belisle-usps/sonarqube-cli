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

// Secrets pre-check for SCA analysis: discover manifest files via git and scan
// them for secrets before sending to the SCA backend. All failures are fail-open
// — only confirmed secrets (EXIT_CODE_SECRETS_FOUND) block the scan.

import { join } from 'node:path';

import picomatch from 'picomatch';

import type { ResolvedAuth } from '../../../../lib/auth-resolver';
import logger from '../../../../lib/logger';
import { spawnProcess } from '../../../../lib/process';
import { CommandFailedError } from '../../_common/error';
import { resolveSecretsBinaryPath } from '../../_common/install/secrets';
import { EXIT_CODE_SECRETS_FOUND, runSecretsBinary } from '../secrets';
import { parseSecretsOutput } from '../secrets-output';

/**
 * Enumerate all manifest files in `baseDir` whose relative paths match the
 * given SCA watch patterns.
 *
 * Uses `git ls-files --cached --others` so every tracked file (changed or not)
 * and every untracked file is considered. When `includeGitIgnoredPaths` is
 * false (the default, driven by `sonar.scm.exclusions.disabled`), git's own
 * ignore rules are applied via `--exclude-standard`. When true, the flag is
 * omitted so gitignored untracked files are included as well.
 *
 * Returns an empty array on any git failure so the caller can proceed without
 * blocking the scan.
 */
export async function collectManifestFiles(
  baseDir: string,
  patterns: string[],
  includeGitIgnoredPaths: boolean,
): Promise<string[]> {
  if (patterns.length === 0) return [];

  const args = ['ls-files', '-z', '--cached', '--others'];
  if (!includeGitIgnoredPaths) {
    args.push('--exclude-standard');
  }
  args.push('--', '.');

  let stdout: string;
  try {
    const result = await spawnProcess('git', args, { cwd: baseDir });
    if (result.exitCode !== 0) {
      logger.debug(
        `manifest-secrets-guard: git ls-files exited with code ${String(result.exitCode)}`,
      );
      return [];
    }
    stdout = result.stdout;
  } catch (err) {
    logger.debug(`manifest-secrets-guard: git ls-files failed: ${(err as Error).message}`);
    return [];
  }

  const relPaths = stdout.split('\0').filter((p) => p.length > 0);
  if (relPaths.length === 0) return [];

  const normalizedPatterns = patterns.map((p) => (p.includes('/') ? p : `**/${p}`));
  const match = picomatch(normalizedPatterns, { dot: true, nocase: process.platform === 'win32' });

  const matching: string[] = [];
  for (const rel of relPaths) {
    if (match(rel)) {
      matching.push(join(baseDir, rel));
    }
  }
  return matching;
}

/**
 * Run `sonar-secrets` on the given manifest files and throw a
 * `CommandFailedError` if any secrets are found.
 *
 * Silently skips when:
 * - `files` is empty
 * - `sonar-secrets` binary is not installed
 * - The binary exits with an unexpected (non-secrets-found) code
 * - The spawn itself throws (e.g. ENOENT, timeout)
 */
export async function scanManifestsForSecrets(files: string[], auth: ResolvedAuth): Promise<void> {
  if (files.length === 0) return;

  const binaryPath = resolveSecretsBinaryPath();
  if (!binaryPath) {
    logger.debug('manifest-secrets-guard: sonar-secrets not installed, skipping secrets check');
    return;
  }

  let result: Awaited<ReturnType<typeof runSecretsBinary>>;
  try {
    result = await runSecretsBinary(binaryPath, files, auth);
  } catch (err) {
    logger.debug(`manifest-secrets-guard: secrets scan error: ${(err as Error).message}`);
    return;
  }

  const exitCode = result.exitCode ?? 1;

  if (exitCode === EXIT_CODE_SECRETS_FOUND) {
    const issues = parseSecretsOutput(result.stdout);
    const affectedFiles = [...new Set(issues.map((i) => i.file))];
    const detail = affectedFiles.length > 0 ? ` (${affectedFiles.join(', ')})` : '';
    throw new CommandFailedError(
      `Secrets detected in dependency manifest files${detail}. Dependency risks analysis aborted.`,
      {
        remediationHint:
          "Remove the reported secret from the manifest file, then rerun 'sonar analyze dependency-risks'.",
      },
    );
  }

  if (exitCode !== 0) {
    logger.debug(
      `manifest-secrets-guard: secrets binary exited with unexpected code ${String(exitCode)}, proceeding`,
    );
  }
}
