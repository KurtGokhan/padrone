export type Environment = {
  name: string;
  url: string;
  region: string;
  production: boolean;
  createdAt: string;
};

export type Service = {
  name: string;
  image: string;
  port: number;
  replicas: number;
  status: 'running' | 'stopped' | 'deploying' | 'failed';
  createdAt: string;
};

export type Deployment = {
  id: string;
  env: string;
  service: string;
  version: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'rolled-back';
  startedAt: string;
  finishedAt?: string;
};

export type User = {
  name: string;
  role: 'admin' | 'developer' | 'viewer';
};
