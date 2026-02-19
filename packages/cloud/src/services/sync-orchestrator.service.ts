import EventEmitter from 'node:events';
import {
  createLogger,
  generateId,
} from '@bematic/common';
import type { TaskRepository, ProjectRepository, AuditLogRepository } from '@bematic/db';
import type { NotificationService } from './notification.service.js';
import type { OpsService } from './ops.service.js';
import type { AgentManager } from '../gateway/agent-manager.js';

const logger = createLogger('sync-orchestrator');

/** Represents a single sync workflow execution */
interface SyncWorkflow {
  id: string;
  projectId: string;
  agentId: string;
  slackChannelId: string;
  slackThreadTs: string | null;
  requestedBy: string;
  status: 'pending' | 'testing' | 'building' | 'restarting' | 'deploying' | 'completed' | 'failed';
  testTaskId: string | null;
  buildTaskId: string | null;
  deployRequestId: string | null;
  createdAt: number;
  completedAt: number | null;
  error: string | null;
}

/**
 * Enterprise-grade sync orchestrator that coordinates test → build → restart → deploy workflows.
 *
 * Uses event-driven architecture to properly sequence steps based on actual task completion
 * and agent reconnection events, eliminating race conditions and timing assumptions.
 */
export class SyncOrchestrator extends EventEmitter {
  private workflows = new Map<string, SyncWorkflow>();
  private taskToWorkflowMap = new Map<string, string>(); // taskId -> workflowId
  private deployToWorkflowMap = new Map<string, string>(); // deployRequestId -> workflowId
  private cleanupInterval: NodeJS.Timeout;

  constructor(
    private readonly taskRepo: TaskRepository,
    private readonly projectRepo: ProjectRepository,
    private readonly auditLogRepo: AuditLogRepository,
    private readonly notifier: NotificationService,
    private readonly opsService: OpsService,
    private readonly agentManager: AgentManager,
  ) {
    super();

    // Clean up completed workflows every 10 minutes
    this.cleanupInterval = setInterval(() => this.cleanupOldWorkflows(), 600_000);
  }

  /**
   * Start a new sync workflow
   * Returns the workflow ID for tracking
   */
  async startSync(
    projectId: string,
    agentId: string,
    slackChannelId: string,
    slackThreadTs: string | null,
    requestedBy: string,
  ): Promise<string> {
    const workflowId = generateId('sync');

    const workflow: SyncWorkflow = {
      id: workflowId,
      projectId,
      agentId,
      slackChannelId,
      slackThreadTs,
      requestedBy,
      status: 'pending',
      testTaskId: null,
      buildTaskId: null,
      deployRequestId: null,
      createdAt: Date.now(),
      completedAt: null,
      error: null,
    };

    this.workflows.set(workflowId, workflow);

    logger.info(
      { workflowId, projectId, agentId, requestedBy },
      'Sync workflow started',
    );

    this.auditLogRepo.log(
      'sync:started',
      'project',
      projectId,
      requestedBy,
      { workflowId, agentId },
    );

    return workflowId;
  }

  /**
   * Register test task for a workflow
   */
  registerTestTask(workflowId: string, testTaskId: string): void {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      logger.warn({ workflowId, testTaskId }, 'Workflow not found for test task');
      return;
    }

    workflow.testTaskId = testTaskId;
    workflow.status = 'testing';
    this.taskToWorkflowMap.set(testTaskId, workflowId);

