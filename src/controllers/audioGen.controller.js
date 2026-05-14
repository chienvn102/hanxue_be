const crypto = require('crypto');
const audioGen = require('../services/audioGen.service');
const imagen = require('../services/imagen.service');

// In-memory job store. Đủ cho single-process droplet. Khi scale ra nhiều worker
// → chuyển sang Redis hoặc DB. TTL 30 phút để map không grow vô hạn.
const jobs = new Map();
const JOB_TTL_MS = 30 * 60 * 1000;

function purgeOldJobs() {
    const now = Date.now();
    for (const [id, job] of jobs) {
        const ts = job.completedAt ? Date.parse(job.completedAt) : Date.parse(job.createdAt);
        if (Number.isFinite(ts) && now - ts > JOB_TTL_MS) {
            jobs.delete(id);
        }
    }
}

function createJob(work) {
    purgeOldJobs();
    const jobId = crypto.randomUUID();
    jobs.set(jobId, { status: 'queued', createdAt: new Date().toISOString() });

    setImmediate(async () => {
        jobs.set(jobId, { ...jobs.get(jobId), status: 'running' });
        try {
            const result = await work();
            jobs.set(jobId, {
                ...jobs.get(jobId),
                status: 'done',
                result,
                url: result?.url,
                completedAt: new Date().toISOString(),
            });
        } catch (error) {
            jobs.set(jobId, {
                ...jobs.get(jobId),
                status: 'failed',
                error: error.publicMessage || error.message || 'Job failed',
                completedAt: new Date().toISOString(),
            });
        }
    });

    return jobId;
}

function enqueue(res, work) {
    const jobId = createJob(work);
    res.status(202).json({ success: true, jobId, status: 'queued' });
}

exports.getJob = async (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    res.json({ success: true, jobId: req.params.jobId, ...job });
};

exports.genVocabAudio = async (req, res) => {
    enqueue(res, () => audioGen.genVocabAudio(req.params.id));
};

exports.genHskQuestionAudio = async (req, res) => {
    enqueue(res, () => audioGen.genHskListeningAudio(req.params.id));
};

exports.genLessonAudio = async (req, res) => {
    enqueue(res, () => audioGen.genLessonAudio(req.params.id));
};

exports.genExampleAudio = async (req, res) => {
    enqueue(res, () => audioGen.genExampleAudio(req.params.id));
};

exports.genImage = async (req, res) => {
    enqueue(res, () => imagen.generateImage(req.body || {}));
};
