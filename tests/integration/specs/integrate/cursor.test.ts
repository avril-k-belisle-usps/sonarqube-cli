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

// Integration tests for `sonar integrate cursor`.
// PR 1 (CLI-619): MCP server setup, scope semantics, idempotency, and state recording.
// PR 2 (CLI-620): Secrets scanning hooks — script layout, hooks.json, state, idempotency.

import { isAbsolute } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { cursorIntegration } from '../../../../src/cli/commands/integrate/cursor/declaration';
import { hookScriptName, hookScriptPath, normalizePath, TestHarness } from '../../harness';
import { findInstalledFeature, getInstalledIntegration } from './state-helpers';

const MCP_JSON_DIRS = ['.cursor', 'mcp.json'];
const HOOKS_JSON_DIRS = ['.cursor', 'hooks.json'];
const PRETOOL_SCRIPT_DIRS = ['.cursor', 'hooks', 'sonar-secrets', 'build-scripts'];
const PROMPT_SCRIPT_DIRS = ['.cursor', 'hooks', 'sonar-secrets', 'build-scripts'];

interface CursorMcpFile {
  mcpServers?: Record<string, { command?: string; args?: string[] }>;
}

interface CursorHooksFile {
  version?: number;
  hooks?: {
    beforeSubmitPrompt?: Array<{
      command?: string;
      matcher?: string;
      timeout?: number;
      failClosed?: boolean;
    }>;
    beforeReadFile?: Array<{
      command?: string;
      matcher?: string;
      timeout?: number;
      failClosed?: boolean;
    }>;
    preToolUse?: Array<{
      command?: string;
      matcher?: string;
      timeout?: number;
      failClosed?: boolean;
    }>;
  };
}

function findCursorFeature(harness: TestHarness, featureId: string, scope?: string) {
  return findInstalledFeature(harness, 'cursor', featureId, scope);
}

