import { AWS_SESSION_SECONDS, OutOfScopeError, type ResourceRef } from '@grounds/domain';
import type {
  CollectContext,
  CollectorObservation,
  ResourceInventoryPort,
  TelemetryPort,
} from '@grounds/application';
import { collectInventory, collectTelemetry } from './collectors.js';
import {
  FixtureOperations,
  loadFixtureScenario,
  type FixtureScenarioName,
} from './fixture-operations.js';
import type { AwsOperations } from './operations.js';
import { splitEcsResourceId } from '@grounds/domain';
import { DEFAULT_ALLOWED_SCOPE, assertApprovedScope } from './scope.js';

export class CountingOperations implements AwsOperations {
  public readonly calls: string[] = [];

  public constructor(private readonly inner: AwsOperations) {}

  public describeServices(input: { clusterName: string; serviceName: string }) {
    this.calls.push('describeServices');
    return this.inner.describeServices(input);
  }
  public listTasks(
    input: { clusterName: string; serviceName: string; desiredStatus: 'RUNNING' | 'STOPPED' },
    nextToken: string | null,
  ) {
    this.calls.push('listTasks');
    return this.inner.listTasks(input, nextToken);
  }
  public describeTasks(input: { clusterName: string; taskArns: readonly string[] }) {
    this.calls.push('describeTasks');
    return this.inner.describeTasks(input);
  }
  public describeTargetGroups(input: { targetGroupArns: readonly string[] }) {
    this.calls.push('describeTargetGroups');
    return this.inner.describeTargetGroups(input);
  }
  public describeTargetHealth(input: { targetGroupArn: string }, nextToken: string | null) {
    this.calls.push('describeTargetHealth');
    return this.inner.describeTargetHealth(input, nextToken);
  }
  public describeAlarms(nextToken: string | null) {
    this.calls.push('describeAlarms');
    return this.inner.describeAlarms(nextToken);
  }
  public getMetricData(
    input: {
      clusterName: string;
      serviceName: string;
      from: string;
      to: string;
    },
    nextToken: string | null,
  ) {
    this.calls.push('getMetricData');
    return this.inner.getMetricData(input, nextToken);
  }
  public getCallerIdentity() {
    this.calls.push('getCallerIdentity');
    return this.inner.getCallerIdentity?.() ?? Promise.resolve({ Account: '123456789012' });
  }
  public assumeRole(input: { roleArn: string; externalId: string; sessionSeconds: number }) {
    this.calls.push('assumeRole');
    return (
      this.inner.assumeRole?.(input) ??
      Promise.resolve({
        AccessKeyId: 'ASIAEXAMPLE',
        SecretAccessKey: 'secret',
        SessionToken: 'token',
      })
    );
  }
}

export class FixtureAwsAdapter implements ResourceInventoryPort, TelemetryPort {
  public readonly operations: CountingOperations;

  public constructor(scenario: FixtureScenarioName = 'healthy') {
    this.operations = new CountingOperations(new FixtureOperations(loadFixtureScenario(scenario)));
  }

  public collect(context: CollectContext): Promise<readonly CollectorObservation[]> {
    splitEcsResourceId(context.scope.resourceId);
    if (isInventoryContext(context)) {
      return collectInventory(this.operations, context);
    }
    return collectTelemetry(this.operations, context);
  }
}

function isInventoryContext(_context: CollectContext): boolean {
  return true;
}

export class DualFixtureAdapter implements ResourceInventoryPort, TelemetryPort {
  public readonly operations: CountingOperations;
  public constructor(
    scenario: FixtureScenarioName = 'healthy',
    private readonly allowedScope: ResourceRef = DEFAULT_ALLOWED_SCOPE,
  ) {
    this.operations = new CountingOperations(new FixtureOperations(loadFixtureScenario(scenario)));
  }
  public async collectInventory(context: CollectContext) {
    splitEcsResourceId(context.scope.resourceId);
    assertApprovedScope(context.scope, this.allowedScope);
    return collectInventory(this.operations, context);
  }
  public async collectTelemetry(context: CollectContext) {
    splitEcsResourceId(context.scope.resourceId);
    assertApprovedScope(context.scope, this.allowedScope);
    return collectTelemetry(this.operations, context);
  }
  public collect(_context: CollectContext): Promise<readonly CollectorObservation[]> {
    throw new Error('use collectInventory/collectTelemetry');
  }
}

export class FixtureInventory implements ResourceInventoryPort {
  public constructor(private readonly adapter: DualFixtureAdapter) {}
  public collect(context: CollectContext) {
    return this.adapter.collectInventory(context);
  }
}

export class FixtureTelemetry implements TelemetryPort {
  public constructor(private readonly adapter: DualFixtureAdapter) {}
  public collect(context: CollectContext) {
    return this.adapter.collectTelemetry(context);
  }
}

export function createFixturePorts(
  scenario: FixtureScenarioName = 'healthy',
  allowedScope: ResourceRef = DEFAULT_ALLOWED_SCOPE,
): {
  readonly inventory: ResourceInventoryPort;
  readonly telemetry: TelemetryPort;
  readonly calls: () => readonly string[];
} {
  const adapter = new DualFixtureAdapter(scenario, allowedScope);
  return {
    inventory: new FixtureInventory(adapter),
    telemetry: new FixtureTelemetry(adapter),
    calls: () => adapter.operations.calls,
  };
}

export type LiveAwsConfig = {
  readonly roleArn: string;
  readonly externalId: string;
  readonly region: string;
  readonly allowedScope: ResourceRef;
  readonly sessionSeconds?: number;
};

export { AWS_SESSION_SECONDS, OutOfScopeError };
export type { ResourceRef };
