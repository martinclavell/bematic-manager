export interface Project {
  id: string;
  name: string;
  slackChannelId: string;
  localPath: string;
  agentId: string;
  defaultModel: string;
  defaultMaxBudget: number;
  railwayProjectId: string | null;
  railwayServiceId: string | null;
  railwayEnvironmentId: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectCreateInput {
  name: string;
  slackChannelId: string;
  localPath: string;
  agentId: string;
  defaultModel?: string;
  defaultMaxBudget?: number;
  railwayProjectId?: string | null;
  railwayServiceId?: string | null;
  railwayEnvironmentId?: string | null;
}
