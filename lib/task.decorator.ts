import { createDecoratorStateUpdater } from "awilixify";
import type {
	CronJob,
	CronSchedule,
	SimpleIntervalJob,
	SimpleIntervalSchedule,
} from "toad-scheduler";

export type CronDefinition = CronSchedule &
	NonNullable<ConstructorParameters<typeof CronJob>[2]> & {
		disabled?: boolean;
	};

export type IntervalDefinition = SimpleIntervalSchedule &
	NonNullable<ConstructorParameters<typeof SimpleIntervalJob>[2]> & {
		cronExpression?: never;
		disabled?: boolean;
	};

export abstract class CronTask {
	// Distinguish instances from the structurally similar static class side.
	declare protected readonly taskInstance: undefined;
	static readonly kind = "cron";
	static definition: CronDefinition;
	readonly kind = "cron";

	constructor(readonly definition: CronDefinition) {}
}

export abstract class IntervalTask {
	// Distinguish instances from the structurally similar static class side.
	declare protected readonly taskInstance: undefined;
	static readonly kind = "interval";
	static definition: IntervalDefinition;
	readonly kind = "interval";

	constructor(readonly definition: IntervalDefinition) {}
}

export type CronTaskConstructor = {
	new (definition: CronDefinition): CronTask;
	readonly kind: "cron";
	definition: CronDefinition;
};

export type IntervalTaskConstructor = {
	new (definition: IntervalDefinition): IntervalTask;
	readonly kind: "interval";
	definition: IntervalDefinition;
};
export type ScheduledTaskConstructor =
	| CronTaskConstructor
	| IntervalTaskConstructor;

const updater = createDecoratorStateUpdater("Scheduled Jobs", {
	method: (): ScheduledTaskConstructor => undefined as never,
});

export const SCHEDULE_METADATA_TOKEN = updater.token;

export function cron(task: CronTaskConstructor) {
	return (target: any, context: ClassMethodDecoratorContext) => {
		updater.update(context, { method: () => task });
		return target;
	};
}

export function interval(task: IntervalTaskConstructor) {
	return (target: any, context: ClassMethodDecoratorContext) => {
		updater.update(context, { method: () => task });
		return target;
	};
}