    logger.info({ workflowId, testTaskId }, 'Test task registered');
  }

  /**
   * Register build task for a workflow
   */
  registerBuildTask(workflowId: string, buildTaskId: string): void {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      logger.warn({ workflowId, buildTaskId }, 'Workflow not found for build task');
      return;
    }

    workflow.buildTaskId = buildTaskId;
    this.taskToWorkflowMap.set(buildTaskId, workflowId);

    logger.info({ workflowId, buildTaskId }, 'Build task registered');
  }

  /**
   * Handle task completion event from MessageRouter
   * This is called whenever ANY task completes
   */
  async onTaskComplete(taskId: string, success: boolean): Promise<void> {
    const workflowId = this.taskToWorkflowMap.get(taskId);
    if (!workflowId) {
      // Not a sync workflow task, ignore
      return;
    }

    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      logger.warn({ workflowId, taskId }, 'Workflow not found for completed task');
      return;
    }

    logger.info(
      { workflowId, taskId, success, currentStatus: workflow.status },
      'Task completed in sync workflow',
    );

    // Handle based on which task completed
    if (taskId === workflow.testTaskId) {
      await this.handleTestComplete(workflow, success);
    } else if (taskId === workflow.buildTaskId) {
      await this.handleBuildComplete(workflow, success);
    }
  }

  /**
   * Handle deploy completion event from MessageRouter.
   * Called when a DEPLOY_RESULT is received for any deploy request.
   */
  async onDeployComplete(deployRequestId: string, success: boolean): Promise<void> {
    const workflowId = this.deployToWorkflowMap.get(deployRequestId);
    if (!workflowId) {
      // Not a sync workflow deploy, ignore
      return;
    }

    this.deployToWorkflowMap.delete(deployRequestId);

    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      logger.warn({ workflowId, deployRequestId }, 'Workflow not found for deploy result');
      return;
    }

    logger.info(
      { workflowId, deployRequestId, success },
      'Deploy completed in sync workflow',
    );

    if (success) {
      await this.completeWorkflow(workflow);
    } else {
      await this.failWorkflow(
        workflow,
        'Deployment failed',
        ':x: Deployment failed. Sync workflow aborted.',
      );
    }
  }

  /**
   * Handle test task completion
   */
  private async handleTestComplete(workflow: SyncWorkflow, success: boolean): Promise<void> {
    if (!success) {
      await this.failWorkflow(
        workflow,
        'Tests failed. Sync aborted.',
        ':x: Tests failed. Sync workflow aborted.',
      );
      return;
    }

    // Check if build is also complete (both tasks run in parallel)
    const buildComplete = workflow.buildTaskId
      ? this.isTaskComplete(workflow.buildTaskId)
      : false;

    await this.notifier.postMessage(
      workflow.slackChannelId,
      `:white_check_mark: Tests passed${buildComplete ? '' : ' — waiting for build...'}`,
      workflow.slackThreadTs,
    );

    // If build is also complete, proceed to restart
    if (buildComplete) {
      await this.proceedToRestart(workflow);
    }
  }

  /**
   * Handle build task completion
   */
  private async handleBuildComplete(workflow: SyncWorkflow, success: boolean): Promise<void> {
    if (!success) {
      await this.failWorkflow(
        workflow,
        'Build failed. Sync aborted.',
        ':x: Build failed. Sync workflow aborted.',
      );
      return;
    }

    // Check if tests are also complete (both tasks run in parallel)
    const testComplete = workflow.testTaskId
      ? this.isTaskComplete(workflow.testTaskId)
      : true; // If no test task, consider it complete

    await this.notifier.postMessage(
      workflow.slackChannelId,
      `:white_check_mark: Build completed${testComplete ? '' : ' — waiting for tests...'}`,
      workflow.slackThreadTs,
    );

    // If tests are also complete (or no test task), proceed to restart
    if (testComplete) {
      await this.proceedToRestart(workflow);
    }
  }

  /**
   * Proceed to agent restart phase
   */
  private async proceedToRestart(workflow: SyncWorkflow): Promise<void> {
    workflow.status = 'restarting';

    await this.notifier.postMessage(
      workflow.slackChannelId,
      ':arrows_counterclockwise: Restarting agent...',
      workflow.slackThreadTs,
    );

    const { restarted } = this.opsService.sendRestart({
      agentIds: [workflow.agentId],
      reason: `Sync workflow ${workflow.id} requested by <@${workflow.requestedBy}>`,
      rebuild: false,
    });

    if (restarted === 0) {
      await this.failWorkflow(
        workflow,
        'Failed to send restart signal to agent',
        ':x: Failed to restart agent. Sync workflow aborted.',
      );
      return;
    }

    logger.info({ workflowId: workflow.id, agentId: workflow.agentId }, 'Restart signal sent');

    // Set up listener for agent reconnection
    this.waitForAgentReconnection(workflow);
  }

  /**
   * Wait for agent to reconnect after restart.
   * Two-phase: first wait for the agent to go OFFLINE (old connection dies),
   * then wait for it to come back ONLINE (new connection established).
   * This prevents sending a deploy request to the dying old connection.
   */
  private waitForAgentReconnection(workflow: SyncWorkflow): void {
    const timeout = 120_000; // 2 minutes total timeout
    const startTime = Date.now();
    let sawOffline = false;

    const checkInterval = setInterval(async () => {
      const online = this.agentManager.isOnline(workflow.agentId);

      // Phase 1: wait for agent to go offline
      if (!sawOffline) {
        if (!online) {
          sawOffline = true;
          logger.info({ workflowId: workflow.id, agentId: workflow.agentId }, 'Agent went offline, waiting for reconnection');
        }
        // Still online on old connection — keep waiting
        if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval);
          await this.failWorkflow(
            workflow,
            'Agent did not disconnect after restart signal',
            ':x: Agent did not restart. Sync workflow aborted.',
          );
        }
        return;
      }

      // Phase 2: wait for agent to come back online
      if (online) {
        clearInterval(checkInterval);
        logger.info({ workflowId: workflow.id, agentId: workflow.agentId }, 'Agent reconnected');
        await this.proceedToDeploy(workflow);
        return;
      }

      // Check timeout
      if (Date.now() - startTime > timeout) {
        clearInterval(checkInterval);
        await this.failWorkflow(
          workflow,
          'Agent did not reconnect within timeout',
          ':x: Agent did not reconnect after restart. Sync workflow aborted.',
        );
      }
    }, 2000); // Check every 2 seconds
  }

  /**
   * Proceed to deployment phase
   */
  private async proceedToDeploy(workflow: SyncWorkflow): Promise<void> {
    workflow.status = 'deploying';

    await this.notifier.postMessage(
      workflow.slackChannelId,
      ':rocket: Agent restarted. Starting deployment...',
      workflow.slackThreadTs,
    );

    const project = this.projectRepo.findById(workflow.projectId);
    if (!project) {
      await this.failWorkflow(
        workflow,
        'Project not found',
        ':x: Project configuration not found. Sync workflow aborted.',
      );
      return;
    }

    const { requestId: deployRequestId, sent } = this.opsService.sendDeploy({
      project,
      agentId: workflow.agentId,
      slackChannelId: workflow.slackChannelId,
      slackThreadTs: workflow.slackThreadTs,
      requestedBy: workflow.requestedBy,
    });
    workflow.deployRequestId = deployRequestId;

    if (!sent) {
      await this.failWorkflow(
        workflow,
        'Failed to send deploy request to agent',
        ':x: Failed to send deploy request. Sync workflow aborted.',
      );
      return;
    }

    logger.info(
      { workflowId: workflow.id, deployRequestId, agentId: workflow.agentId },
      'Deploy request sent',
    );

    // Register mapping so onDeployComplete can find this workflow
    this.deployToWorkflowMap.set(deployRequestId, workflow.id);

    // Safety timeout: if deploy result never comes back, fail the workflow
    setTimeout(async () => {
      if (workflow.status === 'deploying') {
        this.deployToWorkflowMap.delete(deployRequestId);
        await this.failWorkflow(
          workflow,
          'Deploy timed out — no result received from agent',
          ':x: Deploy timed out after 5 minutes. Check agent logs.',
        );
      }
    }, 300_000);
  }

  /**
   * Mark workflow as completed successfully
   */
  private async completeWorkflow(workflow: SyncWorkflow): Promise<void> {
    workflow.status = 'completed';
    workflow.completedAt = Date.now();

    const durationMs = workflow.completedAt - workflow.createdAt;

    logger.info(
      { workflowId: workflow.id, durationMs },
      'Sync workflow completed',
    );

    this.auditLogRepo.log(
      'sync:completed',
      'project',
      workflow.projectId,
      workflow.requestedBy,
      {
        workflowId: workflow.id,
        durationMs,
        testTaskId: workflow.testTaskId,
        buildTaskId: workflow.buildTaskId,
        deployRequestId: workflow.deployRequestId,
      },
    );

    this.emit('workflow:completed', workflow);
  }

  /**
   * Mark workflow as failed
   */
  private async failWorkflow(
    workflow: SyncWorkflow,
    error: string,
    slackMessage: string,
  ): Promise<void> {
    workflow.status = 'failed';
    workflow.error = error;
    workflow.completedAt = Date.now();

    logger.error(
      { workflowId: workflow.id, error },
      'Sync workflow failed',
    );

    await this.notifier.postMessage(
      workflow.slackChannelId,
      slackMessage,
      workflow.slackThreadTs,
    );

    this.auditLogRepo.log(
      'sync:failed',
      'project',
      workflow.projectId,
      workflow.requestedBy,
      {
        workflowId: workflow.id,
        error,
        testTaskId: workflow.testTaskId,
        buildTaskId: workflow.buildTaskId,
      },
    );

    this.emit('workflow:failed', workflow);
  }

  /**
   * Check if a task is complete
   */
  private isTaskComplete(taskId: string): boolean {
    const task = this.taskRepo.findById(taskId);
    return task?.status === 'completed' || task?.status === 'failed';
  }

  /**
   * Clean up old completed/failed workflows (keep for 1 hour)
   */
  private cleanupOldWorkflows(): void {
    const cutoff = Date.now() - 3600_000; // 1 hour
    let cleaned = 0;

    for (const [workflowId, workflow] of this.workflows.entries()) {
      if (
        (workflow.status === 'completed' || workflow.status === 'failed') &&
        workflow.completedAt &&
        workflow.completedAt < cutoff
      ) {
        // Clean up task mappings
        if (workflow.testTaskId) {
          this.taskToWorkflowMap.delete(workflow.testTaskId);
        }
        if (workflow.buildTaskId) {
          this.taskToWorkflowMap.delete(workflow.buildTaskId);
        }
        if (workflow.deployRequestId) {
          this.deployToWorkflowMap.delete(workflow.deployRequestId);
        }

        this.workflows.delete(workflowId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info({ cleaned, remaining: this.workflows.size }, 'Cleaned up old sync workflows');
    }
  }

  /**
   * Get workflow status
   */
  getWorkflow(workflowId: string): SyncWorkflow | undefined {
    return this.workflows.get(workflowId);
  }

  /**
   * Get all active workflows
   */
  getActiveWorkflows(): SyncWorkflow[] {
    return Array.from(this.workflows.values()).filter(
      (w) => w.status !== 'completed' && w.status !== 'failed',
    );
  }

  /**
   * Stop the orchestrator and clean up resources
   */
  stop(): void {
    clearInterval(this.cleanupInterval);
    this.workflows.clear();
    this.taskToWorkflowMap.clear();
    this.deployToWorkflowMap.clear();
    logger.info('Sync orchestrator stopped');
  }
}
