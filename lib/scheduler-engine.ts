import type { BeforeShutdown } from "awilixify";
import {
	AsyncTask,
	CronJob,
	SimpleIntervalJob,
	type ToadScheduler,
} from "toad-scheduler";
import type {
	CronTask,
	IntervalTask,
	ScheduledTaskConstructor,
} from "./task.decorator.js";

export class SchedulerEngine implements BeforeShutdown {
	private readonly taskIds = new WeakMap<ScheduledTaskConstructor, string>();
	private nextTaskId = 0;
	private readonly runningJobs = new Set<Promise<unknown>>();
	private stopping = false;

	constructor(
		readonly toadScheduler: ToadScheduler,
		private readonly drainOnShutdown: boolean,
	) {}

	getTaskId(task: ScheduledTaskConstructor): string {
		const existing = this.taskIds.get(task);

		if (existing) return existing;

		// Toad requires string IDs; constructor identity distinguishes same-named tasks.
		const id = `${task.name || "Task"}_${++this.nextTaskId}`;

		this.taskIds.set(task, id);

		return id;
	}

	register(task: CronTask | IntervalTask, invoke: () => unknown) {
		if (this.stopping)
			throw new Error("Cannot register jobs after scheduler shutdown");

		const taskClass = task.constructor as ScheduledTaskConstructor;
		const id = this.getTaskId(taskClass);

		if (this.toadScheduler.existsById(id)) {
			throw new Error(`Scheduled job already exists: ${id}`);
		}

		if (task.definition.disabled) return;

		const execution = new AsyncTask(
			id,
			() => this.runJob(invoke),
			(error: unknown) => {
				console.error(`[Scheduler] job failed: ${taskClass.name}`, error);
			},
		);

		if (task.kind === "cron") {
			const {
				preventOverrun,
				disabled: _disabled,
				...settings
			} = task.definition;
			const job = new CronJob(settings, execution, { id, preventOverrun });
			this.toadScheduler.addCronJob(job);

			return job;
		}

		const {
			preventOverrun,
			disabled: _disabled,
			...settings
		} = task.definition;
		const job = new SimpleIntervalJob(settings, execution, {
			id,
			preventOverrun,
		});
		this.toadScheduler.addSimpleIntervalJob(job);

		return job;
	}

	private runJob(invoke: () => unknown): Promise<unknown> {
		if (this.stopping) return Promise.resolve();

		// Defer invocation so synchronous throws also become tracked rejections.
		const execution = Promise.resolve().then(invoke);
		const tracked = execution.finally(() => this.runningJobs.delete(tracked));
		this.runningJobs.add(tracked);

		return tracked;
	}

	async beforeShutdown() {
		this.stopping = true;
		this.toadScheduler.stop();

		for (const job of this.toadScheduler.getAllJobs()) {
			if (job.id) this.toadScheduler.removeById(job.id);
		}

		if (this.drainOnShutdown) {
			await Promise.allSettled([...this.runningJobs]);
		}
	}
}
