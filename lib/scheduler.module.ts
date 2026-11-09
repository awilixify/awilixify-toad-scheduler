import { createModule, type Module, type ModuleDef } from "awilixify";
import { ToadScheduler } from "toad-scheduler";
import { SchedulerInitializer } from "./scheduler.initializer.js";
import { Scheduler } from "./scheduler.service.js";
import { SchedulerEngine } from "./scheduler-engine.js";
import type { ScheduledTaskConstructor } from "./task.decorator.js";

type SchedulerRootModuleDef = ModuleDef<{
	providers: {
		toadScheduler: ToadScheduler;
		drainOnShutdown: boolean;
		schedulerEngine: SchedulerEngine;
	};
	exportKeys: ["schedulerEngine"];
}>;

type SchedulerModuleDef<
	TAllowed extends ScheduledTaskConstructor = ScheduledTaskConstructor,
> = ModuleDef<{
	imports: [Module<SchedulerRootModuleDef>];
	providers: {
		scheduleOptions: { allowedTasks?: readonly TAllowed[] };
		scheduler: Scheduler<TAllowed>;
	};
	exportKeys: ["scheduler"];
	initializers: { schedule: typeof SchedulerInitializer };
	exportInitializerKeys: ["schedule"];
}>;

type SchedulerModuleFactory = Module<SchedulerModuleDef> &
	(<const Tasks extends readonly ScheduledTaskConstructor[]>(
		allowedTasks: Tasks,
	) => Module<SchedulerModuleDef<Tasks[number]>>);

export type Deps = SchedulerModuleDef["deps"];

let nextId = 0;

export function createSchedulerModuleFactory(
	options: {
		/** Wait for running jobs before other application resources shut down. Defaults to true. */
		drainOnShutdown?: boolean;
	} = {},
): SchedulerModuleFactory {
	const root = createModule<SchedulerRootModuleDef>({
		name: `SchedulerRootModule_${++nextId}`,
		providers: {
			drainOnShutdown: options.drainOnShutdown ?? true,
			toadScheduler: {
				useFactory: () => new ToadScheduler(),
				lifetime: "SINGLETON",
			},
			schedulerEngine: {
				useClass: SchedulerEngine,
				lifetime: "SINGLETON",
				eager: true,
			},
		},
		exports: ["schedulerEngine"],
	});

	const createScope = <
		TAllowed extends ScheduledTaskConstructor = ScheduledTaskConstructor,
	>(scheduleOptions: {
		allowedTasks?: readonly TAllowed[];
	}) =>
		createModule<SchedulerModuleDef<TAllowed>>({
			name: `SchedulerModule_${++nextId}`,
			imports: [root],
			providers: {
				scheduleOptions,
				scheduler: { useClass: Scheduler<TAllowed>, lifetime: "SINGLETON" },
			},
			exports: ["scheduler"],
			initializers: { schedule: SchedulerInitializer },
			initializerExports: ["schedule"],
		});

	const unrestricted = createScope({});
	const { name, ...definition } = unrestricted;
	const factory = Object.assign(
		<const Tasks extends readonly ScheduledTaskConstructor[]>(
			allowedTasks: Tasks,
		) => createScope<Tasks[number]>({ allowedTasks: [...allowedTasks] }),
		definition,
	);
	// Function names are not writable; keep the module name enumerable for spreads.
	Object.defineProperty(factory, "name", { value: name, enumerable: true });

	return factory;
}
