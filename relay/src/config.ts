import { DEFAULT_RELAY_PORT } from '../../packages/shared/src';

export interface RelayConfig {
  port: number;
  jwtSecret: string;
  corsOrigins: string | string[];
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export function loadConfig(): RelayConfig {
  return {
    port: parseInt(process.env.RELAY_PORT || String(DEFAULT_RELAY_PORT), 10),
    jwtSecret: process.env.JWT_SECRET || 'nexus-dev-secret-change-in-production',
    corsOrigins: process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(',').map((s) => s.trim())
      : '*',
    logLevel: (process.env.LOG_LEVEL as RelayConfig['logLevel']) || 'info',
  };
}

const config = loadConfig();
export default config;
