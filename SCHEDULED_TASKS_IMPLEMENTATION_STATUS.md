# Scheduled Tasks & Cron Jobs - Implementation Status

## ✅ Phase 1: Core Infrastructure (COMPLETED)

### Database Layer
- ✅ Created `scheduled_tasks` schema (`packages/db/src/schema/scheduled-tasks.ts`)
  - All fields defined (id, projectId, userId, taskType, botName, command, prompt, scheduling fields, recurrence fields, status fields)
  - Indexes created for performance (nextExecutionAt, status+enabled, projectId, userId)
  - Added to schema exports and migrate.ts

- ✅ Created `ScheduledTaskRepository` (`packages/db/src/repositories/scheduled-task.repository.ts`)
  - create(), findById(), findByProjectId(), findByUserId()
  - **findDue()** - Core query for scheduler worker
  - getUpcoming(hours), countByStatus(), countByUser()
  - update(), delete(), deleteOldCompleted()
  - Exported from repositories/index.ts and db/index.ts

### Time Parsing Utilities
- ✅ Created `TimeParser` (`packages/common/src/utils/time-parser.ts`)
  - parseNatural() - Natural language parsing ("tomorrow 3pm", "in 2 hours")
  - parseISO() - ISO 8601 parsing with timezone
  - isFuture(), format(), relative(), validate()
  - Uses chrono-node + luxon

- ✅ Created `CronParser` (`packages/common/src/utils/cron-parser.ts`)
  - parse(), getNext(), getNextN(), validate()
  - describe() - Human-readable cron descriptions
  - isReasonableFrequency() - Prevent abuse (min 1 hour interval)
  - PRESETS - Common cron expressions
  - Uses cron-parser package

- ✅ Added dependencies to `packages/common/package.json`:
  - chrono-node ^2.7.5
  - cron-parser ^4.9.0
  - luxon ^3.4.4
  - @types/luxon ^3.4.2 (devDependency)

### Scheduler Service
- ✅ Created `SchedulerService` (`packages/cloud/src/services/scheduler.service.ts`)
  - scheduleTask() - Create one-time scheduled task
  - createCronJob() - Create recurring cron job
  - executeDueTask() - Execute task by submitting to CommandService
  - pauseTask(), resumeTask(), cancelTask()
  - updateTask() - Update scheduled time, prompt, cron expression
  - listTasks() - Query with filters
  - getStats() - Scheduler statistics
  - Enforces quota (max 50 scheduled tasks per user)
  - Validates time in future, max 1 year ahead
  - Validates cron frequency (min 1 hour)

### Scheduler Worker
- ✅ Created `SchedulerWorker` (`packages/cloud/src/workers/scheduler-worker.ts`)
  - start() - Start background worker with 30s tick interval
  - stop() - Graceful shutdown
  - tick() - Main loop: find due tasks, execute them, update next execution
  - Handles one-time vs recurring logic
  - Retry on failure (5 min delay)
  - Auto-cancels expired tasks
  - forceTick() - Manual execution for testing

## 🔄 Phase 2: Integration (IN PROGRESS)

### Next Steps

1. **Update AppContext** (`packages/cloud/src/context.ts`)
   - Add ScheduledTaskRepository instantiation
   - Add SchedulerService instantiation
   - Export in context type

2. **Bootstrap Integration** (`packages/cloud/src/index.ts`)
   - Import SchedulerWorker
   - Instantiate with context.schedulerService
   - Start worker after WebSocket server
   - Add graceful shutdown to SIGTERM handler

3. **Command Service Extension** (`packages/cloud/src/services/command.service.ts`)
   - Ensure submitTask() accepts metadata field
   - Log scheduled task ID in audit trail

## 📋 Phase 3: Slack Commands (TODO)

### Commands to Implement

1. **`/bm schedule`** handler
   - Parse: `/bm schedule <time> <bot> <command> <prompt>`
   - Extract timezone from Slack user profile
   - Call schedulerService.scheduleTask()
   - Post confirmation with formatted time

2. **`/bm cron create`** handler
   - Parse: `/bm cron create <expression> <bot> <command> <prompt>`
   - Validate cron expression
   - Call schedulerService.createCronJob()
   - Post confirmation with next 3 execution times

3. **`/bm scheduled list`** handler
   - Show all user's scheduled tasks
   - Format: ID, type, bot, next execution, status
   - Pagination if > 10 tasks

4. **`/bm scheduled show <id>`** handler
   - Show full details of scheduled task
   - Include execution history if recurring

