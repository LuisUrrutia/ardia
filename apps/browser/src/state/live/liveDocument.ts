import { unchanged, type Migrations } from "../../lib/savedDocument";
import type { LiveConfig } from "./store";
import type { ProfileAccounts } from "./types";

export const DOC = "live.json";
export const DOC_VERSION = 3;

function withLegacyAuth(accounts: unknown, config: unknown): ProfileAccounts {
  const flat = (accounts ?? {}) as ProfileAccounts;
  const saved = (config ?? {}) as Partial<LiveConfig>;
  const auth: ProfileAccounts = { ...flat };
  if (flat.bitbucket) auth.bitbucket = { ...flat.bitbucket, user: saved.bitbucketUser ?? "" };
  if (flat.confluence) auth.confluence = { ...flat.confluence, user: saved.confluenceEmail ?? "", site: saved.confluenceSite ?? "" };
  if (flat.gdrive) auth.gdrive = { ...flat.gdrive, clientId: saved.googleClientId ?? "" };
  return auth;
}

export const DOC_MIGRATIONS: Migrations = {
  0: unchanged,
  1: (doc) => ({
    ...doc,
    folders: Object.fromEntries(Object.entries((doc.folders ?? {}) as Record<string, object>).map(([id, f]) => [id, { showNewRepos: true, shownRepos: [], ...f }])),
  }),
  2: (doc) => ({ ...doc, accounts: {}, legacyAccounts: withLegacyAuth(doc.accounts, doc.config) }),
};
