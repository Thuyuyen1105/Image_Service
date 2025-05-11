const { Worker } = require('worker_threads');
const path = require('path');
const os = require('os');
const { connectDB } = require('./database');
const Job = require('./models/Job');

const MAX_WORKERS = 5;

class WorkerPool {
    constructor(size = Math.min(os.cpus().length, MAX_WORKERS)) {
        this.size = size;
        this.workers = [];
        this.queue = [];
        this.activeWorkers = new Set();
    }

    async initialize() {
        await connectDB();
        for (let i = 0; i < this.size; i++) {
            const worker = new Worker(path.join(__dirname, 'worker.js'), {
                env: process.env
            });
            
            // Handle worker errors
            worker.on('error', (error) => {
                console.error('Worker error:', error);
                this.handleWorkerError(worker, error);
            });

            // Handle worker exit
            worker.on('exit', (code) => {
                if (code !== 0) {
                    console.error(`Worker stopped with exit code ${code}`);
                    this.handleWorkerExit(worker);
                }
            });

            this.workers.push(worker);
        }
        console.log(`Initialized ${this.size} workers`);
    }

    async processJob(jobData) {
        try {
            // Validate required fields
            const { jobId, userId, prompt, scriptId, splitScriptId } = jobData;
            if (!jobId || !userId || !prompt || !scriptId || !splitScriptId) {
                throw new Error('Missing required fields: jobId, userId, prompt, scriptId, splitScriptId');
            }

            // Check if job already exists
            let job = await Job.findOne({ jobId });
            
            // If job doesn't exist, create new one
            if (!job) {
                job = new Job({
                    jobId,
                    scriptId,
                    userId,
                    totalImages: jobData.metadata?.totalImage || 1,
                    completedImages: 0,
                    status: 'processing',
                    imageIds: []
                });
                await job.save();
                console.log('Created new job:', { jobId, status: job.status });
            } else {
                console.log('Found existing job:', { 
                    jobId, 
                    status: job.status,
                    completedImages: job.completedImages,
                    totalImages: job.totalImages
                });
            }

            // If job is already completed or failed, don't process
            if (job.status === 'completed' || job.status === 'failed') {
                return {
                    status: job.status,
                    data: {
                        jobId: job.jobId,
                        status: job.status,
                        completedImages: job.completedImages,
                        totalImages: job.totalImages,
                        images: job.imageIds || []
                    }
                };
            }

            // Process job through worker
            return new Promise((resolve, reject) => {
                const worker = this.getAvailableWorker();
                if (!worker) {
                    console.log('No available worker, adding to queue');
                    this.queue.push({ jobData, resolve, reject });
                    return;
                }

                this.activeWorkers.add(worker);
                
                worker.once('message', (result) => {
                    this.activeWorkers.delete(worker);
                    resolve(result);
                    this.processNextJob();
                });

                worker.once('error', (error) => {
                    this.activeWorkers.delete(worker);
                    reject(error);
                    this.processNextJob();
                });

                worker.postMessage(jobData);
            });
        } catch (error) {
            console.error('Error in processJob:', error);
            throw error;
        }
    }

    getAvailableWorker() {
        return this.workers.find(worker => !this.activeWorkers.has(worker));
    }

    processNextJob() {
        if (this.queue.length > 0) {
            const { jobData, resolve, reject } = this.queue.shift();
            this.processJob(jobData).then(resolve).catch(reject);
        }
    }

    handleWorkerError(worker, error) {
        const index = this.workers.indexOf(worker);
        if (index !== -1) {
            this.workers.splice(index, 1);
            this.activeWorkers.delete(worker);
            
            const newWorker = new Worker(path.join(__dirname, 'worker.js'), {
                env: process.env
            });
            this.workers.push(newWorker);
        }
    }

    handleWorkerExit(worker) {
        const index = this.workers.indexOf(worker);
        if (index !== -1) {
            this.workers.splice(index, 1);
            this.activeWorkers.delete(worker);
            
            const newWorker = new Worker(path.join(__dirname, 'worker.js'), {
                env: process.env
            });
            this.workers.push(newWorker);
        }
    }

    terminate() {
        console.log('Terminating all workers');
        this.workers.forEach(worker => {
            try {
                worker.terminate();
            } catch (error) {
                console.error('Error terminating worker:', error);
            }
        });
        this.workers = [];
        this.activeWorkers.clear();
        this.queue = [];
    }
}

module.exports = WorkerPool; 