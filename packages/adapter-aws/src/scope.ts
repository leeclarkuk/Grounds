import {
  OutOfScopeError,
  assertInScope,
  isJsonArray,
  isJsonObject,
  splitEcsResourceId,
  type JsonObject,
  type JsonValue,
  type ResourceRef,
} from '@grounds/domain';
import { type AwsPage } from './operations.js';
import { readString } from './fields.js';

export const DEFAULT_ALLOWED_SCOPE: ResourceRef = {
  provider: 'aws',
  accountId: '123456789012',
  region: 'eu-west-2',
  service: 'ecs',
  resourceType: 'service',
  resourceId: 'payments-cluster/payments',
};

export function assertApprovedScope(requested: ResourceRef, allowed: ResourceRef): void {
  assertInScope(requested, allowed);
}

export function assertCallerAccount(accountId: string, scope: ResourceRef): void {
  if (accountId !== scope.accountId) {
    throw new OutOfScopeError(scope, scope);
  }
}

export function assertServiceInScope(scope: ResourceRef, service: JsonObject): void {
  const identity = splitEcsResourceId(scope.resourceId);
  const arn = readString(service, 'serviceArn', 'ServiceArn');
  const account = accountFromArn(arn) ?? scope.accountId;
  const region = regionFromArn(arn) ?? scope.region;
  const name = readString(service, 'serviceName', 'ServiceName');
  const clusterArn = readString(service, 'clusterArn', 'ClusterArn');
  const clusterName = clusterNameFromArn(clusterArn);
  if (
    account !== scope.accountId ||
    region !== scope.region ||
    name !== identity.serviceName ||
    (clusterName !== undefined && clusterName !== identity.clusterName)
  ) {
    throw new OutOfScopeError(scope, scope);
  }
}

export function assertTargetGroupInScope(scope: ResourceRef, arn: string): void {
  const account = accountFromArn(arn);
  const region = regionFromArn(arn);
  if (
    (account !== undefined && account !== scope.accountId) ||
    (region !== undefined && region !== scope.region)
  ) {
    throw new OutOfScopeError(scope, scope);
  }
}

export function accountFromArn(arn: string): string | undefined {
  const parts = arn.split(':');
  return parts.length >= 5 && /^\d{12}$/.test(parts[4] ?? '') ? parts[4] : undefined;
}

export function regionFromArn(arn: string): string | undefined {
  const parts = arn.split(':');
  return parts.length >= 4 && parts[3] ? parts[3] : undefined;
}

export function clusterNameFromArn(arn: string): string | undefined {
  const suffix = arn.split('/').pop();
  return suffix && suffix.length > 0 ? suffix : undefined;
}

export function stringList(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string').sort();
}

export function objectList(value: JsonValue | undefined): JsonObject[] {
  if (!isJsonArray(value)) {
    return [];
  }
  return value.filter((item): item is JsonObject => isJsonObject(item));
}

export function pageOf(payload: JsonObject, tokenKey = 'nextToken'): AwsPage {
  const token = payload[tokenKey];
  return {
    payload,
    nextToken: typeof token === 'string' && token.length > 0 ? token : null,
  };
}
