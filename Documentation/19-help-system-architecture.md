# 19 — Help System Architecture

[← Back to Index](./README.md)

---

## Overview

The help system provides self-documenting commands with auto-generated help text from command metadata.

---

## Current Architecture (Before Improvement)

### Problems Identified

1. **Command Handler Conflicts**
   - Both `bm-command.ts` and `netsuite-command.ts` register for `/bm`
   - First handler (`bm-command.ts`) calls `ack()` immediately, preventing other handlers from running
   - Result: `/bm netsuite help` showed general help instead of NetSuite-specific help

2. **Hardcoded Help Text**
   - Help messages manually maintained in multiple places
   - No single source of truth for command metadata
   - Adding new commands requires updating help text in multiple locations
   - Risk of help text becoming out of sync with actual commands

3. **No Command Metadata**
   - No centralized command registry
   - No type-safe command routing
   - No validation of command permissions/aliases

### Immediate Fix Applied

**File**: `packages/cloud/src/slack/listeners/bm-command.ts`

Added early return for `netsuite` subcommand BEFORE calling `ack()`:

```typescript
export function registerBmCommandListener(app: App, ctx: AppContext) {
  app.command(MAIN_SLASH_COMMAND, async ({ command, ack, respond, client }) => {
    const { user_id, channel_id, text, trigger_id } = command;
    const args = text.trim().split(/\s+/);
    const subcommand = args[0]?.toLowerCase() || 'help';

    // Let netsuite-command.ts handle netsuite subcommands
    if (subcommand === 'netsuite') {
      return; // Don't ack - let netsuite handler process it
    }

    await ack();
    // ... rest of handler
  });
}
```

**Registration Order** (in `index.ts`):
```typescript
registerBmCommandListener(app, ctx);      // Checks for netsuite, skips if found
registerNetSuiteCommandListener(app, ctx); // Handles netsuite subcommands
```

This ensures:
1. `bm-command.ts` sees the command first
2. If subcommand is `netsuite`, it returns WITHOUT ack
3. `netsuite-command.ts` then processes the command
4. `/bm netsuite help` now shows the correct NetSuite-specific help

---

## Future Architecture (Command Registry Pattern)

### Design Principles

1. **Single Source of Truth**: All command metadata in one registry
2. **Auto-Generated Help**: Help text generated from metadata
3. **Type Safety**: TypeScript types for commands and handlers
4. **Modular**: Easy to add new commands without touching multiple files
5. **Category-Based**: Commands grouped by category in help output

### Command Registry Implementation

**File**: `packages/cloud/src/slack/commands/command-registry.ts`

```typescript
interface CommandMetadata {
  name: string;           // Primary command name
  aliases?: string[];     // Alternative names
  description: string;    // Short description
  usage?: string;         // Usage syntax (e.g., "<arg> [optional]")
  examples?: string[];    // Usage examples
  permission?: string;    // Required permission
  category: string;       // Help category (Development, Deployment, etc.)
  hidden?: boolean;       // Hide from help text
}

interface CommandDefinition extends CommandMetadata {
  handler: CommandHandler;
}

class CommandRegistry {
  register(definition: CommandDefinition): void;
  get(nameOrAlias: string): CommandDefinition | undefined;
  getAll(includeHidden?: boolean): CommandDefinition[];
  getByCategory(category: string): CommandDefinition[];
  getCategories(): string[];
  generateHelpText(): string;
  generateCommandHelp(nameOrAlias: string): string | undefined;
}
```

### Usage Example

```typescript
// Define command with metadata
commandRegistry.register({
  name: 'build',
  aliases: ['compile'],
  description: 'Compile/rebuild the app',
  category: 'Development',
  permission: 'TASK_CREATE',
  examples: ['/bm build', '/bm compile'],
  handler: async (args, ctx, subArgs) => {
    // Implementation
  },
});

// Help is auto-generated
const helpText = commandRegistry.generateHelpText();
// Output:
// *Development:*
// `/bm build` (alias: `compile`) - Compile/rebuild the app
```

### Benefits

1. **Auto-Generated Help**
   - Add command → help automatically updated
   - Consistent formatting across all commands
   - Category-based grouping

2. **Type Safety**
   - TypeScript ensures all metadata is provided
   - Compile-time checking for command names

3. **Easy Maintenance**
   - One place to add new commands
   - No risk of help text drift
   - Clear command structure

4. **Enhanced Features**
   - Command-specific help (`/bm help <command>`)
   - Alias resolution
   - Permission checking
   - Usage validation

---

## NetSuite Command Architecture

### Current Structure

**File**: `packages/cloud/src/slack/listeners/netsuite-command.ts`

Separate handler for NetSuite subcommands:
- `config` / `configure` / `setup` - Configure credentials
- `get` / `fetch` - Fetch records
- `seo` / `seo-debug` - Generate SEO debug URLs
- `test` / `test-connection` - Test connection
- `help` / `?` - Show help

### Help Output

```
*NetSuite Integration - /bm netsuite*

*Configuration:*
`/bm netsuite config` (aliases: `configure`, `setup`) - Configure NetSuite credentials & endpoints

*Operations:*
`/bm netsuite get <type> <id>` (alias: `fetch`) - Fetch record via RESTlet (e.g. `customer 1233`)
`/bm netsuite seo <url>` (alias: `seo-debug`) - Generate SEO debug URL with prerender flags
`/bm netsuite test` (alias: `test-connection`) - Test NetSuite connection & authentication

*Examples:*
• `/bm netsuite get customer 1233`
• `/bm netsuite fetch customer 1233` (same as get)
• `/bm netsuite seo www.christianartgifts.com`
• `/bm netsuite test`

*Help:*
`/bm netsuite help` or `/bm netsuite ?` - Show this help message
```

---

## Implementation Roadmap

### Phase 1: Immediate Fix (✅ Completed)
- [x] Fix command handler conflict (bm-command skips netsuite)
- [x] Update NetSuite help text with all aliases
- [x] Update documentation

### Phase 2: Command Registry (Future)
- [ ] Implement `CommandRegistry` class
- [ ] Migrate all commands to registry pattern
- [ ] Auto-generate help text from registry
- [ ] Add command-specific help (`/bm help <command>`)

### Phase 3: Enhanced Features (Future)
- [ ] Interactive help (Slack modals/blocks)
- [ ] Command suggestions for typos
- [ ] Permission-aware help (hide commands user can't access)
- [ ] Context-aware help (show only relevant commands)

---

## Testing Checklist

- [x] `/bm help` - Shows general help
- [x] `/bm netsuite` - Shows NetSuite help (defaults to help)
- [x] `/bm netsuite help` - Shows NetSuite help
- [x] `/bm netsuite ?` - Shows NetSuite help
- [x] `/bm netsuite config` - Opens config modal
- [x] `/bm netsuite get customer 123` - Fetches record
- [x] `/bm netsuite fetch customer 123` - Fetches record (alias)
- [x] All other `/bm` commands still work

---

## Cross-References

- [06 — Package: @bematic/cloud](./06-package-cloud.md) - Command handlers
- [13 — Coding Conventions](./13-coding-conventions.md) - Adding new commands
