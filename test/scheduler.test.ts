import { DIContext } from "awilixify";
import type { SimpleIntervalJob } from "toad-scheduler";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	CronTask,
	createSchedulerModuleFactory,
	cron,
	IntervalTask,
	interval,
	type Scheduler,
} from "../index.js";

function deferred() {
	let resolve!: () => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<void>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

const apps: { close(): Promise<void> }[] = [];
let ScheduleModule: ReturnType<typeof createSchedulerModuleFactory>;

function setup() {
	const work = vi.fn<() => unknown>();
	class Heartbeat extends IntervalTask {
		static definition = { seconds: 1 };
	}
	class Controller {
		@interval(Heartbeat)
		execute() {
			return work();
		}
	}
	const app = DIContext.create({
		name: "Test",
		imports: [ScheduleModule([Heartbeat])],
		controllers: [Controller],
	});
	apps.push(app);

	return {
		Heartbeat,
		Controller,
		work,
		app,
		scheduler: app.scope.resolve<Scheduler>("scheduler"),
	};
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
	vi.spyOn(console, "error").mockImplementation(() => {});
	ScheduleModule = createSchedulerModuleFactory();
});

afterEach(async () => {
	await Promise.all(apps.splice(0).map((app) => app.close()));
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("scheduler module", () => {
	it("uses constructor identity for job lookup", async () => {
		const First = class Heartbeat extends IntervalTask {};
		const Second = class Heartbeat extends CronTask {};
		const Missing = class Heartbeat extends IntervalTask {};
		const app = DIContext.create({ name: "Test", imports: [ScheduleModule] });
		apps.push(app);
		await app.init();

		const scheduler = app.scope.resolve<Scheduler>("scheduler");
		const first = scheduler.register(new First({ seconds: 1 }), vi.fn());
		const second = scheduler.register(
			new Second({ cronExpression: "* * * * * *" }),
			vi.fn(),
		);

		expect(scheduler.getJob(First)).toBe(first);
		expect(scheduler.getJob(Second)).toBe(second);
		expect(scheduler.getJob(Missing)).toBeUndefined();
		expect(scheduler.getJobs()).toEqual([first, second]);
	});

	it("enforces scoped permissions for lookup and registration", async () => {
		const First = class Heartbeat extends IntervalTask {};
		const Second = class Heartbeat extends CronTask {};
		const scopedApp = DIContext.create({
			name: "Scoped",
			imports: [ScheduleModule([First])],
		});
		apps.push(scopedApp);
		await scopedApp.init();

		const scoped = scopedApp.scope.resolve<Scheduler>("scheduler");
		const scopedJob = scoped.register(new First({ seconds: 1 }), vi.fn());

		expect(scoped.getJobs()).toEqual([scopedJob]);
		expect(() => scoped.getJob(Second)).toThrow("not allowed");
		expect(() =>
			scoped.register(
				new Second({ cronExpression: "* * * * * *", disabled: true }),
				vi.fn(),
			),
		).toThrow("not allowed");
	});

	it.each(["cron", "interval"] as const)(
		"does not register disabled %s tasks",
		async (kind) => {
			const app = DIContext.create({ name: "Test", imports: [ScheduleModule] });
			apps.push(app);
			await app.init();

			const scheduler = app.scope.resolve<Scheduler>("scheduler");
			class Report extends CronTask {}
			class Heartbeat extends IntervalTask {}
			const task =
				kind === "cron"
					? new Report({ cronExpression: "* * * * * *", disabled: true })
					: new Heartbeat({ seconds: 1, disabled: true });
			expect(scheduler.register(task, vi.fn())).toBeUndefined();
			expect(scheduler.getJobs()).toEqual([]);
			expect(vi.getTimerCount()).toBe(0);
		},
	);

	it.each([false, true])(
		"logs execution failures, async=%s",
		async (asyncFailure) => {
			const app = DIContext.create({ name: "Test", imports: [ScheduleModule] });
			apps.push(app);
			await app.init();

			const scheduler = app.scope.resolve<Scheduler>("scheduler");
			class FailingTask extends IntervalTask {}
			const error = new Error("job failed");
			scheduler.register(new FailingTask({ seconds: 1 }), () => {
				if (asyncFailure) return Promise.reject(error);
				throw error;
			});
			await vi.advanceTimersByTimeAsync(1_000);
			expect(console.error).toHaveBeenCalledWith(
				"[Scheduler] job failed: FailingTask",
				error,
			);
		},
	);

	it("registers both decorators across scopes in one shared engine", async () => {
		class Heartbeat extends IntervalTask {
			static definition = { seconds: 1 };
		}
		class Report extends CronTask {
			static definition = { cronExpression: "* * * * * *" };
		}
		class Disabled extends IntervalTask {
			static definition = { seconds: 1, disabled: true };
		}
		const intervalWork = vi.fn();
		const cronWork = vi.fn();
		const disabledWork = vi.fn();
		class HeartbeatController {
			@interval(Heartbeat)
			execute() {
				intervalWork();
			}
			@interval(Disabled)
			disabled() {
				disabledWork();
			}
		}
		class ReportController {
			@cron(Report)
			execute() {
				cronWork();
			}
		}
		const app = DIContext.create({
			name: "App",
			imports: [
				{
					name: "Heartbeats",
					imports: [ScheduleModule([Heartbeat, Disabled])],
					controllers: [HeartbeatController],
				},
				{
					name: "Reports",
					imports: [ScheduleModule([Report])],
					controllers: [ReportController],
				},
				ScheduleModule,
			],
		});
		apps.push(app);
		await app.init();
		const root = app.scope.resolve<Scheduler>("scheduler");
		expect(root.getJobs()).toEqual([
			root.getJob(Heartbeat),
			root.getJob(Report),
		]);
		expect(root.getJob(Disabled)).toBeUndefined();
		await vi.advanceTimersByTimeAsync(1_000);
		expect(intervalWork).toHaveBeenCalledOnce();
		expect(cronWork).toHaveBeenCalledOnce();
		expect(disabledWork).not.toHaveBeenCalled();
	});

	it("enforces the allowlist during decorated registration", async () => {
		class NotAllowed extends IntervalTask {
			static definition = { seconds: 1 };
		}
		class Controller {
			@interval(NotAllowed)
			execute() {}
		}
		const app = DIContext.create({
			name: "Test",
			imports: [ScheduleModule([])],
			controllers: [Controller],
		});
		apps.push(app);
		await expect(app.init()).rejects.toThrow("not allowed");
	});

	it("rejects duplicate instances even with different or disabled settings", async () => {
		const { app, scheduler, Heartbeat } = setup();
		await app.init();

		expect(() =>
			scheduler.register(new Heartbeat({ seconds: 2 }), vi.fn()),
		).toThrow("already exists");
		expect(() =>
			scheduler.register(
				new Heartbeat({ seconds: 2, disabled: true }),
				vi.fn(),
			),
		).toThrow("already exists");
	});

	it("uses instance settings instead of static defaults", async () => {
		class Report extends CronTask {
			static definition = { cronExpression: "0 9 * * *" };
		}
		const app = DIContext.create({ name: "Manual", imports: [ScheduleModule] });
		apps.push(app);
		await app.init();

		const scheduler = app.scope.resolve<Scheduler>("scheduler");
		const work = vi.fn();
		scheduler.register(new Report({ cronExpression: "* * * * * *" }), work);
		await vi.advanceTimersByTimeAsync(1_000);
		expect(work).toHaveBeenCalledOnce();
	});

	it("isolates applications sharing the same factory", async () => {
		const first = setup();
		const second = setup();
		await first.app.init();
		await second.app.init();
		await first.app.close();
		await vi.advanceTimersByTimeAsync(1_000);
		expect(first.work).not.toHaveBeenCalled();
		expect(second.work).toHaveBeenCalledOnce();
	});
});

describe("shutdown", () => {
	class Resource {
		onShutdown = vi.fn();
	}

	it("waits for a running job before resource shutdown", async () => {
		const pending = deferred();
		class Heartbeat extends IntervalTask {}
		const app = DIContext.create({
			name: "Test",
			imports: [ScheduleModule],
			providers: { resource: Resource },
		});
		apps.push(app);
		await app.init();

		const scheduler = app.scope.resolve<Scheduler>("scheduler");
		const resource = app.scope.resolve<Resource>("resource");
		scheduler.register(
			new Heartbeat({ seconds: 1, runImmediately: true }),
			() => pending.promise,
		);
		await vi.advanceTimersByTimeAsync(0);

		const shutdown = app.close();
		await vi.advanceTimersByTimeAsync(0);
		expect(resource.onShutdown).not.toHaveBeenCalled();
		pending.resolve();
		await shutdown;
		expect(resource.onShutdown).toHaveBeenCalledOnce();
	});

	it("keeps draining when one execution fails", async () => {
		const first = deferred();
		const second = deferred();
		class First extends IntervalTask {}
		class Second extends IntervalTask {}
		const app = DIContext.create({
			name: "Test",
			imports: [ScheduleModule],
			providers: { resource: Resource },
		});
		apps.push(app);
		await app.init();

		const scheduler = app.scope.resolve<Scheduler>("scheduler");
		const resource = app.scope.resolve<Resource>("resource");
		scheduler.register(
			new First({ seconds: 1, runImmediately: true }),
			() => first.promise,
		);
		scheduler.register(
			new Second({ seconds: 1, runImmediately: true }),
			() => second.promise,
		);
		await vi.advanceTimersByTimeAsync(0);

		const shutdown = app.close();
		await vi.advanceTimersByTimeAsync(0);
		first.reject(new Error("job failed"));
		await vi.advanceTimersByTimeAsync(0);
		expect(resource.onShutdown).not.toHaveBeenCalled();
		second.resolve();
		await shutdown;
		expect(resource.onShutdown).toHaveBeenCalledOnce();
	});

	it("stops scheduling without waiting when drainOnShutdown is false", async () => {
		const pending = deferred();
		const NonDrainingModule = createSchedulerModuleFactory({
			drainOnShutdown: false,
		});
		class Heartbeat extends IntervalTask {}
		const app = DIContext.create({
			name: "Test",
			imports: [NonDrainingModule],
		});
		apps.push(app);
		await app.init();

		const scheduler = app.scope.resolve<Scheduler>("scheduler");
		const work = vi.fn(() => pending.promise);
		const job = scheduler.register(
			new Heartbeat({
				seconds: 1,
				runImmediately: true,
				preventOverrun: false,
			}),
			work,
		) as SimpleIntervalJob;
		await vi.advanceTimersByTimeAsync(0);

		await app.close();
		expect(scheduler.getJobs()).toEqual([]);
		expect(vi.getTimerCount()).toBe(0);
		await job.executeAsync();
		expect(work).toHaveBeenCalledOnce();
		expect(() =>
			scheduler.register(new Heartbeat({ seconds: 1 }), vi.fn()),
		).toThrow("after scheduler shutdown");
		pending.resolve();
	});
});