describe('integrate cursor', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await TestHarness.create();
    harness.state().withSecretsBinaryInstalled();
    const server = await harness.newFakeServer().withAuthToken('tok').start();
    harness.withAuth(server.baseUrl(), 'tok');
  });

  afterEach(async () => {
    await harness.dispose();
  });

  it('is not listed in sonar integrate --help (hidden until GA)', async () => {
    const result = await harness.run('integrate --help');
    expect(result.stdout).not.toContain('cursor');
  });

  describe('project-level install (default)', () => {
    it(
      'writes .cursor/mcp.json with a sonarqube MCP server entry',
      async () => {
        const server = await harness
          .newFakeServer()
          .withAuthToken('test-token')
          .withProject('my-project')
          .start();
        harness.withAuth(server.baseUrl(), 'test-token');
        harness.cwd.writeFile(
          'sonar-project.properties',
          [`sonar.host.url=${server.baseUrl()}`, 'sonar.projectKey=my-project'].join('\n'),
        );

        const result = await harness.run('integrate cursor --non-interactive');

        expect(result.exitCode).toBe(0);
        expect(harness.cwd.exists(...MCP_JSON_DIRS)).toBe(true);

        const mcp: CursorMcpFile = harness.cwd.file(...MCP_JSON_DIRS).asJson();
        expect(mcp.mcpServers?.sonarqube).toBeDefined();
        expect(mcp.mcpServers?.sonarqube?.command).toBeDefined();
        expect(mcp.mcpServers?.sonarqube?.args).toContain('mcp');
      },
      { timeout: 30000 },
    );

    it(
      'records mcp-server feature in state with project scope',
      async () => {
        const server = await harness
          .newFakeServer()
          .withAuthToken('test-token')
          .withProject('my-project')
          .start();
        harness.withAuth(server.baseUrl(), 'test-token');
        harness.cwd.writeFile(
          'sonar-project.properties',
          [`sonar.host.url=${server.baseUrl()}`, 'sonar.projectKey=my-project'].join('\n'),
        );

        const result = await harness.run('integrate cursor --non-interactive');

        expect(result.exitCode).toBe(0);

        const integration = getInstalledIntegration(harness, 'cursor');
        expect(integration).toBeDefined();
        expect(integration!.features.map((f: { featureId: string }) => f.featureId).sort()).toEqual(
          ['mcp-server', 'sonar-secrets-hooks'],
        );

        const mcpFeature = findInstalledFeature(harness, 'cursor', 'mcp-server');
        expect(mcpFeature).toMatchObject({
          scope: 'project',
          resources: [
            {
              id: 'cursor-mcp-config',
              resourceType: 'json-patch',
              path: harness.cwd.file(...MCP_JSON_DIRS).path,
            },
          ],
        });
      },
      { timeout: 30000 },
    );

    it(
      'uses a project-relative command path so the config is portable',
      async () => {
        const server = await harness
          .newFakeServer()
          .withAuthToken('test-token')
          .withProject('my-project')
          .start();
        harness.withAuth(server.baseUrl(), 'test-token');
        harness.cwd.writeFile(
          'sonar-project.properties',
          [`sonar.host.url=${server.baseUrl()}`, 'sonar.projectKey=my-project'].join('\n'),
        );

        await harness.run('integrate cursor --non-interactive');

        const mcp: CursorMcpFile = harness.cwd.file(...MCP_JSON_DIRS).asJson();
        expect(mcp.mcpServers?.sonarqube?.args).toContain('my-project');
      },
      { timeout: 30000 },
    );

    it(
      're-running is idempotent — does not duplicate mcpServers entries',
      async () => {
        await harness.run('integrate cursor --non-interactive');
        const firstBody = harness.cwd.file(...MCP_JSON_DIRS).asText();

        const result = await harness.run('integrate cursor --non-interactive');

        expect(result.exitCode).toBe(0);
        expect(harness.cwd.file(...MCP_JSON_DIRS).asText()).toBe(firstBody);

        const mcp: CursorMcpFile = harness.cwd.file(...MCP_JSON_DIRS).asJson();
        expect(Object.keys(mcp.mcpServers ?? {})).toHaveLength(1);
      },
      { timeout: 30000 },
    );

    it(
      'fails when the existing .cursor/mcp.json contains invalid JSON',
      async () => {
        harness.cwd.writeFile('.cursor/mcp.json', '{ invalid json');

        const result = await harness.run('integrate cursor --non-interactive');

        expect(result.exitCode).toBe(1);
        const output = result.stdout + result.stderr;
        expect(output).toContain('invalid JSON');
      },
      { timeout: 30000 },
    );

    it(
      'writes executable hook scripts and hooks.json with preToolUse, beforeReadFile, and beforeSubmitPrompt entries',
      async () => {
        const result = await harness.run('integrate cursor --non-interactive');

        expect(result.exitCode).toBe(0);

        const pretoolScript = harness.cwd.file(
          ...PRETOOL_SCRIPT_DIRS,
          hookScriptName('pre-tool-use-secrets'),
        );
        expect(pretoolScript.exists()).toBe(true);
        expect(pretoolScript.isExecutable).toBe(true);

        const prereadScript = harness.cwd.file(
          ...PRETOOL_SCRIPT_DIRS,
          hookScriptName('before-read-file-secrets'),
        );
        expect(prereadScript.exists()).toBe(true);
        expect(prereadScript.isExecutable).toBe(true);

        const promptScript = harness.cwd.file(
          ...PROMPT_SCRIPT_DIRS,
          hookScriptName('prompt-secrets'),
        );
        expect(promptScript.exists()).toBe(true);
        expect(promptScript.isExecutable).toBe(true);

        const hooks: CursorHooksFile = harness.cwd.file(...HOOKS_JSON_DIRS).asJson();
        expect(hooks.version).toBe(1);

        const preToolEntry = hooks.hooks?.preToolUse?.[0];
        expect(preToolEntry?.matcher).toBe('Read|TabRead');
        expect(preToolEntry?.command).toContain('sonar-secrets');

        const promptEntry = hooks.hooks?.beforeSubmitPrompt?.[0];
        expect(promptEntry?.matcher).toBe('UserPromptSubmit');
        expect(promptEntry?.timeout).toBe(60);
        expect(promptEntry?.failClosed).toBe(false);
        expect(promptEntry?.command).toContain('sonar-secrets');

        const readEntry = hooks.hooks?.beforeReadFile?.[0];
        expect(readEntry?.matcher).toBe('Read|TabRead');
        expect(readEntry?.command).toContain('sonar-secrets');

        expect(result.stdout).toContain('paste this into Cursor');
      },
      { timeout: 30000 },
    );

    it(
      'uses project-relative command paths in hooks.json',
      async () => {
        await harness.run('integrate cursor --non-interactive');

        const hooks: CursorHooksFile = harness.cwd.file(...HOOKS_JSON_DIRS).asJson();
        const promptCommand = hookScriptPath(String(hooks.hooks?.beforeSubmitPrompt?.[0]?.command));
        expect(isAbsolute(promptCommand)).toBe(false);
        expect(promptCommand.startsWith('.cursor/')).toBe(true);

        const readCommand = hookScriptPath(String(hooks.hooks?.beforeReadFile?.[0]?.command));
        expect(isAbsolute(readCommand)).toBe(false);
        expect(readCommand.startsWith('.cursor/')).toBe(true);
      },
      { timeout: 30000 },
    );

    it(
      're-running does not duplicate hook entries',
      async () => {
        await harness.run('integrate cursor --non-interactive');
        const result = await harness.run('integrate cursor --non-interactive');

        expect(result.exitCode).toBe(0);
        const hooks: CursorHooksFile = harness.cwd.file(...HOOKS_JSON_DIRS).asJson();
        expect(hooks.hooks?.beforeSubmitPrompt).toHaveLength(1);
        expect(hooks.hooks?.beforeReadFile).toHaveLength(1);
        expect(hooks.hooks?.preToolUse).toHaveLength(1);
      },
      { timeout: 30000 },
    );

    it(
      'preserves pre-existing non-Sonar entries in hooks.json',
      async () => {
        harness.cwd.writeFile(
          '.cursor/hooks.json',
          JSON.stringify({
            version: 1,
            hooks: {
              beforeSubmitPrompt: [
                { command: '/usr/bin/other-tool', matcher: '*', timeout: 30, failClosed: false },
              ],
            },
          }),
        );

        const result = await harness.run('integrate cursor --non-interactive');

        expect(result.exitCode).toBe(0);
        const hooks: CursorHooksFile = harness.cwd.file(...HOOKS_JSON_DIRS).asJson();
        const commands = hooks.hooks?.beforeSubmitPrompt?.map((e) => e.command) ?? [];
        expect(commands.some((c) => c?.includes('other-tool'))).toBe(true);
        expect(commands.some((c) => c?.includes('sonar-secrets'))).toBe(true);
      },
      { timeout: 30000 },
    );

    it(
      'records sonar-secrets-hooks feature in state',
      async () => {
        const result = await harness.run('integrate cursor --non-interactive');

        expect(result.exitCode).toBe(0);

        const hooksFeature = findCursorFeature(harness, 'sonar-secrets-hooks');
        expect(hooksFeature).toBeDefined();
        expect(hooksFeature).toMatchObject({
          scope: 'project',
        });
        const resourceIds = (hooksFeature?.resources ?? []).map((r: { id: string }) => r.id);
        expect(resourceIds).toContain('cursor-hooks-config');
        expect(resourceIds).toContain('preread-secrets-script');
        expect(resourceIds).toContain('pretool-secrets-script');
        expect(resourceIds).toContain('prompt-secrets-script');
      },
      { timeout: 30000 },
    );

    it(
      'skips project-level secrets hooks when a global hook is already recorded',
      async () => {
        harness
          .state()
          .withInstalledIntegrationFeature(cursorIntegration, 'sonar-secrets-hooks', 'global');

        const result = await harness.run('integrate cursor --non-interactive');

        expect(result.exitCode).toBe(0);
        expect(`${result.stdout}\n${result.stderr}`).toContain(
          'A global secrets scanning hook is already configured. Skipping project-level secrets hooks to avoid duplicate execution.',
        );
        expect(harness.cwd.exists('.cursor', 'hooks')).toBe(false);
        expect(harness.cwd.exists(...HOOKS_JSON_DIRS)).toBe(false);
        expect(findCursorFeature(harness, 'sonar-secrets-hooks', 'project')).toBeUndefined();
      },
      { timeout: 30000 },
    );
  });

  describe('global install (-g)', () => {
    it(
      'writes to ~/.cursor/mcp.json and not to the project directory',
      async () => {
        const result = await harness.run('integrate cursor -g --non-interactive');

        expect(result.exitCode).toBe(0);
        expect(harness.cwd.exists(...MCP_JSON_DIRS)).toBe(false);
        expect(harness.userHome.exists(...MCP_JSON_DIRS)).toBe(true);

        const mcp: CursorMcpFile = harness.userHome.file(...MCP_JSON_DIRS).asJson();
        expect(mcp.mcpServers?.sonarqube).toBeDefined();
        expect(mcp.mcpServers?.sonarqube?.args).toContain('mcp');
      },
      { timeout: 30000 },
    );

    it(
      'records mcp-server feature with global scope in state',
      async () => {
        const result = await harness.run('integrate cursor -g --non-interactive');

        expect(result.exitCode).toBe(0);

        const mcpFeature = findInstalledFeature(harness, 'cursor', 'mcp-server', 'global');
        expect(mcpFeature).toBeDefined();
        expect(mcpFeature).toMatchObject({
          scope: 'global',
          resources: [
            {
              id: 'cursor-mcp-config',
              resourceType: 'json-patch',
              path: harness.userHome.file(...MCP_JSON_DIRS).path,
            },
          ],
        });
      },
      { timeout: 30000 },
    );

    it(
      'emits a warning that cloud agents only pick up project-level hooks',
      async () => {
        const result = await harness.run('integrate cursor -g --non-interactive');

        expect(result.exitCode).toBe(0);
        expect(result.stderr).toContain('cloud');
      },
      { timeout: 30000 },
    );

    it(
      'writes hook scripts and hooks.json under ~/.cursor/ with absolute command paths',
      async () => {
        const result = await harness.run('integrate cursor -g --non-interactive');

        expect(result.exitCode).toBe(0);
        expect(harness.cwd.exists('.cursor', 'hooks')).toBe(false);

        expect(
          harness.userHome.exists(...PROMPT_SCRIPT_DIRS, hookScriptName('prompt-secrets')),
        ).toBe(true);
        expect(
          harness.userHome.exists(
            ...PRETOOL_SCRIPT_DIRS,
            hookScriptName('before-read-file-secrets'),
          ),
        ).toBe(true);

        const hooks: CursorHooksFile = harness.userHome.file(...HOOKS_JSON_DIRS).asJson();
        const promptCommand = hookScriptPath(String(hooks.hooks?.beforeSubmitPrompt?.[0]?.command));
        expect(isAbsolute(promptCommand)).toBe(true);
        expect(promptCommand.startsWith(normalizePath(harness.userHome.path))).toBe(true);
      },
      { timeout: 30000 },
    );
  });

  it(
    'rejects --global combined with --project',
    async () => {
      const result = await harness.run(
        'integrate cursor --global --project my-project --non-interactive',
      );
      expect(result.exitCode).toBe(2);
    },
    { timeout: 30000 },
  );
});
