import type {
  CollectContext,
  CollectorObservation,
  ResourceInventoryPort,
  TelemetryPort,
} from '@grounds/application';
import {
  AWS_SESSION_REFRESH_SKEW_SECONDS,
  AWS_SESSION_SECONDS,
  OutOfScopeError,
  splitEcsResourceId,
  type JsonObject,
  type ResourceRef,
} from '@grounds/domain';
import { collectInventory, collectTelemetry } from './collectors.js';
import {
  assumeRoleSession,
  LiveAwsOperations,
  type AwsSessionCredentials,
} from './live-operations.js';
import type { LiveAwsConfig } from './adapter.js';
import type { AwsOperations } from './operations.js';
import { CountingOperations } from './adapter.js';
import { assertApprovedScope, assertCallerAccount } from './scope.js';

export type AssumeRoleFn = typeof assumeRoleSession;
export type LiveOperationsFactory = (
  session: AwsSessionCredentials,
) => AwsOperations & { getCallerIdentity(): Promise<JsonObject> };
export type EpochClock = () => number;

export class LiveAwsBundle {
  public calls: string[] = [];
  private operations: AwsOperations | undefined;
  private usableUntilMs = 0;

  public constructor(
    private readonly config: LiveAwsConfig,
    private readonly bootstrap: AssumeRoleFn = assumeRoleSession,
    private readonly createOperations: LiveOperationsFactory = (session) =>
      new LiveAwsOperations(session),
    private readonly now: EpochClock = () => Date.now(),
  ) {}

  public async ensure(scope: ResourceRef): Promise<AwsOperations | undefined> {
    splitEcsResourceId(scope.resourceId);
    assertApprovedScope(scope, this.config.allowedScope);
    if (!this.config.externalId) {
      throw new Error('external ID is required');
    }
    if (this.operations && this.now() < this.usableUntilMs) {
      return this.operations;
    }
    this.operations = undefined;
    this.usableUntilMs = 0;
    try {
      const session = await this.bootstrap({
        roleArn: this.config.roleArn,
        externalId: this.config.externalId,
        region: this.config.region,
      });
      this.calls.push('assumeRole');
      const live = this.createOperations(session);
      const identity = await live.getCallerIdentity();
      this.calls.push('getCallerIdentity');
      const account = typeof identity['Account'] === 'string' ? identity['Account'] : '';
      assertCallerAccount(account, scope);
      this.operations = new CountingOperations(live);
      this.usableUntilMs =
        this.now() + (AWS_SESSION_SECONDS - AWS_SESSION_REFRESH_SKEW_SECONDS) * 1000;
      return this.operations;
    } catch (error) {
      if (error instanceof OutOfScopeError) {
        throw error;
      }
      return undefined;
    }
  }
}

export class LiveInventory implements ResourceInventoryPort {
  public constructor(private readonly bundle: LiveAwsBundle) {}
  public async collect(context: CollectContext): Promise<readonly CollectorObservation[]> {
    const operations = await this.bundle.ensure(context.scope);
    if (!operations) {
      return collectInventory(unavailableOps(), context);
    }
    return collectInventory(operations, context);
  }
}

export class LiveTelemetry implements TelemetryPort {
  public constructor(private readonly bundle: LiveAwsBundle) {}
  public async collect(context: CollectContext): Promise<readonly CollectorObservation[]> {
    const operations = await this.bundle.ensure(context.scope);
    if (!operations) {
      return collectTelemetry(unavailableOps(), context);
    }
    return collectTelemetry(operations, context);
  }
}

export function createLivePorts(
  config: LiveAwsConfig,
  bootstrap: AssumeRoleFn = assumeRoleSession,
  createOperations?: LiveOperationsFactory,
  now: EpochClock = () => Date.now(),
): {
  readonly inventory: ResourceInventoryPort;
  readonly telemetry: TelemetryPort;
  readonly bundle: LiveAwsBundle;
} {
  const bundle = new LiveAwsBundle(
    config,
    bootstrap,
    createOperations ?? ((session) => new LiveAwsOperations(session)),
    now,
  );
  return {
    inventory: new LiveInventory(bundle),
    telemetry: new LiveTelemetry(bundle),
    bundle,
  };
}

function unavailableOps(): AwsOperations {
  const fail = (): Promise<never> => Promise.reject(new Error('unavailable'));
  return {
    describeServices: fail,
    listTasks: fail,
    describeTasks: fail,
    describeTargetGroups: fail,
    describeTargetHealth: fail,
    describeAlarms: fail,
    getMetricData: fail,
  };
}
