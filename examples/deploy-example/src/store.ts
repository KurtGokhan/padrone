import type { Deployment, Environment, Service } from './types.ts';

let deployId = 1;

const environments: Environment[] = [
  { name: 'staging', url: 'https://staging.example.com', region: 'us-east-1', production: false, createdAt: '2024-01-01T00:00:00Z' },
  { name: 'production', url: 'https://app.example.com', region: 'us-west-2', production: true, createdAt: '2024-01-01T00:00:00Z' },
];

const services: Service[] = [
  { name: 'api', image: 'myorg/api:v1.2.0', port: 8080, replicas: 3, status: 'running', createdAt: '2024-01-10T00:00:00Z' },
  { name: 'web', image: 'myorg/web:v2.0.1', port: 3000, replicas: 2, status: 'running', createdAt: '2024-01-10T00:00:00Z' },
  { name: 'worker', image: 'myorg/worker:v1.0.0', port: 9090, replicas: 1, status: 'stopped', createdAt: '2024-02-15T00:00:00Z' },
];

const deployments: Deployment[] = [
  {
    id: 'deploy-1',
    env: 'staging',
    service: 'api',
    version: 'v1.2.0',
    status: 'success',
    startedAt: '2024-03-01T10:00:00Z',
    finishedAt: '2024-03-01T10:05:00Z',
  },
];

// --- Environments ---

export function getEnvironments(): Environment[] {
  return [...environments];
}

export function getEnvironment(name: string): Environment | undefined {
  return environments.find((e) => e.name === name);
}

export function addEnvironment(input: { name: string; url: string; region: string; production: boolean }): Environment {
  if (getEnvironment(input.name)) throw new Error(`Environment "${input.name}" already exists`);
  const env: Environment = { ...input, createdAt: new Date().toISOString() };
  environments.push(env);
  return env;
}

export function removeEnvironment(name: string, force = false): boolean {
  const idx = environments.findIndex((e) => e.name === name);
  if (idx === -1) throw new Error(`Environment "${name}" not found`);
  if (environments[idx]!.production && !force) {
    throw new Error(`Cannot remove production environment "${name}". Use --force to override.`);
  }
  environments.splice(idx, 1);
  return true;
}

// --- Services ---

export function getServices(): Service[] {
  return [...services];
}

export function getService(name: string): Service | undefined {
  return services.find((s) => s.name === name);
}

export function addService(input: { name: string; image: string; port: number; replicas: number }): Service {
  if (getService(input.name)) throw new Error(`Service "${input.name}" already exists`);
  const svc: Service = { ...input, status: 'stopped', createdAt: new Date().toISOString() };
  services.push(svc);
  return svc;
}

export function scaleService(name: string, replicas: number): Service {
  const svc = services.find((s) => s.name === name);
  if (!svc) throw new Error(`Service "${name}" not found`);
  svc.replicas = replicas;
  return svc;
}

// --- Deployments ---

export function getDeployments(filters?: { env?: string; service?: string; limit?: number }): Deployment[] {
  let result = [...deployments];
  if (filters?.env) result = result.filter((d) => d.env === filters.env);
  if (filters?.service) result = result.filter((d) => d.service === filters.service);
  result.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  if (filters?.limit) result = result.slice(0, filters.limit);
  return result;
}

export function createDeployment(env: string, service: string, version: string): Deployment {
  if (!getEnvironment(env)) throw new Error(`Environment "${env}" not found`);
  if (!getService(service)) throw new Error(`Service "${service}" not found`);
  const svc = services.find((s) => s.name === service);
  if (svc) svc.status = 'deploying';
  const deployment: Deployment = {
    id: `deploy-${++deployId}`,
    env,
    service,
    version,
    status: 'pending',
    startedAt: new Date().toISOString(),
  };
  deployments.push(deployment);
  return deployment;
}

export function finishDeployment(id: string, status: 'success' | 'failed'): Deployment {
  const deployment = deployments.find((d) => d.id === id);
  if (!deployment) throw new Error(`Deployment "${id}" not found`);
  deployment.status = status;
  deployment.finishedAt = new Date().toISOString();
  const svc = services.find((s) => s.name === deployment.service);
  if (svc) svc.status = status === 'success' ? 'running' : 'failed';
  return deployment;
}

export function rollbackDeployment(env: string, service: string): Deployment {
  const latest = deployments
    .filter((d) => d.env === env && d.service === service && d.status === 'success')
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (!latest) throw new Error(`No successful deployment found for "${service}" in "${env}"`);
  latest.status = 'rolled-back';
  const svc = services.find((s) => s.name === service);
  if (svc) svc.status = 'stopped';
  return latest;
}
