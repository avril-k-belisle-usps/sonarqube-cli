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

import { CLI_COMMAND, CURSOR_CONFIG_DIR } from '../../../../lib/config-constants';
import { getMcpConfig, getMcpConfigFilePath } from '../../../../lib/mcp/mcp-helper';
import { getOptionalStringAttr } from '../_common/attrs';
import {
  resolveAgentHooksConfigPath,
  secretsScanningExample,
} from '../_common/features/sonar-secrets-hooks-feature';
import { resolveAgentHookScriptPath } from '../_common/hooks';
import { removeJsonMcpServer, upsertJsonMcpServer } from '../_common/mcp-config';
import type { IntegrationContext, IntegrationDeclaration } from '../_common/registry';
import {
  askUser,
  isFeatureInstalledGloballyForProject,
  jsonPatch,
  skip,
  sonarSecretsBinaryDependency,
  wholeFile,
} from '../_common/registry';
import type { IntegrateAgentOptions } from '../_common/types';
import {
  getSecretPreFileReadTemplateUnix,
  getSecretPreFileReadTemplateWindows,
  getSecretPreToolUseTemplateUnix,
  getSecretPreToolUseTemplateWindows,
  getSecretPromptTemplateUnix,
  getSecretPromptTemplateWindows,
} from './hook-templates';
import { buildCursorHookEntry, removeCursorHooks, upsertCursorHooks } from './hooks';

export { CURSOR_CONFIG_DIR } from '../../../../lib/config-constants';
const HOOKS_JSON = 'hooks.json';
const PREREAD_SCRIPT_REL = 'sonar-secrets/build-scripts/before-read-file-secrets';
const PRETOOL_SCRIPT_REL = 'sonar-secrets/build-scripts/pre-tool-use-secrets';
const PROMPT_SCRIPT_REL = 'sonar-secrets/build-scripts/prompt-secrets';

export const CURSOR_INTEGRATION_ID = 'cursor';

export interface CursorIntegrationOptions extends IntegrateAgentOptions {
  globalSecretsHookExists?: boolean;
}

function resolveCursorMcpConfigPath(context: IntegrationContext): string {
  return getMcpConfigFilePath('cursor', context.scope === 'global', context.targetRoot);
}

function getDesiredCursorMcpConfig(context: IntegrationContext) {
  return getMcpConfig(
    CLI_COMMAND,
    context.scope === 'global'
      ? { withFsMount: false }
      : {
          withFsMount: true,
          projectRoot: context.targetRoot,
          projectKey: getOptionalStringAttr(context, 'projectKey'),
        },
  );
}

function resolveCursorHooksJsonPath(context: IntegrationContext): string {
  return resolveAgentHooksConfigPath(context, CURSOR_CONFIG_DIR, HOOKS_JSON);
}

export const cursorIntegration: IntegrationDeclaration<CursorIntegrationOptions> = {
  id: CURSOR_INTEGRATION_ID,
  displayName: 'Cursor',
  features: [
    {
      id: 'sonar-secrets-hooks',
      displayName: 'secret scanning hooks',
      shouldInstall: ({ options, scope, state }) => {
        const globalHookExists =
          options.globalSecretsHookExists ??
          isFeatureInstalledGloballyForProject(
            state,
            scope,
            CURSOR_INTEGRATION_ID,
            'sonar-secrets-hooks',
          );
        return globalHookExists
          ? skip(
              'A global secrets scanning hook is already configured. Skipping project-level secrets hooks to avoid duplicate execution.',
            )
          : askUser();
      },
      postInstallExample: secretsScanningExample('Cursor'),
      dependencies: [sonarSecretsBinaryDependency],
      resources: [
        wholeFile({
          id: 'preread-secrets-script',
          displayName: 'Cursor beforeReadFile hook script',
          targetPath: (context) =>
            resolveAgentHookScriptPath(context, CURSOR_CONFIG_DIR, PREREAD_SCRIPT_REL),
          content: {
            unix: getSecretPreFileReadTemplateUnix(),
            windows: getSecretPreFileReadTemplateWindows(),
          },
          executable: true,
        }),
        wholeFile({
          id: 'pretool-secrets-script',
          displayName: 'Cursor preToolUse hook script',
          targetPath: (context) =>
            resolveAgentHookScriptPath(context, CURSOR_CONFIG_DIR, PRETOOL_SCRIPT_REL),
          content: {
            unix: getSecretPreToolUseTemplateUnix(),
            windows: getSecretPreToolUseTemplateWindows(),
          },
          executable: true,
        }),
        wholeFile({
          id: 'prompt-secrets-script',
          displayName: 'Cursor beforeSubmitPrompt hook script',
          targetPath: (context) =>
            resolveAgentHookScriptPath(context, CURSOR_CONFIG_DIR, PROMPT_SCRIPT_REL),
          content: {
            unix: getSecretPromptTemplateUnix(),
            windows: getSecretPromptTemplateWindows(),
          },
          executable: true,
        }),
        jsonPatch({
          id: 'cursor-hooks-config',
          displayName: 'Cursor hooks configuration',
          targetPath: resolveCursorHooksJsonPath,
          defaultValue: { version: 1, hooks: {} },
          patch: (document, context) =>
            upsertCursorHooks(document, [
              buildCursorHookEntry(context, CURSOR_CONFIG_DIR, 'preToolUse', PRETOOL_SCRIPT_REL),
              buildCursorHookEntry(
                context,
                CURSOR_CONFIG_DIR,
                'beforeReadFile',
                PREREAD_SCRIPT_REL,
              ),
              buildCursorHookEntry(
                context,
                CURSOR_CONFIG_DIR,
                'beforeSubmitPrompt',
                PROMPT_SCRIPT_REL,
              ),
            ]),
          removePatch: (document) => removeCursorHooks(document, ['sonar-secrets']),
        }),
      ],
    },
    {
      id: 'mcp-server',
      displayName: 'MCP server',
      resources: [
        jsonPatch({
          id: 'cursor-mcp-config',
          displayName: 'Cursor MCP configuration',
          targetPath: resolveCursorMcpConfigPath,
          defaultValue: {},
          patch: (document, context) =>
            upsertJsonMcpServer(document, getDesiredCursorMcpConfig(context)),
          removePatch: (document) => removeJsonMcpServer(document),
        }),
      ],
    },
  ],
};
