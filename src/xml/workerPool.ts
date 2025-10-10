import { Worker } from "node:worker_threads";

interface WorkerJob {
    job: any;
    resolve: (result: any) => void;
    reject: (error: Error) => void;
}

export class WorkerPool {
    private workers: Worker[] = [];
    private queue: WorkerJob[] = [];
    private activeJobs = new Map<Worker, WorkerJob>();

    constructor(
        private poolSize: number,
        private workerPath: string  // Now expects absolute path
    ) {

        for (let i = 0; i < poolSize; i++) {
            const worker = new Worker(workerPath, {execArgv: ['--require', 'tsx/cjs']});

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

    async terminate() {
        await Promise.all(this.workers.map(w => w.terminate()));
        this.workers = [];
        this.activeJobs.clear();
        this.queue = [];
    }
}
