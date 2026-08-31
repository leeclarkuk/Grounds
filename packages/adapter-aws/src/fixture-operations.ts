import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertJsonValue, isJsonObject, type JsonObject } from '@grounds/domain';
import type { AwsOperations, AwsPage, MetricQuery } from './operations.js';
import { asObject } from './operations.js';
import { pageOf } from './scope.js';
import type { InaccessibleErrorCode } from '@grounds/domain';

export type FixtureScenarioName =
  | 'healthy'
  | 'unhealthy-replacement'
  | 'missing-alarm'
  | 'partial-failure'
  | 'stale-metrics'
  | 'cross-scope'
  | 'pagination'
  | 'throttling';

export class FixtureUnavailableError extends Error {
  public override readonly name = 'FixtureUnavailableError';
  public constructor(
    public readonly operation: string,
    public readonly errorCode: InaccessibleErrorCode,
  ) {
    super(operation);
  }
}

export class FixtureOperations implements AwsOperations {
  public readonly calls: string[] = [];
  private readonly throttled = new Set<string>();

  public constructor(private readonly scenario: JsonObject) {}

  public describeServices(): Promise<JsonObject> {
    return Promise.resolve(this.read('describeServices'));
  }

  public listTasks(
    _input: { clusterName: string; serviceName: string; desiredStatus: 'RUNNING' | 'STOPPED' },
    nextToken: string | null,
  ): Promise<AwsPage> {
    return Promise.resolve(this.paged('listTasks', nextToken));
  }

  public describeTasks(): Promise<JsonObject> {
    return Promise.resolve(this.read('describeTasks'));
  }

  public describeTargetGroups(): Promise<JsonObject> {
    return Promise.resolve(this.read('describeTargetGroups'));
  }

  public describeTargetHealth(
    _input: { targetGroupArn: string },
    nextToken: string | null,
  ): Promise<AwsPage> {
    return Promise.resolve(this.paged('describeTargetHealth', nextToken));
  }

  public describeAlarms(nextToken: string | null): Promise<AwsPage> {
    return Promise.resolve(this.paged('describeAlarms', nextToken));
  }

  public getMetricData(_input: MetricQuery, nextToken: string | null): Promise<AwsPage> {
    return Promise.resolve(this.paged('getMetricData', nextToken));
  }

  public getCallerIdentity(): Promise<JsonObject> {
    return Promise.resolve(this.read('callerIdentity', { Account: '123456789012' }));
  }

  private read(key: string, fallback: JsonObject = {}): JsonObject {
    this.hit(key);
    const value = this.scenario[key];
    if (value !== undefined && isJsonObject(value) && value['inaccessible'] === true) {
      const code = typeof value['errorCode'] === 'string' ? value['errorCode'] : 'unavailable';
      throw new FixtureUnavailableError(key, code as InaccessibleErrorCode);
    }
    if (value !== undefined && isJsonObject(value) && typeof value['outOfScope'] === 'object') {
      return asObject(value);
    }
    return value !== undefined && isJsonObject(value) ? value : fallback;
  }

  private paged(key: string, nextToken: string | null): AwsPage {
    this.hit(key);
    const value = this.scenario[key];
    if (value !== undefined && isJsonObject(value) && value['inaccessible'] === true) {
      const code = typeof value['errorCode'] === 'string' ? value['errorCode'] : 'unavailable';
      throw new FixtureUnavailableError(key, code as InaccessibleErrorCode);
    }
    if (Array.isArray(value)) {
      const pages = value.filter(isJsonObject);
      if (nextToken === null) {
        return pageOf(pages[0] ?? {}, 'nextToken');
      }
      const index = Number(nextToken);
      return pageOf(pages[index] ?? {}, 'nextToken');
    }
    return pageOf(value !== undefined && isJsonObject(value) ? value : {}, 'nextToken');
  }

  private hit(operation: string): void {
    this.calls.push(operation);
    const throttle = this.scenario['throttleOperations'];
    if (Array.isArray(throttle) && throttle.includes(operation) && !this.throttled.has(operation)) {
      this.throttled.add(operation);
      throw new FixtureUnavailableError(operation, 'throttled');
    }
  }
}

export function loadFixtureScenario(name: FixtureScenarioName): JsonObject {
  const file = join(resolveFixturesDir(), `${name}.json`);
  const parsed = assertJsonValue(JSON.parse(readFileSync(file, 'utf8')));
  if (!isJsonObject(parsed)) {
    throw new Error(`fixture ${name} is not an object`);
  }
  return parsed;
}

export function resolveFixturesDir(): string {
  const fromEnv = process.env['GROUNDS_FIXTURES_DIR'];
  if (fromEnv) {
    return fromEnv;
  }
  let current = process.cwd();
  for (let index = 0; index < 10; index += 1) {
    const candidate = join(current, 'fixtures/aws/ecs');
    try {
      readFileSync(join(candidate, 'healthy.json'), 'utf8');
      return candidate;
    } catch {
      current = dirname(current);
    }
  }
  return join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/aws/ecs');
}
