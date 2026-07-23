import type { JiraMigratorConfig } from "../cli/config.js";
import type { JiraReadClient } from "../jira/client.js";
import type { JiraMigrationLedgerV1 } from "../ledger.js";
import type { JiraApprovalArtifacts } from "./approvalArtifacts.js";
import type { LoadedJiraMappingPolicy } from "./mappingPolicy.js";
import type { buildJiraMigrationPlan } from "./plan.js";
import type { archiveJiraMigrationSource } from "./sourceArchive.js";
import type { discoverJiraMigrationSource } from "./sourceDiscovery.js";
import type { AkbJiraMigrationTarget } from "./targetAdapter.js";

export interface JiraExecutionInput {
  config: JiraMigratorConfig;
  target: AkbJiraMigrationTarget;
  runAt: string;
  now: () => string;
  ledger: JiraMigrationLedgerV1;
  clients: ReadonlyMap<string, JiraReadClient>;
  policies: ReadonlyMap<string, LoadedJiraMappingPolicy>;
  approval: JiraApprovalArtifacts;
  discovery: Awaited<ReturnType<typeof discoverJiraMigrationSource>>;
  archive: Awaited<ReturnType<typeof archiveJiraMigrationSource>>;
  plan: Awaited<ReturnType<typeof buildJiraMigrationPlan>>;
  assertNotAborted: () => void;
  persistLedger: (ledger: JiraMigrationLedgerV1) => Promise<void>;
  failAfterConfirmedEntities?: number;
  signal?: AbortSignal;
}
