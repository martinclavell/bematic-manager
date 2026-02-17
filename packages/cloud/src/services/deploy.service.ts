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

    // serviceInstanceRedeploy returns a boolean
    await this.gql<{ serviceInstanceRedeploy: boolean }>(
      `mutation ($serviceId: String!, $environmentId: String!) {
        serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId)
      }`,
      { serviceId, environmentId: environmentId ?? undefined },
    );

    // Fetch the latest deployment to get its ID and status
    const deployment = await this.getLatestDeployment(serviceId, environmentId);

    const result: DeployResult = {
      deploymentId: deployment?.id ?? 'unknown',
      status: deployment?.status ?? 'TRIGGERED',
      url: deployment?.staticUrl,
    };

    logger.info({ deploymentId: result.deploymentId, status: result.status }, 'Deployment triggered');
    return result;
  }

  /** Get the status of the latest deployment for a service */
  async getLatestDeployment(
    serviceId: string,
    environmentId?: string | null,
  ): Promise<DeploymentStatus | null> {
    const input: Record<string, string> = { serviceId };
    if (environmentId) input['environmentId'] = environmentId;

    const data = await this.gql<{
      deployments: { edges: Array<{ node: { id: string; status: string; createdAt: string; staticUrl: string | null } }> };
    }>(
      `query ($input: DeploymentListInput!, $first: Int) {
        deployments(input: $input, first: $first) {
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
      { input, first: 1 },
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
      `query ($deploymentId: String!, $limit: Int) {
        deploymentLogs(deploymentId: $deploymentId, limit: $limit) {
          message
          timestamp
          severity
        }
      }`,
      { deploymentId, limit: 50 },
    );

    if (!data.deploymentLogs?.length) {
      return '(no logs available)';
    }

    return data.deploymentLogs
      .map((l) => `[${l.severity}] ${l.message}`)
      .join('\n');
  }
}
