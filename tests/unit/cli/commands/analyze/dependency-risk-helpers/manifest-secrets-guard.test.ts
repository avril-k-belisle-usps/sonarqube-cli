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

import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import { CommandFailedError } from '../../../../../../src/cli/commands/_common/error';
import * as installSecrets from '../../../../../../src/cli/commands/_common/install/secrets';
import {
  collectManifestFiles,
  scanManifestsForSecrets,
} from '../../../../../../src/cli/commands/analyze/dependency-risk-helpers/manifest-secrets-guard';
import * as analyzeSecrets from '../../../../../../src/cli/commands/analyze/secrets';
import * as processLib from '../../../../../../src/lib/process';

const BASE_DIR = '/project';
const FAKE_AUTH = {
  token: 'tok',
  serverUrl: 'https://sonarcloud.io',
  connectionType: 'cloud' as const,
  orgKey: 'myorg',
};
const OK_RESULT = { exitCode: 0, stdout: '', stderr: '' };

function gitOutput(files: string[]): string {
  return files.join('\0');
}

describe('collectManifestFiles', () => {
  let spawnProcessSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    spawnProcessSpy = spyOn(processLib, 'spawnProcess').mockResolvedValue({
      exitCode: 0,
      stdout: gitOutput(['package.json', 'frontend/package.json', 'src/index.ts']),
      stderr: '',
    });
  });

  afterEach(() => {
    spawnProcessSpy.mockRestore();
  });

  it('returns empty array when patterns is empty', async () => {
    const result = await collectManifestFiles(BASE_DIR, [], false);
    expect(result).toEqual([]);
    expect(spawnProcessSpy).not.toHaveBeenCalled();
  });

  it('returns absolute paths for files matching patterns', async () => {
    const result = await collectManifestFiles(BASE_DIR, ['package.json'], false);
    expect(result).toEqual([
      join(BASE_DIR, 'package.json'),
      join(BASE_DIR, 'frontend/package.json'),
    ]);
  });

  it('excludes files not matching patterns', async () => {
    const result = await collectManifestFiles(BASE_DIR, ['package.json'], false);
    expect(result.some((f) => f.endsWith('index.ts'))).toBe(false);
  });

  it('passes --exclude-standard when includeGitIgnoredPaths is false', async () => {
    await collectManifestFiles(BASE_DIR, ['package.json'], false);
    const [, args] = spawnProcessSpy.mock.calls[0] as [string, string[], unknown];
    expect(args).toContain('--exclude-standard');
  });

  it('omits --exclude-standard when includeGitIgnoredPaths is true', async () => {
    await collectManifestFiles(BASE_DIR, ['package.json'], true);
    const [, args] = spawnProcessSpy.mock.calls[0] as [string, string[], unknown];
    expect(args).not.toContain('--exclude-standard');
  });

  it('always passes --cached and --others to cover unchanged tracked and untracked files', async () => {
    await collectManifestFiles(BASE_DIR, ['package.json'], false);
    const [, args] = spawnProcessSpy.mock.calls[0] as [string, string[], unknown];
    expect(args).toContain('--cached');
    expect(args).toContain('--others');
  });

  it('returns empty array when git exits with non-zero', async () => {
    spawnProcessSpy.mockResolvedValue({ exitCode: 128, stdout: '', stderr: 'not a git repo' });
    const result = await collectManifestFiles(BASE_DIR, ['package.json'], false);
    expect(result).toEqual([]);
  });

  it('returns empty array when git spawn throws', async () => {
    spawnProcessSpy.mockRejectedValue(new Error('ENOENT'));
    const result = await collectManifestFiles(BASE_DIR, ['package.json'], false);
    expect(result).toEqual([]);
  });

  it('returns empty array when git output is empty', async () => {
    spawnProcessSpy.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    const result = await collectManifestFiles(BASE_DIR, ['package.json'], false);
    expect(result).toEqual([]);
  });

  it('matches *.lock patterns across subdirectories', async () => {
    spawnProcessSpy.mockResolvedValue({
      exitCode: 0,
      stdout: gitOutput(['package-lock.json', 'sub/yarn.lock', 'src/index.ts']),
      stderr: '',
    });
    const result = await collectManifestFiles(BASE_DIR, ['*.lock'], false);
    expect(result).toEqual([join(BASE_DIR, 'sub/yarn.lock')]);
  });
});

