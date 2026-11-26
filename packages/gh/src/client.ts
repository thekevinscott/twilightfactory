import { Octokit } from "@octokit/rest";

export const client = (token: string, options: ConstructorParameters<typeof Octokit>[0] = {}): Octokit =>
  new Octokit({ auth: token, ...options });