5. **`/bm scheduled pause/resume/cancel <id>`** handlers
   - Call respective schedulerService methods
   - Post confirmation

6. **`/bm scheduled update <id>`** handler
   - Interactive modal for editing
   - Update time, prompt, or cron expression

### Slack Command File Locations
- `packages/cloud/src/slack/commands/bm-command.ts` (extend existing handler)
- OR create new file: `packages/cloud/src/slack/commands/scheduled-commands.ts`

## 🔧 Phase 4: Admin Commands (TODO)

### Admin Commands to Add

1. **`/bm-admin scheduled-stats`**
   - Show total, by status, upcoming 24h, overdue, recurring
   - Call schedulerService.getStats()

2. **`/bm-admin scheduled-cleanup`**
   - Manually run old completed task cleanup
   - Call scheduledTaskRepo.deleteOldCompleted(30)

## 📦 Phase 5: Installation & Testing (TODO)

### Installation Steps

```bash
# From project root
npm install

# Build packages (common first, then db, then cloud)
npm run build -w @bematic/common
npm run build -w @bematic/db
npm run build -w @bematic/cloud

# Push database schema
npm run migrate -w @bematic/db

# Test scheduler worker
npm run dev -w @bematic/cloud
```

### Testing Checklist

- [ ] Create one-time scheduled task
- [ ] Verify task executes at scheduled time
- [ ] Create recurring cron job
- [ ] Verify cron job runs on schedule
- [ ] Test pause/resume functionality
- [ ] Test cancellation
- [ ] Test quota enforcement (51st task fails)
- [ ] Test cron frequency validation (< 1 hour fails)
- [ ] Test scheduler worker restart (tasks persist)
- [ ] Test expired task auto-cancellation

## 📚 Phase 6: Documentation (TODO)

### Files to Update

1. **`Documentation/04-package-db.md`**
   - Add scheduled_tasks table schema
   - Add ScheduledTaskRepository methods

2. **`Documentation/06-package-cloud.md`**
   - Add SchedulerService section
   - Add SchedulerWorker section
   - Add /bm schedule, /bm cron commands

3. **`Documentation/10-database-schema.md`**
   - Add scheduled_tasks to entity relationships

4. **`Documentation/13-coding-conventions.md`**
   - Add "How-To: Adding Scheduled Tasks" section

5. **`Documentation/14-file-index.md`**
   - Add all new files

## 🎯 Summary of What's Been Built

### Database
- `scheduled_tasks` table with full schema
- ScheduledTaskRepository with 15+ methods
- Migration script for table creation

### Business Logic
- TimeParser: Natural language time parsing
- CronParser: Cron expression parsing & validation
- SchedulerService: Full CRUD + execution logic
- SchedulerWorker: Background process for task execution

### Dependencies Added
- chrono-node, cron-parser, luxon (time handling)
- @types/luxon (TypeScript definitions)

### Architecture Patterns Followed
- ✅ Repository pattern for data access
- ✅ Service layer for business logic
- ✅ Worker pattern for background processing
- ✅ Audit logging for all operations
- ✅ Error handling and retries
- ✅ Quota enforcement
- ✅ Security validations

## 🚀 Next Session Continuation

To continue in next session:

1. **Install dependencies**: `npm install` (will install chrono-node, cron-parser, luxon)
2. **Update AppContext**: Add scheduledTaskRepo and schedulerService
3. **Bootstrap worker**: Integrate SchedulerWorker into cloud/src/index.ts
4. **Add Slack commands**: Implement /bm schedule and /bm cron handlers
5. **Test end-to-end**: Create a scheduled task and verify execution
6. **Update docs**: Document the new feature

## 📝 Notes

- **Quota**: Max 50 scheduled tasks per user (configurable via MAX_USER_SCHEDULED_TASKS)
- **Cron frequency limit**: Min 1 hour between executions (prevent abuse)
- **Max schedule ahead**: 1 year into future
- **Retry logic**: 5 minute delay on failure, then mark as failed
- **Expired tasks**: Auto-cancelled by scheduler worker
- **Timezone support**: All times timezone-aware via luxon

## ⚠️ Known Limitations (Future Enhancements)

- [ ] No web UI for scheduled task management (Slack-only)
- [ ] No notification before task execution (could add 5-min warning)
- [ ] No pause/resume for one-time tasks (by design - cancel & recreate)
- [ ] No batch operations (cancel all, pause all, etc.)
- [ ] No scheduled task analytics dashboard
- [ ] No support for task dependencies (execute after X completes)
- [ ] No support for conditional execution (only if X condition met)
