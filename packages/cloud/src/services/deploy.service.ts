import { createLogger } from '@bematic/common';

const logger = createLogger('deploy-service');

const RAILWAY_API = 'https://backboard.railway.com/graphql/v2';

interface DeployResult {
  deploymentId: string;
  status: string;
  url?: string;
}

interface DeploymentStatus {
  id: string;
  status: string;
  createdAt: string;
  url?: string;
  staticUrl?: string;
}

export class DeployService {
  constructor(private readonly apiToken: string) {}

  private async gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const res = await fetch(RAILWAY_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiToken}`,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Railway API error (${res.status}): ${text}`);
    }

    const json = await res.json() as { data?: T; errors?: Array<{ message: string }> };
    if (json.errors?.length) {
      throw new Error(`Railway API: ${json.errors.map((e) => e.message).join(', ')}`);
    }
    if (!json.data) {
      throw new Error('Railway API returned no data');
    }
    return json.data;
  }

  isConfigured(): boolean {
    return !!this.apiToken;
  }

  /** Trigger a redeployment of a service */
  async deploy(
    serviceId: string,
    environmentId?: string | null,
  ): Promise<DeployResult> {
    logger.info({ serviceId, environmentId }, 'Triggering Railway deployment');

    // Get the latest deployment to redeploy
    const envFilter = environmentId ? `, environmentId: "${environmentId}"` : '';

    const data = await this.gql<{
      serviceDeployRedeploy: { id: string; status: string; staticUrl: string | null };
    }>(
      `mutation {
        serviceDeployRedeploy(
          serviceId: "${serviceId}"
          ${envFilter}
        ) {
          id
          status
          staticUrl
        }
      }`,
    );

    const dep = data.serviceDeployRedeploy;
    logger.info({ deploymentId: dep.id, status: dep.status }, 'Deployment triggered');

    return {
      deploymentId: dep.id,
      status: dep.status,
      url: dep.staticUrl ?? undefined,
    };
  }

  /** Get the status of the latest deployment for a service */
  async getLatestDeployment(
    serviceId: string,
    environmentId?: string | null,
  ): Promise<DeploymentStatus | null> {
    const envFilter = environmentId ? `, input: { environmentId: "${environmentId}" }` : '';

    const data = await this.gql<{
      deployments: { edges: Array<{ node: { id: string; status: string; createdAt: string; staticUrl: string | null } }> };
    }>(
      `query {
        deployments(first: 1, serviceId: "${serviceId}" ${envFilter}) {
          edges {
            node {
              id
              status
              createdAt
              staticUrl
            }
          }
        }
      }`,
    );

    const edge = data.deployments.edges[0];
    if (!edge) return null;

    const node = edge.node;
    return {
      id: node.id,
      status: node.status,
      createdAt: node.createdAt,
      staticUrl: node.staticUrl ?? undefined,
    };
  }

  /** Get build/deploy logs for a deployment */
  async getDeploymentLogs(deploymentId: string): Promise<string> {
    const data = await this.gql<{
      deploymentLogs: Array<{ message: string; timestamp: string; severity: string }>;
    }>(
      `query {
        deploymentLogs(deploymentId: "${deploymentId}", limit: 50) {
          message
          timestamp
          severity
        }
      }`,
    );

    if (!data.deploymentLogs?.length) {
      return '(no logs available)';
    }

    return data.deploymentLogs
      .map((l) => `[${l.severity}] ${l.message}`)
      .join('\n');
  }
}
