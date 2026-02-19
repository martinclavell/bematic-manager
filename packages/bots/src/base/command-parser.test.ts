import { describe, it, expect } from 'vitest';
import { parseCommandText } from './command-parser.js';
import { BotName } from '@bematic/common';

describe('CommandParser', () => {
  describe('parseCommandText', () => {
    // Basic parsing tests
    describe('basic command parsing', () => {
      it('should parse basic command without arguments', () => {
        const result = parseCommandText(BotName.CODER, 'fix', 'default');

        expect(result).toEqual({
          botName: BotName.CODER,
          command: 'fix',
          args: '',
          flags: {},
          rawText: 'fix',
        });
      });

      it('should parse command with single argument', () => {
        const result = parseCommandText(BotName.CODER, 'fix the login bug', 'default');

        expect(result).toEqual({
          botName: BotName.CODER,
          command: 'fix',
          args: 'the login bug',
          flags: {},
          rawText: 'fix the login bug',
        });
      });

      it('should parse command with multiple arguments', () => {
        const result = parseCommandText(BotName.CODER, 'feature add user authentication system', 'default');

        expect(result).toEqual({
          botName: BotName.CODER,
          command: 'feature',
          args: 'add user authentication system',
          flags: {},
          rawText: 'feature add user authentication system',
        });
      });

      it('should use default command when text starts with flags', () => {
        const result = parseCommandText(BotName.CODER, '--file src/app.ts fix this', 'debug');

        expect(result).toEqual({
          botName: BotName.CODER,
          command: 'debug',
          args: 'fix this',
          flags: {
            file: 'src/app.ts',
          },
          rawText: '--file src/app.ts fix this',
        });
      });

      it('should use default command when no explicit command given', () => {
        const result = parseCommandText(BotName.REVIEWER, 'check this PR', 'review');

        expect(result).toEqual({
          botName: BotName.REVIEWER,
          command: 'check',
          args: 'this PR',
          flags: {},
          rawText: 'check this PR',
        });
      });
    });

    // Flag parsing tests
    describe('flag parsing', () => {
      it('should parse flag that takes following token as value', () => {
        const result = parseCommandText(BotName.CODER, 'fix --force the bug', 'default');

        expect(result).toEqual({
          botName: BotName.CODER,
          command: 'fix',
          args: 'bug',
          flags: {
            force: 'the',
          },
          rawText: 'fix --force the bug',
        });
      });

      it('should parse boolean flag when followed by another flag', () => {
        const result = parseCommandText(BotName.CODER, 'fix --force --file src/app.ts', 'default');

        expect(result).toEqual({
          botName: BotName.CODER,
          command: 'fix',
          args: '',
          flags: {
            force: true,
            file: 'src/app.ts',
          },
          rawText: 'fix --force --file src/app.ts',
        });
      });

      it('should parse boolean flag at end of input', () => {
        const result = parseCommandText(BotName.CODER, 'fix some args --force', 'default');

        expect(result).toEqual({
          botName: BotName.CODER,
          command: 'fix',
          args: 'some args',
          flags: {
            force: true,
          },
          rawText: 'fix some args --force',
        });
      });

      it('should parse single flag with value', () => {
        const result = parseCommandText(BotName.CODER, 'fix --file src/app.ts the bug', 'default');

        expect(result).toEqual({
          botName: BotName.CODER,
          command: 'fix',
          args: 'the bug',
          flags: {
            file: 'src/app.ts',
          },
          rawText: 'fix --file src/app.ts the bug',
        });
      });

      it('should parse multiple flags with values', () => {
        const result = parseCommandText(BotName.CODER, 'fix --file src/app.ts --model opus the bug', 'default');

        expect(result).toEqual({
          botName: BotName.CODER,
          command: 'fix',
          args: 'the bug',
          flags: {
            file: 'src/app.ts',
            model: 'opus',
          },
          rawText: 'fix --file src/app.ts --model opus the bug',
        });
      });

      it('should parse mixed boolean and value flags', () => {
        const result = parseCommandText(BotName.CODER, 'fix --force --file src/app.ts --verbose the bug', 'default');

        expect(result).toEqual({
          botName: BotName.CODER,
          command: 'fix',
          args: 'bug',
          flags: {
            force: true,
            file: 'src/app.ts',
            verbose: 'the',
          },
          rawText: 'fix --force --file src/app.ts --verbose the bug',
        });
      });

      it('should treat flag as boolean when next token is another flag', () => {
        const result = parseCommandText(BotName.CODER, 'fix --force --verbose the bug', 'default');

        expect(result).toEqual({
          botName: BotName.CODER,
          command: 'fix',
          args: 'bug',
          flags: {
            force: true,
            verbose: 'the',
          },
          rawText: 'fix --force --verbose the bug',
        });
      });

      it('should treat final flag as boolean when no value follows', () => {
        const result = parseCommandText(BotName.CODER, 'fix the bug --force', 'default');

        expect(result).toEqual({
          botName: BotName.CODER,
          command: 'fix',
          args: 'the bug',
          flags: {
            force: true,
          },
          rawText: 'fix the bug --force',
        });
      });
    });

    // Quoted argument parsing tests
    describe('quoted arguments', () => {
      it('should parse single quoted arguments', () => {
        const result = parseCommandText(BotName.CODER, "fix 'the login bug'", 'default');

        expect(result).toEqual({
          botName: BotName.CODER,
          command: 'fix',
          args: 'the login bug',
          flags: {},
          rawText: "fix 'the login bug'",
        });
      });

      it('should parse double quoted arguments', () => {
        const result = parseCommandText(BotName.CODER, 'fix "the login bug"', 'default');

        expect(result).toEqual({
          botName: BotName.CODER,
          command: 'fix',
          args: 'the login bug',
          flags: {},
          rawText: 'fix "the login bug"',
        });
      });

      it('should parse quoted flag values', () => {
        const result = parseCommandText(BotName.CODER, 'fix --file "src/components/user login.ts" the bug', 'default');

        expect(result).toEqual({
          botName: BotName.CODER,
          command: 'fix',
          args: 'the bug',
          flags: {
            file: 'src/components/user login.ts',
          },
          rawText: 'fix --file "src/components/user login.ts" the bug',
        });
      });

      it('should parse mixed quoted and unquoted arguments', () => {
        const result = parseCommandText(BotName.CODER, 'fix --file "user login.ts" the "authentication bug" in signup', 'default');

        expect(result).toEqual({
          botName: BotName.CODER,
          command: 'fix',
          args: 'the authentication bug in signup',
          flags: {
            file: 'user login.ts',
          },
          rawText: 'fix --file "user login.ts" the "authentication bug" in signup',
        });
      });

      it('should handle quotes with spaces and special characters', () => {
        const result = parseCommandText(BotName.CODER, 'fix "bug with @mentions and #hashtags"', 'default');

        expect(result).toEqual({
          botName: BotName.CODER,
          command: 'fix',
          args: 'bug with @mentions and #hashtags',
          flags: {},
          rawText: 'fix "bug with @mentions and #hashtags"',
        });
      });
    });

    // Edge cases and error handling
    describe('edge cases', () => {
      it('should handle empty input', () => {
        const result = parseCommandText(BotName.CODER, '', 'help');

        expect(result).toEqual({
          botName: BotName.CODER,
          command: 'help',
          args: '',
          flags: {},
          rawText: '',
        });
      });

      it('should handle whitespace-only input', () => {
        const result = parseCommandText(BotName.CODER, '   \t  ', 'help');

        expect(result).toEqual({
          botName: BotName.CODER,
          command: 'help',
          args: '',
          flags: {},
          rawText: '',
        });
      });

      it('should trim leading and trailing whitespace', () => {
        const result = parseCommandText(BotName.CODER, '  fix the bug  ', 'default');

        expect(result).toEqual({
          botName: BotName.CODER,
          command: 'fix',
          args: 'the bug',
          flags: {},
          rawText: 'fix the bug',
        });
      });

      it('should handle only flags with no args', () => {
        const result = parseCommandText(BotName.CODER, 'fix --force --verbose', 'default');

        expect(result).toEqual({
          botName: BotName.CODER,
          command: 'fix',
          args: '',
          flags: {
            force: true,
            verbose: true,
          },
          rawText: 'fix --force --verbose',
        });
      });

      it('should handle command with only boolean flags and no args', () => {
        const result = parseCommandText(BotName.CODER, '--help --version', 'status');

        expect(result).toEqual({
          botName: BotName.CODER,
          command: 'status',
          args: '',
          flags: {
            help: true,
            version: true,
          },
          rawText: '--help --version',
        });
      });

      it('should handle tab characters as whitespace', () => {
        const result = parseCommandText(BotName.CODER, 'fix\tthe\tbug', 'default');

        expect(result).toEqual({
          botName: BotName.CODER,
          command: 'fix',
          args: 'the bug',
          flags: {},
          rawText: 'fix\tthe\tbug',
        });
      });

      it('should handle unclosed quotes gracefully', () => {
        const result = parseCommandText(BotName.CODER, 'fix "unclosed quote', 'default');

        expect(result).toEqual({
          botName: BotName.CODER,
          command: 'fix',
          args: 'unclosed quote',
          flags: {},
          rawText: 'fix "unclosed quote',
        });
      });

      it('should handle empty quoted strings', () => {
        const result = parseCommandText(BotName.CODER, 'fix "" the bug', 'default');

        expect(result).toEqual({
          botName: BotName.CODER,
          command: 'fix',
          args: 'the bug',
          flags: {},
          rawText: 'fix "" the bug',
        });
      });
    });

    // Complex real-world scenarios
    describe('complex scenarios', () => {
      it('should parse complex coder command', () => {
        const result = parseCommandText(
          BotName.CODER,
          'feature --file src/auth.ts --model opus "implement OAuth2 login with Google"',
          'default'
        );

        expect(result).toEqual({
          botName: BotName.CODER,
          command: 'feature',
          args: 'implement OAuth2 login with Google',
          flags: {
            file: 'src/auth.ts',
            model: 'opus',
          },
          rawText: 'feature --file src/auth.ts --model opus "implement OAuth2 login with Google"',
        });
      });

      it('should parse complex reviewer command', () => {
        const result = parseCommandText(
          BotName.REVIEWER,
          'security --file "src/user management.ts" --thorough check for SQL injection vulnerabilities',
          'review'
        );

        expect(result).toEqual({
          botName: BotName.REVIEWER,
          command: 'security',
          args: 'for SQL injection vulnerabilities',
          flags: {
            file: 'src/user management.ts',
            thorough: 'check',
          },
          rawText: 'security --file "src/user management.ts" --thorough check for SQL injection vulnerabilities',
        });
      });

      it('should parse ops command with multiple paths', () => {
        const result = parseCommandText(
          BotName.OPS,
          'deploy --env prod --force "deploy version 1.2.3 to production"',
          'status'
        );

        expect(result).toEqual({
          botName: BotName.OPS,
          command: 'deploy',
          args: 'deploy version 1.2.3 to production',
          flags: {
            env: 'prod',
            force: true,
          },
          rawText: 'deploy --env prod --force "deploy version 1.2.3 to production"',
        });
      });

      it('should preserve original rawText exactly', () => {
        const originalText = '  feature   --file  "src/app.ts"   --model   opus   implement   login  ';
        const result = parseCommandText(BotName.CODER, originalText, 'default');

        expect(result.rawText).toBe(originalText.trim());
      });
    });

    // Different bot types
    describe('different bot types', () => {
      it('should work with all bot types', () => {
        const botTypes = [BotName.CODER, BotName.REVIEWER, BotName.OPS, BotName.PLANNER];

        for (const botName of botTypes) {
          const result = parseCommandText(botName, 'test --flag value args', 'default');

          expect(result.botName).toBe(botName);
          expect(result.command).toBe('test');
          expect(result.args).toBe('args');
          expect(result.flags).toEqual({ flag: 'value' });
        }
      });
    });

    // Performance and memory
    describe('tokenizer edge cases', () => {
      it('should handle very long arguments', () => {
        const longText = 'a'.repeat(1000);
        const result = parseCommandText(BotName.CODER, `fix ${longText}`, 'default');

        expect(result.command).toBe('fix');
        expect(result.args).toBe(longText);
      });

      it('should handle many arguments', () => {
        const manyArgs = Array.from({ length: 50 }, (_, i) => `arg${i}`).join(' ');
        const result = parseCommandText(BotName.CODER, `fix ${manyArgs}`, 'default');

        expect(result.command).toBe('fix');
        expect(result.args).toBe(manyArgs);
      });

      it('should handle many flags', () => {
        const manyFlags = Array.from({ length: 20 }, (_, i) => `--flag${i} value${i}`).join(' ');
        const result = parseCommandText(BotName.CODER, `fix ${manyFlags} remaining args`, 'default');

        expect(result.command).toBe('fix');
        expect(result.args).toBe('remaining args');
        expect(Object.keys(result.flags)).toHaveLength(20);

        for (let i = 0; i < 20; i++) {
          expect(result.flags[`flag${i}`]).toBe(`value${i}`);
        }
      });
    });
  });
});