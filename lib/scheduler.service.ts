import type { CronJob, SimpleIntervalJob } from "toad-scheduler";
import type { Deps } from "./scheduler.module.js";
import type {
	CronTask,
	IntervalTask,
	ScheduledTaskConstructor,
} from "./task.decorator.js";

export class Scheduler<
	TAllowed extends ScheduledTaskConstructor = ScheduledTaskConstructor,
> {
	constructor(
		private readonly schedulerEngine: Deps["schedulerEngine"],
		private readonly scheduleOptions: Deps["scheduleOptions"],
	) {}

	register(
		task: Extract<InstanceType<TAllowed>, CronTask>,
		invoke: () => unknown,
	): CronJob | undefined;
	register(
		task: Extract<InstanceType<TAllowed>, IntervalTask>,
		invoke: () => unknown,
	): SimpleIntervalJob | undefined;
	register(
		task: InstanceType<TAllowed>,
		invoke: () => unknown,
	): CronJob | SimpleIntervalJob | undefined;
	register(task: CronTask | IntervalTask, invoke: () => unknown) {
		this.assertAllowed(task.constructor as ScheduledTaskConstructor);

		return this.schedulerEngine.register(task, invoke);
	}

	getJob(task: TAllowed) {
		this.assertAllowed(task);

		const id = this.schedulerEngine.getTaskId(task);

		return this.getJobs().find((job) => job.id === id);
	}

	getJobs() {
		const jobs = this.schedulerEngine.toadScheduler.getAllJobs();
		const allowedTasks = this.scheduleOptions.allowedTasks;

		if (allowedTasks === undefined) return jobs;

		const allowedIds = allowedTasks.map((task) =>
			this.schedulerEngine.getTaskId(task),
		);

		return jobs.filter((job) => job.id && allowedIds.includes(job.id));
	}

	private assertAllowed(task: ScheduledTaskConstructor) {
		const allowedTasks = this.scheduleOptions.allowedTasks;

		if (allowedTasks !== undefined && !allowedTasks.includes(task)) {
			throw new Error(
				`Scheduled task "${task.name}" is not allowed in this scope`,
			);
		}
	}
}
