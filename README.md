# @awilixify/toad-scheduler

Module-scoped cron and interval jobs for Awilixify, powered by `toad-scheduler`. Application shutdown stops scheduling and waits for running executions before other resources shut down.

## Install

```sh
npm install @awilixify/toad-scheduler awilixify awilix
```

`toad-scheduler` is an internal dependency. You do not need to install or configure it separately.

## Create the module factory

Create one factory in your application's composition code and share it across feature modules:

```ts
// scheduler.module.ts
import { createSchedulerModuleFactory } from "@awilixify/toad-scheduler";

export const ScheduleModule = createSchedulerModuleFactory();
```

The factory is both a regular module and a function that creates allowlisted modules:

```ts
imports: [ScheduleModule]; // Allows any task.
imports: [ScheduleModule([Heartbeat])]; // Allows only Heartbeat.
imports: [ScheduleModule([])]; // Allows no tasks.
```

## Register jobs

```ts
import { IntervalTask, interval } from "@awilixify/toad-scheduler";
import { createModule, DIContext, type ModuleDef } from "awilixify";
import { ScheduleModule } from "./scheduler.module.js";

class Heartbeat extends IntervalTask {
  static readonly definition = {
    seconds: 10,
    preventOverrun: true,
  };
}

class HeartbeatController {
  @interval(Heartbeat)
  async execute() {
    console.log("heartbeat");
  }
}

const schedulerModule = ScheduleModule([Heartbeat]);
type AppDef = ModuleDef<{ imports: [typeof schedulerModule] }>;

const AppModule = createModule<AppDef>({
  name: "AppModule",
  imports: [schedulerModule],
  controllers: [HeartbeatController],
});

const app = DIContext.create(AppModule);
await app.init();
// During application shutdown:
await app.close();
```

The scheduler initializer rejects tasks not included in an allowlisted module's task list. The unrestricted form skips that check. Both forms reject registering the same task class more than once in an engine.

Both forms export a `scheduler` provider with `getJobs()` and `getJob(TaskClass)`. The unrestricted provider returns every registered job in the shared engine. An allowlisted provider returns jobs matching its task list.

Scoped module dependencies preserve the allowed constructor types for `register()` and `getJob()`. Type injected schedulers as `YourModuleDef["deps"]["scheduler"]` to retain these checks; bare `Scheduler` is unrestricted. An empty allowlist accepts no tasks at compile time. TypeScript can still consider identically shaped task subclasses interchangeable, so runtime checks enforce exact constructor identity.

`getJob(Heartbeat)` returns the registered job or `undefined` if none exists. In an allowlisted module, it throws if the task class is outside the allowlist, even if its name matches an allowed task.

## Cron expressions

Use `CronExpression` for common schedules or a raw string for a custom expression:

```ts
import { CronExpression, CronTask } from "@awilixify/toad-scheduler";

class MinuteReport extends CronTask {
  static readonly definition = {
    cronExpression: CronExpression.EVERY_MINUTE,
  };
}
```

Available constants are `EVERY_SECOND`, `EVERY_30_SECONDS`, `EVERY_MINUTE`, `EVERY_30_MINUTES`, and `EVERY_HOUR`.

## Register with configuration from DI

Use `scheduler.register(taskInstance, callback)` from an `afterInit` hook when settings come from your application's config service:

```ts
import { CronTask, type Scheduler } from "@awilixify/toad-scheduler";
import { ConfigService } from "./config.service.js";

class DailyReport extends CronTask {
  static readonly definition = { cronExpression: "0 9 * * *" };
}

class ReportsService {
  constructor(
    private readonly scheduler: Scheduler,
    private readonly config: ConfigService,
  ) {}

  afterInit() {
    this.scheduler.register(
      new DailyReport({
        cronExpression: this.config.get("REPORT_CRON"),
        timezone: this.config.get("TIMEZONE"),
      }),
      () => this.sendReport(),
    );
  }

  async sendReport() {
    console.log("daily report");
  }
}
```

Register `ReportsService` as an eager singleton provider in a module importing `ScheduleModule` or `ScheduleModule([DailyReport])`. Config must be ready before its `afterInit` hook runs. The task class itself does not need DI registration.

The instance constructor requires a complete definition of the matching kind, not a partial override. The instance uses those settings without changing `DailyReport.definition`. Decorated registration continues to use the static definition. Manual-only task classes may omit a static definition entirely.

`register()` returns the created job, or `undefined` when the task is disabled. Both registration paths enforce the same allowlist and one-job-per-class rule, so manual registration of an already decorated task fails. Lookup still uses `scheduler.getJob(DailyReport)`. Manual executions share overrun handling, error logging, and graceful shutdown with decorated executions. Registration after shutdown begins is rejected.

## Disable a task

Both cron and interval definitions accept `disabled`, which defaults to `false`:

```ts
class OptionalReport extends CronTask {
  static readonly definition = {
    cronExpression: CronExpression.EVERY_MINUTE,
    disabled: true,
  };
}
```

Manual instances can use config to set the same flag:

```ts
new OptionalReport({
  cronExpression: this.config.get("REPORT_CRON"),
  disabled: !this.config.get("REPORT_ENABLED"),
});
```

## Shutdown

By default, application shutdown stops scheduling, removes jobs, rejects stale callbacks and new registrations, and waits for running executions before other resources shut down.

To skip waiting, configure the factory:

```ts
export const ScheduleModule = createSchedulerModuleFactory({
  drainOnShutdown: false,
});
```

This applies to all scopes and both decorated and manually registered jobs from that factory. Scheduling still stops, but running callbacks are not cancelled. They may continue using resources after the application disposes them. Keep the default `true` unless that risk is acceptable.

## Development

```sh
npm install
npm run build:release
npm pack --dry-run --ignore-scripts
```
