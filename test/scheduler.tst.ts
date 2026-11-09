import type { ModuleDef } from "awilixify";
import type { CronJob, Job, SimpleIntervalJob } from "toad-scheduler";
import { describe, expect, test } from "tstyche";
import {
	type CronDefinition,
	CronExpression,
	CronTask,
	createSchedulerModuleFactory,
	cron,
	type IntervalDefinition,
	IntervalTask,
	interval,
	type Scheduler,
} from "../index.js";

class Heartbeat extends IntervalTask {
	static readonly definition = { seconds: 10, preventOverrun: true };
}

class DailyReport extends CronTask {
	static readonly definition = {
		cronExpression: "0 9 * * *",
		timezone: "Europe/London",
		preventOverrun: true,
	};
}

const ScheduleModule = createSchedulerModuleFactory();
const schedulerModule = ScheduleModule([Heartbeat, DailyReport]);
type RootDef = ModuleDef<{ imports: [typeof ScheduleModule] }>;
declare const rootScheduler: RootDef["deps"]["scheduler"];
type Def = ModuleDef<{ imports: [typeof schedulerModule] }>;
declare const scheduler: Def["deps"]["scheduler"];
declare const task: CronTask | IntervalTask;

const intervalModule = ScheduleModule([Heartbeat]);
type IntervalDef = ModuleDef<{ imports: [typeof intervalModule] }>;
declare const intervalScheduler: IntervalDef["deps"]["scheduler"];

const cronModule = ScheduleModule([DailyReport]);
type CronDef = ModuleDef<{ imports: [typeof cronModule] }>;
declare const cronScheduler: CronDef["deps"]["scheduler"];

const emptyModule = ScheduleModule([]);
type EmptyDef = ModuleDef<{ imports: [typeof emptyModule] }>;
declare const emptyScheduler: EmptyDef["deps"]["scheduler"];

