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

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

import { CommandFailedError } from '../../../../../../src/cli/commands/_common/error.ts';
import type { ScaScannerInstaller } from '../../../../../../src/cli/commands/_common/install/sca-scanner.ts';
import * as manifestSecretsGuard from '../../../../../../src/cli/commands/analyze/dependency-risk-helpers/manifest-secrets-guard.ts';
import { ScaScanOrchestrator } from '../../../../../../src/cli/commands/analyze/dependency-risk-helpers/sca-scan-orchestrator.ts';
import type { ScaScannerSpawner } from '../../../../../../src/cli/commands/analyze/dependency-risk-helpers/sca-scanner-spawner.ts';
import type { ResolvedAuth } from '../../../../../../src/lib/auth-resolver.ts';
import type { SonarQubeClient } from '../../../../../../src/sonarqube/client.ts';
import type { SettingsValue } from '../../../../../../src/sonarqube/settings-value.ts';

const CLOUD_AUTH: ResolvedAuth = {
  connectionType: 'cloud',
  serverUrl: 'https://sonarcloud.io',
  token: 'test-token',
  orgKey: 'my-org',
};

const EMPTY_RESPONSE = { releases: [], parsedFiles: [], errors: [] };

function makeClient(
  overrides: {
    checkScaEnabled?: () => Promise<boolean>;
    getProjectSettings?: () => Promise<SettingsValue[]>;
  } = {},
): SonarQubeClient {
  return {
    checkScaEnabled: overrides.checkScaEnabled ?? (() => Promise.resolve(true)),
    getProjectSettings: overrides.getProjectSettings ?? (() => Promise.resolve([])),
  } as unknown as SonarQubeClient;
}

const okInstaller: ScaScannerInstaller = { install: () => Promise.resolve('/bin/sca') };

function spawnerReturning(payload: unknown): ScaScannerSpawner {
  return {
    spawn: (_binaryPath: string, args: string[]) => {
      if (args[0] === 'watch-patterns') {
        return Promise.resolve({
          exitCode: 0,
          stdout: JSON.stringify({ patterns: [] }),
          stderr: '',
        });
      }
      return Promise.resolve({ exitCode: 0, stdout: JSON.stringify(payload), stderr: '' });
    },
  };
}

describe('ScaScanOrchestrator', () => {
  let collectSpy: ReturnType<typeof spyOn>;
  let scanSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    collectSpy = spyOn(manifestSecretsGuard, 'collectManifestFiles').mockResolvedValue([]);
    scanSpy = spyOn(manifestSecretsGuard, 'scanManifestsForSecrets').mockResolvedValue(undefined);
  });

  afterEach(() => {
    collectSpy.mockRestore();
    scanSpy.mockRestore();
  });

  it('returns the scanner response on a successful scan', async () => {
    const orchestrator = new ScaScanOrchestrator(
      makeClient(),
      okInstaller,
      spawnerReturning(EMPTY_RESPONSE),
    );

    const result = await orchestrator.run(CLOUD_AUTH, 'my-project');

    expect(result).toEqual(EMPTY_RESPONSE);
  });

  it('throws when SCA is not available for the connection', () => {
    const orchestrator = new ScaScanOrchestrator(
      makeClient({ checkScaEnabled: () => Promise.resolve(false) }),
      okInstaller,
      spawnerReturning(EMPTY_RESPONSE),
    );

    expect(orchestrator.run(CLOUD_AUTH, 'my-project')).rejects.toBeInstanceOf(CommandFailedError);
  });

  it('passes projectKey and token from auth into the scanner invocation', async () => {
    const spawn = mock((_binaryPath: string, args: string[]) => {
      if (args[0] === 'watch-patterns') {
        return Promise.resolve({
          exitCode: 0,
          stdout: JSON.stringify({ patterns: [] }),
          stderr: '',
        });
      }
      return Promise.resolve({ exitCode: 0, stdout: JSON.stringify(EMPTY_RESPONSE), stderr: '' });
    });
    const orchestrator = new ScaScanOrchestrator(makeClient(), okInstaller, { spawn });

    await orchestrator.run(CLOUD_AUTH, 'my-project');

    const analyzeCall = spawn.mock.calls.find(([, args]) => args[0] === 'analyze-project');
    expect(analyzeCall).toBeDefined();
    const [, args] = analyzeCall!;
    expect(args).toContain('--project-key=my-project');
    expect(args).toContain('--sonar-token=test-token');
  });

  it('propagates CommandFailedError from scanManifestsForSecrets', () => {
    scanSpy.mockRejectedValue(
      new CommandFailedError('Secrets detected in dependency manifest files.'),
    );
    const orchestrator = new ScaScanOrchestrator(
      makeClient(),
      okInstaller,
      spawnerReturning(EMPTY_RESPONSE),
    );

    expect(orchestrator.run(CLOUD_AUTH, 'my-project')).rejects.toBeInstanceOf(CommandFailedError);
  });

  it('calls collectManifestFiles with includeGitIgnoredPaths from server settings', async () => {
    const orchestrator = new ScaScanOrchestrator(
      makeClient({
        getProjectSettings: () =>
          Promise.resolve([{ key: 'sonar.scm.exclusions.disabled', value: 'true' }]),
      }),
      okInstaller,
      spawnerReturning(EMPTY_RESPONSE),
    );

    await orchestrator.run(CLOUD_AUTH, 'my-project');

    const [, , includeGitIgnored] = collectSpy.mock.calls[0] as [string, string[], boolean];
    expect(includeGitIgnored).toBe(true);
  });
});
