import {
    claimDueScheduledPublication,
    publishScheduledPublication,
} from './scheduledPublications';

const DEFAULT_INTERVAL_MS = 15_000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export async function runSchedulerTick(): Promise<void> {
    if (running) return;
    running = true;
    try {
        while (true) {
            const job = await claimDueScheduledPublication();
            if (!job) return;
            await publishScheduledPublication(job);
        }
    } finally {
        running = false;
    }
}

export function startScheduler(): void {
    if (timer) return;
    const interval =
        Number(process.env.SCHEDULER_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
    timer = setInterval(() => {
        runSchedulerTick().catch((error) => {
            console.error('Scheduled publication worker failed:', error);
        });
    }, interval);
    runSchedulerTick().catch((error) => {
        console.error('Scheduled publication worker failed:', error);
    });
}

export function stopScheduler(): void {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
}
