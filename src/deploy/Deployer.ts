/**
 * Deploy layer contract (spec §9). Everything vendor-specific lives in an
 * implementation (CloudflareDeployer) so swapping targets is a one-file job.
 */

export interface PreflightResult {
  ok: boolean;
  /** true when the user is authenticated with the target account */
  loggedIn: boolean;
  account?: string;
  /** plain-language reason when not ready (shown to a non-technical user) */
  reason?: string;
}

export interface ProvisionResult {
  dbName: string;
  databaseId: string;
}

export interface DeployResult {
  url: string;
  dbName: string;
  account: string;
}

export interface Deployer {
  name: string;
  /** Is the target CLI installed and the user logged into their OWN account? */
  preflight(): Promise<PreflightResult>;
  /** Drive the interactive login into the user's own account. */
  login(onLog: (line: string) => void): Promise<PreflightResult>;
  /** Create the DB in the user's account + apply migrations; patch config. */
  provision(
    projectDir: string,
    dbName: string,
    onLog: (line: string) => void,
  ): Promise<ProvisionResult>;
  /** Deploy the built app; return the live URL. */
  deploy(
    projectDir: string,
    dbName: string,
    onLog: (line: string) => void,
  ): Promise<DeployResult>;
}