describe("public scheduler API", () => {
	test("accepts a factory-level shutdown draining option", () => {
		expect(createSchedulerModuleFactory).type.toBeCallableWith();
		expect(createSchedulerModuleFactory).type.toBeCallableWith({
			drainOnShutdown: false,
		});
		expect(createSchedulerModuleFactory).type.toBeCallableWith({
			drainOnShutdown: true,
		});
		expect(createSchedulerModuleFactory).type.not.toBeCallableWith({
			drainOnShutdown: "false",
		});
	});

	test("exports cron expressions as readonly string literals", () => {
		expect(CronExpression).type.toBe<{
			readonly EVERY_SECOND: "* * * * * *";
			readonly EVERY_30_SECONDS: "*/30 * * * * *";
			readonly EVERY_MINUTE: "* * * * *";
			readonly EVERY_30_MINUTES: "*/30 * * * *";
			readonly EVERY_HOUR: "0 * * * *";
		}>();
		expect(DailyReport).type.toBeConstructableWith({
			cronExpression: CronExpression.EVERY_30_MINUTES,
		});
	});

	test("exports the scheduler through module dependencies", () => {
		expect(scheduler).type.toBe<
			Scheduler<typeof Heartbeat | typeof DailyReport>
		>();
		expect(scheduler.getJobs()).type.toBe<Job[]>();
		expect(scheduler.getJob(Heartbeat)).type.toBe<Job | undefined>();
		expect(scheduler.getJob(DailyReport)).type.toBe<Job | undefined>();
		expect(rootScheduler.getJob(Heartbeat)).type.toBe<Job | undefined>();
		expect(scheduler.getJob).type.not.toBeCallableWith("Heartbeat");
		expect(rootScheduler).type.toBe<Scheduler>();
	});

	test("accepts mixed task constructors in module scopes", () => {
		expect(ScheduleModule).type.toBeCallableWith([Heartbeat, DailyReport]);
		expect(ScheduleModule).type.not.toBeCallableWith([
			new Heartbeat({ seconds: 1 }),
		]);
	});

	test("narrows registration and lookup to the module's task constructors", () => {
		expect(
			intervalScheduler.register(new Heartbeat({ seconds: 1 }), () => {}),
		).type.toBe<SimpleIntervalJob | undefined>();
		expect(
			cronScheduler.register(
				new DailyReport({ cronExpression: "* * * * *" }),
				() => {},
			),
		).type.toBe<CronJob | undefined>();
		expect(intervalScheduler.getJob).type.toBeCallableWith(Heartbeat);
		expect(cronScheduler.getJob).type.toBeCallableWith(DailyReport);
		expect(intervalScheduler.getJob).type.not.toBeCallableWith(DailyReport);
		expect(cronScheduler.getJob).type.not.toBeCallableWith(Heartbeat);
		expect(intervalScheduler.register).type.not.toBeCallableWith(
			new DailyReport({ cronExpression: "* * * * *" }),
			() => {},
		);
		expect(cronScheduler.register).type.not.toBeCallableWith(
			new Heartbeat({ seconds: 1 }),
			() => {},
		);
		expect(emptyScheduler.getJob).type.not.toBeCallableWith(Heartbeat);
		expect(emptyScheduler.register).type.not.toBeCallableWith(
			new Heartbeat({ seconds: 1 }),
			() => {},
		);
		expect(rootScheduler.getJob).type.toBeCallableWith(DailyReport);
		expect(rootScheduler.register).type.toBeCallableWith(
			new Heartbeat({ seconds: 1 }),
			() => {},
		);
	});

	test("infers the registered job type from the task kind", () => {
		expect(DailyReport).type.toBeConstructableWith({
			cronExpression: CronExpression.EVERY_MINUTE,
			disabled: true,
		});
		expect(Heartbeat).type.toBeConstructableWith({
			seconds: 1,
			disabled: false,
		});
		expect(
			scheduler.register(
				new Heartbeat({ seconds: 1, disabled: true }),
				() => {},
			),
		).type.toBe<SimpleIntervalJob | undefined>();
		expect(
			scheduler.register(
				new DailyReport({ cronExpression: CronExpression.EVERY_MINUTE }),
				() => {},
			),
		).type.toBe<CronJob | undefined>();
		expect(scheduler.register(task, () => {})).type.toBe<
			CronJob | SimpleIntervalJob | undefined
		>();
	});

	test("accepts typed manual instances and callbacks", () => {
		expect(DailyReport).type.toBeConstructableWith({
			cronExpression: "* * * * *",
		});
		expect(DailyReport).type.not.toBeConstructableWith({ seconds: 10 });
		expect(Heartbeat).type.toBeConstructableWith({ seconds: 5 });
		expect(Heartbeat).type.not.toBeConstructableWith({
			cronExpression: "* * * * *",
		});
		expect(scheduler.register).type.toBeCallableWith(
			new DailyReport({ cronExpression: "* * * * *" }),
			async () => {},
		);
		expect(scheduler.register).type.toBeCallableWith(
			new Heartbeat({ seconds: 1 }),
			() => {},
		);
		expect(scheduler.register).type.not.toBeCallableWith(DailyReport, () => {});
		expect(scheduler.register).type.not.toBeCallableWith(
			new Heartbeat({ seconds: 1 }),
			"not a callback",
		);
	});

	test("accepts matching schedules and rejects mismatched decorators", () => {
		expect(Heartbeat.definition).type.toBeAssignableTo<IntervalDefinition>();
		expect(interval).type.toBeCallableWith(Heartbeat);
		expect(DailyReport.definition).type.toBeAssignableTo<CronDefinition>();
		expect(cron).type.toBeCallableWith(DailyReport);

		expect(cron).type.not.toBeCallableWith(Heartbeat);
		expect(interval).type.not.toBeCallableWith(DailyReport);

		expect(Heartbeat.definition).type.not.toBeAssignableTo<CronDefinition>();
		expect(
			DailyReport.definition,
		).type.not.toBeAssignableTo<IntervalDefinition>();
	});
});