describe('scanManifestsForSecrets', () => {
  let resolveSecretsBinaryPathSpy: ReturnType<typeof spyOn>;
  let runSecretsBinarySpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    resolveSecretsBinaryPathSpy = spyOn(installSecrets, 'resolveSecretsBinaryPath').mockReturnValue(
      '/usr/bin/sonar-secrets',
    );
    runSecretsBinarySpy = spyOn(analyzeSecrets, 'runSecretsBinary').mockResolvedValue(OK_RESULT);
  });

  afterEach(() => {
    resolveSecretsBinaryPathSpy.mockRestore();
    runSecretsBinarySpy.mockRestore();
  });

  it('does nothing when files list is empty', async () => {
    await scanManifestsForSecrets([], FAKE_AUTH);
    expect(runSecretsBinarySpy).not.toHaveBeenCalled();
  });

  it('does nothing when sonar-secrets binary is not installed', async () => {
    resolveSecretsBinaryPathSpy.mockReturnValue(null);
    await scanManifestsForSecrets(['/project/package.json'], FAKE_AUTH);
    expect(runSecretsBinarySpy).not.toHaveBeenCalled();
  });

  it('does not throw when secrets binary exits cleanly', async () => {
    await scanManifestsForSecrets(['/project/package.json'], FAKE_AUTH);
  });

  it('throws CommandFailedError when secrets are found', () => {
    runSecretsBinarySpy.mockResolvedValue({
      exitCode: analyzeSecrets.EXIT_CODE_SECRETS_FOUND,
      stdout: '',
      stderr: '',
    });
    expect(scanManifestsForSecrets(['/project/package.json'], FAKE_AUTH)).rejects.toBeInstanceOf(
      CommandFailedError,
    );
  });

  it('includes affected file paths in the error message when parseable', async () => {
    const stdout =
      'Hard-coded credentials\nFile: /project/package.json\nLocation: [3:10-3:30]\nSecret: ***';
    runSecretsBinarySpy.mockResolvedValue({
      exitCode: analyzeSecrets.EXIT_CODE_SECRETS_FOUND,
      stdout,
      stderr: '',
    });
    const err = await scanManifestsForSecrets(['/project/package.json'], FAKE_AUTH).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CommandFailedError);
    expect((err as CommandFailedError).message).toContain('/project/package.json');
  });

  it('falls back to generic message when stdout is empty on EXIT_CODE_SECRETS_FOUND', async () => {
    runSecretsBinarySpy.mockResolvedValue({
      exitCode: analyzeSecrets.EXIT_CODE_SECRETS_FOUND,
      stdout: '',
      stderr: '',
    });
    const err = await scanManifestsForSecrets(['/project/package.json'], FAKE_AUTH).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CommandFailedError);
    expect((err as CommandFailedError).message).toBe(
      'Secrets detected in dependency manifest files. Dependency risks analysis aborted.',
    );
  });

  it('does not throw when binary exits with unexpected non-zero code', async () => {
    runSecretsBinarySpy.mockResolvedValue({ exitCode: 2, stdout: '', stderr: 'crash' });
    await scanManifestsForSecrets(['/project/package.json'], FAKE_AUTH);
  });

  it('does not throw when runSecretsBinary itself throws', async () => {
    runSecretsBinarySpy.mockRejectedValue(new Error('timed out'));
    await scanManifestsForSecrets(['/project/package.json'], FAKE_AUTH);
  });

  it('passes file paths to the secrets binary', async () => {
    const files = ['/project/package.json', '/project/pom.xml'];
    await scanManifestsForSecrets(files, FAKE_AUTH);
    const [, passedFiles] = runSecretsBinarySpy.mock.calls[0] as [string, string[], unknown];
    expect(passedFiles).toEqual(files);
  });
});
