import { parentPort } from "node:worker_threads";

if (!parentPort) {
    throw new Error("genericWorker must be run as a worker thread");
}

parentPort.on("message", async (message) => {
    try {
        // Extract workload script path from job message
        if (!message.workloadScript) {
            throw new Error("Job message must include 'workloadScript' property");
        }

        // Dynamic import based on workload script specified in job
        const workloadModule = await import(message.workloadScript);

        // Generic interface: all workloads must export performWork()
        if (typeof workloadModule.performWork !== 'function') {
            throw new Error(`Workload module ${message.workloadScript} must export a 'performWork' function`);
        }

        const result = await workloadModule.performWork(message);
        parentPort!.postMessage({ success: true, result });
    } catch (error: any) {
        parentPort!.postMessage({
            success: false,
            error: {
                message: error.message,
                stack: error.stack
            }
        });
    }
});
