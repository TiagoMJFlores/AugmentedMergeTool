import type { TicketProvider } from './TicketProvider.js';
import { NullProvider } from './NullProvider.js';
import { LinearProvider } from './LinearProvider.js';
import { JiraProvider } from './JiraProvider.js';
import { GitHubIssuesProvider } from './GitHubIssuesProvider.js';

export type ProviderType = 'linear' | 'jira' | 'github' | 'none';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function normalizeProvider(value: string | undefined): ProviderType {
  switch ((value ?? '').toLowerCase()) {
    case 'linear':
    case 'jira':
    case 'github':
    case 'none':
      return value!.toLowerCase() as ProviderType;
    case '':
      return 'none';
    default:
      throw new Error(
        `Invalid provider "${value}". Valid options: linear, jira, github, none.`
      );
  }
}

export function createProvider(config: {
  provider: ProviderType;
}): TicketProvider {
  switch (config.provider) {
    case 'linear':
      return new LinearProvider(requireEnv('LINEAR_API_KEY'));
    case 'jira':
      return new JiraProvider(
        requireEnv('JIRA_API_KEY'),
        requireEnv('JIRA_BASE_URL')
      );
    case 'github':
      return new GitHubIssuesProvider(
        requireEnv('GITHUB_TOKEN'),
        requireEnv('GITHUB_REPO')
      );
    case 'none':
    default:
      return new NullProvider();
  }
}
