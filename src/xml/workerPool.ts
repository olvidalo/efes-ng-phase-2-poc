import { Worker } from "node:worker_threads";
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const tsxEsm = require.resolve('tsx/esm'); // absolute path

interface WorkerJob {
    job: any;
    resolve: (result: any) => void;
    reject: (error: Error) => void;
}

export class WorkerPool {
    private workers: Worker[] = [];
    private workerIds = new Map<Worker, number>();
    private queue: WorkerJob[] = [];
    private activeJobs = new Map<Worker, WorkerJob>();

    constructor(
        private poolSize: number,
        private workerPath: string  // Now expects absolute path
    ) {

        for (let i = 0; i < poolSize; i++) {
            // tsx requires --import but that doesn't work for worker threads
            // Workaround: use tsx CLI to spawn the worker instead of node
            const worker = new Worker(new URL(workerPath, import.meta.url), {
                execArgv: ['--experimental-strip-types']
            });

            this.workerIds.set(worker, i);

            worker.on("message", (message) => {
                const job = this.activeJobs.get(worker);
                if (!job) return;

                this.activeJobs.delete(worker);

                if (message.success) {
                    job.resolve(message.result);
                } else {
                    const error = new Error(message.error.message);
                    error.stack = message.error.stack;
                    job.reject(error);
                }

                // Process next queued job if any
                this.processNext(worker);
            });

            worker.on("error", (error) => {
                const job = this.activeJobs.get(worker);
                if (job) {
                    this.activeJobs.delete(worker);
                    job.reject(error);
                }
            });

            this.workers.push(worker);
        }
    }

    execute<T>(job: any): Promise<T> {
        return new Promise((resolve, reject) => {
            const workerJob: WorkerJob = { job, resolve, reject };

            // Try to find an idle worker
            const idleWorker = this.workers.find(w => !this.activeJobs.has(w));

            if (idleWorker) {
                this.activeJobs.set(idleWorker, workerJob);
                idleWorker.postMessage(job);
            } else {
                // All workers busy, queue the job
                this.queue.push(workerJob);
            }
        });
    }

    private processNext(worker: Worker) {
        const nextJob = this.queue.shift();
        if (nextJob) {
            this.activeJobs.set(worker, nextJob);
            worker.postMessage(nextJob.job);
        }
    }

    getActiveWorkers(): Map<number, any> {
        const activeWorkers = new Map<number, any>();
        for (const [worker, job] of this.activeJobs.entries()) {
            const workerId = this.workerIds.get(worker)!;
            activeWorkers.set(workerId, job.job);
        }
        return activeWorkers;
    }

    async terminate() {
        await Promise.all(this.workers.map(w => w.terminate()));
        this.workers = [];
        this.workerIds.clear();
        this.activeJobs.clear();
        this.queue = [];
    }
}
