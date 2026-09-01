export const ECS_NAME = /^[A-Za-z0-9_-]{1,255}$/;

export type EcsServiceIdentity = {
  readonly clusterName: string;
  readonly serviceName: string;
};

export function splitEcsResourceId(resourceId: string): EcsServiceIdentity {
  const parts = resourceId.split('/');
  if (parts.length !== 2) {
    throw new Error('resourceId must be clusterName/serviceName');
  }
  const clusterName = parts[0];
  const serviceName = parts[1];
  if (!clusterName || !serviceName || !ECS_NAME.test(clusterName) || !ECS_NAME.test(serviceName)) {
    throw new Error('cluster or service name is invalid');
  }
  return { clusterName, serviceName };
}

export function ecsResourceId(clusterName: string, serviceName: string): string {
  if (!ECS_NAME.test(clusterName) || !ECS_NAME.test(serviceName)) {
    throw new Error('cluster or service name is invalid');
  }
  return `${clusterName}/${serviceName}`;
}
