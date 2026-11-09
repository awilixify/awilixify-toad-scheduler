import { Initializer, type InitializerContext } from "awilixify";

import type { Deps } from "./scheduler.module.js";
import { SCHEDULE_METADATA_TOKEN } from "./task.decorator.js";

type ScheduleToken = typeof SCHEDULE_METADATA_TOKEN;

export class SchedulerInitializer extends Initializer<ScheduleToken> {
	public readonly token = SCHEDULE_METADATA_TOKEN;

	constructor(private readonly scheduler: Deps["scheduler"]) {
		super();
	}

	initialize(context: InitializerContext<ScheduleToken>): void {
		const task = context.metadata;
		// Narrow the constructor together with its matching definition type.
		const instance =
			task.kind === "cron"
				? new task(task.definition)
				: new task(task.definition);

		this.scheduler.register(instance, () => context.invoke());
	}
}
