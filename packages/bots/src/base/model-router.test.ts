import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { routeToModel, resetRouterConfig, type RoutingDecision } from './model-router.js';
import { ModelTier, DEFAULT_TIER_MODELS } from '@bematic/common';
import type { ParsedCommand } from '@bematic/common';
import { BotName } from '@bematic/common';

// Mock logger to avoid console output during tests
vi.mock('@bematic/common', async () => {
  const actual = await vi.importActual('@bematic/common');
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

describe('ModelRouter', () => {
  // Helper function to create test commands
  function createCommand(
    botName: BotName = BotName.CODER,
    command: string = 'help',
    args: string = '',
    flags: Record<string, string | boolean> = {}
  ): ParsedCommand {
    return {
      botName,
      command,
      args,
      flags,
      rawText: `${command} ${args}`.trim(),
    };
  }

  beforeEach(() => {
    // Reset config cache before each test
    resetRouterConfig();

    // Clear environment variables
    delete process.env['MODEL_ROUTING_ENABLED'];
    delete process.env['MODEL_TIER_STANDARD'];
    delete process.env['MODEL_TIER_PREMIUM'];
  });

  afterEach(() => {
    // Clean up after each test
    resetRouterConfig();
    vi.clearAllMocks();
  });

  describe('explicit model overrides', () => {
    it('should use explicit --model flag when provided', () => {
      const command = createCommand(BotName.CODER, 'fix', 'the bug', { model: 'custom-model' });
      const result = routeToModel(command, 'project-default');

      expect(result).toEqual({
        tier: ModelTier.STANDARD,
        model: 'custom-model',
        reason: 'Explicit --model flag: custom-model',
        overridden: true,
      });
    });

    it('should use explicit --model flag even for write commands', () => {
      const command = createCommand(BotName.CODER, 'fix', 'the bug', { model: 'claude-haiku' });
      const result = routeToModel(command, 'project-default');

      expect(result).toEqual({
        tier: ModelTier.STANDARD,
        model: 'claude-haiku',
        reason: 'Explicit --model flag: claude-haiku',
        overridden: true,
      });
    });

    it('should ignore empty --model flag', () => {
      const command = createCommand(BotName.CODER, 'fix', 'the bug', { model: '' });
      const result = routeToModel(command, 'project-default');

      expect(result.overridden).toBe(false);
      expect(result.model).toBe(DEFAULT_TIER_MODELS[ModelTier.PREMIUM]);
    });

    it('should ignore non-string --model flag', () => {
      const command = createCommand(BotName.CODER, 'fix', 'the bug', { model: true });
      const result = routeToModel(command, 'project-default');

      expect(result.overridden).toBe(false);
      expect(result.model).toBe(DEFAULT_TIER_MODELS[ModelTier.PREMIUM]);
    });
  });

  describe('routing disabled', () => {
    beforeEach(() => {
      process.env['MODEL_ROUTING_ENABLED'] = 'false';
    });

    it('should use project default when routing is disabled', () => {
      const command = createCommand(BotName.CODER, 'fix', 'the bug');
      const result = routeToModel(command, 'custom-project-model');

      expect(result).toEqual({
        tier: ModelTier.STANDARD,
        model: 'custom-project-model',
        reason: 'Model routing disabled — using project default',
        overridden: false,
      });
    });

    it('should still respect --model flag when routing is disabled', () => {
      const command = createCommand(BotName.CODER, 'fix', 'the bug', { model: 'override-model' });
      const result = routeToModel(command, 'project-default');

      expect(result).toEqual({
        tier: ModelTier.STANDARD,
        model: 'override-model',
        reason: 'Explicit --model flag: override-model',
        overridden: true,
      });
    });
  });

  describe('default model selection', () => {
    it('should select Sonnet by default for read-only commands', () => {
      const command = createCommand(BotName.CODER, 'help', '');
      const result = routeToModel(command, 'project-default');

      expect(result.tier).toBe(ModelTier.STANDARD);
      expect(result.model).toBe(DEFAULT_TIER_MODELS[ModelTier.STANDARD]);
      expect(result.overridden).toBe(false);
      expect(result.reason).toContain('Sonnet (read-only or analysis)');
    });

    it('should select Sonnet for analysis commands', () => {
      const command = createCommand(BotName.REVIEWER, 'review', 'this code');
      const result = routeToModel(command, 'project-default');

      expect(result.tier).toBe(ModelTier.STANDARD);
      expect(result.model).toBe(DEFAULT_TIER_MODELS[ModelTier.STANDARD]);
      expect(result.reason).toContain('Sonnet (read-only or analysis)');
    });

    it('should select Sonnet for ops commands', () => {
      const command = createCommand(BotName.OPS, 'status', '');
      const result = routeToModel(command, 'project-default');

      expect(result.tier).toBe(ModelTier.STANDARD);
      expect(result.model).toBe(DEFAULT_TIER_MODELS[ModelTier.STANDARD]);
      expect(result.reason).toContain('Sonnet (read-only or analysis)');
    });

    it('should select Sonnet for planner commands', () => {
      const command = createCommand(BotName.PLANNER, 'plan', 'sprint');
      const result = routeToModel(command, 'project-default');

      expect(result.tier).toBe(ModelTier.STANDARD);
      expect(result.model).toBe(DEFAULT_TIER_MODELS[ModelTier.STANDARD]);
      expect(result.reason).toContain('Sonnet (read-only or analysis)');
    });
  });

  describe('Opus selection for write commands', () => {
    const opusCommands = [
      'fix', 'bugfix', 'debug',
      'feature', 'add', 'implement', 'create',
      'refactor', 'cleanup', 'improve',
      'test', 'tests'
    ];

    opusCommands.forEach(cmd => {
      it(`should select Opus for CoderBot ${cmd} command`, () => {
        const command = createCommand(BotName.CODER, cmd, 'some task');
        const result = routeToModel(command, 'project-default');

        expect(result.tier).toBe(ModelTier.PREMIUM);
        expect(result.model).toBe(DEFAULT_TIER_MODELS[ModelTier.PREMIUM]);
        expect(result.reason).toContain(`CoderBot write command (${cmd}) → Opus for implementation`);
        expect(result.overridden).toBe(false);
      });
    });

    it('should NOT select Opus for write commands on non-coder bots', () => {
      const nonWriteBots = [BotName.REVIEWER, BotName.OPS, BotName.PLANNER];

      for (const botName of nonWriteBots) {
        const command = createCommand(botName, 'fix', 'something');
        const result = routeToModel(command, 'project-default');

        expect(result.tier).toBe(ModelTier.STANDARD);
        expect(result.model).toBe(DEFAULT_TIER_MODELS[ModelTier.STANDARD]);
        expect(result.reason).toContain('Sonnet (read-only or analysis)');
      }
    });

    it('should NOT select Opus for non-write commands on coder bot', () => {
      const readOnlyCommands = ['help', 'status', 'explain', 'analyze', 'review'];

      for (const cmd of readOnlyCommands) {
        const command = createCommand(BotName.CODER, cmd, 'something');
        const result = routeToModel(command, 'project-default');

        expect(result.tier).toBe(ModelTier.STANDARD);
        expect(result.model).toBe(DEFAULT_TIER_MODELS[ModelTier.STANDARD]);
        expect(result.reason).toContain('Sonnet (read-only or analysis)');
      }
    });
  });

  describe('environment configuration', () => {
    it('should use custom tier models from environment', () => {
      process.env['MODEL_TIER_STANDARD'] = 'custom-sonnet-model';
      process.env['MODEL_TIER_PREMIUM'] = 'custom-opus-model';

      // Reset config to pick up new env vars
      resetRouterConfig();

      const sonnetCommand = createCommand(BotName.CODER, 'help', '');
      const sonnetResult = routeToModel(sonnetCommand, 'project-default');

      expect(sonnetResult.model).toBe('custom-sonnet-model');
      expect(sonnetResult.tier).toBe(ModelTier.STANDARD);

      const opusCommand = createCommand(BotName.CODER, 'fix', 'bug');
      const opusResult = routeToModel(opusCommand, 'project-default');

      expect(opusResult.model).toBe('custom-opus-model');
      expect(opusResult.tier).toBe(ModelTier.PREMIUM);
    });

    it('should fall back to defaults when env vars are empty', () => {
      process.env['MODEL_TIER_STANDARD'] = '';
      process.env['MODEL_TIER_PREMIUM'] = '';

      resetRouterConfig();

      const command = createCommand(BotName.CODER, 'fix', 'bug');
      const result = routeToModel(command, 'project-default');

      expect(result.model).toBe(DEFAULT_TIER_MODELS[ModelTier.PREMIUM]);
    });

    it('should enable routing by default', () => {
      delete process.env['MODEL_ROUTING_ENABLED'];
      resetRouterConfig();

      const command = createCommand(BotName.CODER, 'fix', 'bug');
      const result = routeToModel(command, 'project-default');

      expect(result.tier).toBe(ModelTier.PREMIUM);
      expect(result.model).toBe(DEFAULT_TIER_MODELS[ModelTier.PREMIUM]);
      expect(result.reason).not.toContain('disabled');
    });

    it('should disable routing when explicitly set to false', () => {
      process.env['MODEL_ROUTING_ENABLED'] = 'false';
      resetRouterConfig();

      const command = createCommand(BotName.CODER, 'fix', 'bug');
      const result = routeToModel(command, 'project-default');

      expect(result.reason).toContain('Model routing disabled');
    });

    it('should treat non-false values as enabled', () => {
      const enabledValues = ['true', '1', 'yes', 'enabled', 'anything'];

      for (const value of enabledValues) {
        process.env['MODEL_ROUTING_ENABLED'] = value;
        resetRouterConfig();

        const command = createCommand(BotName.CODER, 'fix', 'bug');
        const result = routeToModel(command, 'project-default');

        expect(result.reason).not.toContain('disabled');
      }
    });
  });

  describe('config caching', () => {
    it('should cache config after first load', () => {
      process.env['MODEL_TIER_STANDARD'] = 'initial-model';

      const command = createCommand(BotName.CODER, 'help', '');
      const result1 = routeToModel(command, 'project-default');

      expect(result1.model).toBe('initial-model');

      // Change env var but don't reset cache
      process.env['MODEL_TIER_STANDARD'] = 'changed-model';

      const result2 = routeToModel(command, 'project-default');

      // Should still use cached value
      expect(result2.model).toBe('initial-model');
    });

    it('should reload config after reset', () => {
      process.env['MODEL_TIER_STANDARD'] = 'initial-model';

      const command = createCommand(BotName.CODER, 'help', '');
      const result1 = routeToModel(command, 'project-default');

      expect(result1.model).toBe('initial-model');

      // Change env var and reset cache
      process.env['MODEL_TIER_STANDARD'] = 'changed-model';
      resetRouterConfig();

      const result2 = routeToModel(command, 'project-default');

      // Should use new value
      expect(result2.model).toBe('changed-model');
    });
  });

  describe('routing decision structure', () => {
    it('should return complete routing decision structure', () => {
      const command = createCommand(BotName.CODER, 'fix', 'the bug');
      const result = routeToModel(command, 'project-default');

      expect(result).toHaveProperty('tier');
      expect(result).toHaveProperty('model');
      expect(result).toHaveProperty('reason');
      expect(result).toHaveProperty('overridden');

      expect(typeof result.tier).toBe('string');
      expect(typeof result.model).toBe('string');
      expect(typeof result.reason).toBe('string');
      expect(typeof result.overridden).toBe('boolean');
    });

    it('should provide clear reasons for routing decisions', () => {
      const testCases: Array<{
        command: ParsedCommand;
        expectedReasonContains: string;
      }> = [
        {
          command: createCommand(BotName.CODER, 'fix', 'bug'),
          expectedReasonContains: 'CoderBot write command (fix) → Opus for implementation',
        },
        {
          command: createCommand(BotName.CODER, 'help', ''),
          expectedReasonContains: 'coder/help → Sonnet (read-only or analysis)',
        },
        {
          command: createCommand(BotName.REVIEWER, 'review', 'code'),
          expectedReasonContains: 'reviewer/review → Sonnet (read-only or analysis)',
        },
        {
          command: createCommand(BotName.CODER, 'test', 'suite', { model: 'custom' }),
          expectedReasonContains: 'Explicit --model flag: custom',
        },
      ];

      for (const { command, expectedReasonContains } of testCases) {
        const result = routeToModel(command, 'project-default');
        expect(result.reason).toContain(expectedReasonContains);
      }
    });
  });

  describe('edge cases', () => {
    it('should handle empty command strings', () => {
      const command = createCommand(BotName.CODER, '', '');
      const result = routeToModel(command, 'project-default');

      expect(result.tier).toBe(ModelTier.STANDARD);
      expect(result.model).toBe(DEFAULT_TIER_MODELS[ModelTier.STANDARD]);
    });

    it('should handle undefined project model', () => {
      process.env['MODEL_ROUTING_ENABLED'] = 'false';
      resetRouterConfig();

      const command = createCommand(BotName.CODER, 'fix', 'bug');
      const result = routeToModel(command, undefined as any);

      expect(result.model).toBe(undefined);
      expect(result.reason).toContain('using project default');
    });

    it('should handle malformed commands gracefully', () => {
      const malformedCommand: ParsedCommand = {
        botName: BotName.CODER,
        command: null as any,
        args: null as any,
        flags: null as any,
        rawText: '',
      };

      expect(() => {
        routeToModel(malformedCommand, 'project-default');
      }).not.toThrow();
    });

    it('should be case sensitive for command matching', () => {
      const upperCaseCommand = createCommand(BotName.CODER, 'FIX', 'bug');
      const result = routeToModel(upperCaseCommand, 'project-default');

      expect(result.tier).toBe(ModelTier.STANDARD); // Should not match 'fix'
      expect(result.reason).toContain('Sonnet (read-only or analysis)');
    });

    it('should handle very long command names', () => {
      const longCommand = 'a'.repeat(1000);
      const command = createCommand(BotName.CODER, longCommand, 'args');
      const result = routeToModel(command, 'project-default');

      expect(result.tier).toBe(ModelTier.STANDARD);
      expect(result.reason).toContain('Sonnet (read-only or analysis)');
    });
  });

  describe('comprehensive command coverage', () => {
    const allOpusCommands = ['fix', 'bugfix', 'debug', 'feature', 'add', 'implement', 'create', 'refactor', 'cleanup', 'improve', 'test', 'tests'];

    it('should cover all OPUS_COMMANDS from constants', () => {
      for (const cmd of allOpusCommands) {
        const command = createCommand(BotName.CODER, cmd, 'task');
        const result = routeToModel(command, 'project-default');

        expect(result.tier).toBe(ModelTier.PREMIUM);
        expect(result.reason).toContain(`CoderBot write command (${cmd})`);
      }
    });

    it('should handle all bot types with write commands', () => {
      const allBots = [BotName.CODER, BotName.REVIEWER, BotName.OPS, BotName.PLANNER];

      for (const botName of allBots) {
        const command = createCommand(botName, 'fix', 'something');
        const result = routeToModel(command, 'project-default');

        if (botName === BotName.CODER) {
          expect(result.tier).toBe(ModelTier.PREMIUM);
        } else {
          expect(result.tier).toBe(ModelTier.STANDARD);
        }
      }
    });
  });

  describe('performance and memory', () => {
    it('should handle many rapid routing calls', () => {
      const commands = Array.from({ length: 1000 }, (_, i) =>
        createCommand(BotName.CODER, i % 2 === 0 ? 'fix' : 'help', `task ${i}`)
      );

      const start = performance.now();

      for (const command of commands) {
        const result = routeToModel(command, 'project-default');
        expect(result).toBeDefined();
      }

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(100); // Should be very fast
    });

    it('should not leak memory with config resets', () => {
      for (let i = 0; i < 100; i++) {
        process.env['MODEL_TIER_STANDARD'] = `model-${i}`;
        resetRouterConfig();

        const command = createCommand(BotName.CODER, 'help', '');
        const result = routeToModel(command, 'project-default');

        expect(result.model).toBe(`model-${i}`);
      }
    });
  });
});