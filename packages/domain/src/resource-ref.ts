import { splitEcsResourceId } from './ecs.js';

export const PROVIDER = 'aws' as const;
export type Provider = typeof PROVIDER;

export const RESOURCE_SERVICE = 'ecs' as const;
export const RESOURCE_TYPE = 'service' as const;

export type ResourceRef = {
  readonly provider: Provider;
  readonly accountId: string;
  readonly region: string;
  readonly service: typeof RESOURCE_SERVICE;
  readonly resourceType: typeof RESOURCE_TYPE;
  readonly resourceId: string;
};

const ACCOUNT_ID = /^[0-9]{12}$/;
const REGION = /^[a-z]{2}-[a-z]+-[0-9]+$/;

export function parseResourceRef(value: unknown): ResourceRef {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('resource ref must be an object');
  }
  const record = value as { readonly [key: string]: unknown };
  const provider = requiredString(record, 'provider');
  const accountId = requiredString(record, 'accountId');
  const region = requiredString(record, 'region');
  const service = requiredString(record, 'service');
  const resourceType = requiredString(record, 'resourceType');
  const resourceId = requiredString(record, 'resourceId');
  if (provider !== PROVIDER) {
    throw new Error('provider must be aws');
  }
  if (!ACCOUNT_ID.test(accountId)) {
    throw new Error('accountId must be a 12-digit AWS account id');
  }
  if (!REGION.test(region)) {
    throw new Error('region is not an AWS region id');
  }
  if (service !== RESOURCE_SERVICE) {
    throw new Error('service must be ecs');
  }
  if (resourceType !== RESOURCE_TYPE) {
    throw new Error('resourceType must be service');
  }
  splitEcsResourceId(resourceId);
  return { provider, accountId, region, service, resourceType, resourceId };
}

export function resourceRefsEqual(left: ResourceRef, right: ResourceRef): boolean {
  return (
    left.accountId === right.accountId &&
    left.region === right.region &&
    left.resourceId === right.resourceId
  );
}

function requiredString(record: { readonly [key: string]: unknown }, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${key} is required`);
  }
  return value;
}
