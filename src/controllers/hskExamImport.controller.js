/**
 * Admin OCR import controller for HSK exams.
 * Additive hook only; existing HSK CRUD routes remain unchanged.
 */

const multer = require('multer');
const importService = require('../services/hskExamOcrImport.service');

const MAX_PDF_MB = parseInt(process.env.HSK_IMPORT_PDF_MAX_MB || '25', 10);
const MAX_AUDIO_MB = parseInt(process.env.HSK_IMPORT_AUDIO_MAX_MB || '50', 10);
const MAX_ANSWER_MB = parseInt(process.env.HSK_IMPORT_ANSWER_MAX_MB || '10', 10);

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: Math.max(MAX_PDF_MB, MAX_AUDIO_MB, MAX_ANSWER_MB) * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const field = file.fieldname;
        const mime = file.mimetype || '';
        const name = file.originalname || '';

        if (field === 'examPdf') {
            return mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf')
                ? cb(null, true)
                : cb(new Error('examPdf phải là file PDF.'));
        }
        if (field === 'answerFile') {
            const ok = [
                'text/plain',
                'application/json',
                'application/pdf',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            ].includes(mime) || /\.(txt|json|pdf|docx)$/i.test(name);
            return ok ? cb(null, true) : cb(new Error('answerFile chỉ hỗ trợ .txt, .json, .pdf, .docx.'));
        }
        if (field === 'audioFile') {
            const ok = mime.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|webm)$/i.test(name);
            return ok ? cb(null, true) : cb(new Error('audioFile phải là file audio.'));
        }
        return cb(new Error(`Field upload không hợp lệ: ${field}`));
    },
});

const uploadImportFiles = upload.fields([
    { name: 'examPdf', maxCount: 1 },
    { name: 'answerFile', maxCount: 1 },
    { name: 'audioFile', maxCount: 1 },
]);

function fileTooLarge(file, maxMb) {
    return file && file.size > maxMb * 1024 * 1024;
}

function getUploadedFiles(req) {
    return {
        examPdf: req.files?.examPdf?.[0] || null,
        answerFile: req.files?.answerFile?.[0] || null,
        audioFile: req.files?.audioFile?.[0] || null,
    };
}

async function createOcrImport(req, res) {
    try {
        const files = getUploadedFiles(req);
        const hskLevel = Number.parseInt(req.body?.hskLevel || req.body?.hsk_level, 10);
        const examType = req.body?.examType === 'practice' || req.body?.exam_type === 'practice'
            ? 'practice'
            : 'exam';
        const title = String(req.body?.title || '').trim() || `HSK ${hskLevel || ''} OCR Import`;

        if (![1, 2, 3, 4, 5, 6].includes(hskLevel)) {
            return res.status(400).json({ success: false, message: 'hskLevel phải nằm trong 1-6.' });
        }
        if (!files.examPdf) {
            return res.status(400).json({ success: false, message: 'Thiếu file đề PDF (examPdf).' });
        }
        if (!files.answerFile) {
            return res.status(400).json({ success: false, message: 'Thiếu file đáp án (answerFile).' });
        }
        if (examType === 'exam' && !files.audioFile) {
            return res.status(400).json({ success: false, message: 'Chế độ thi cần file audio (audioFile).' });
        }
        if (fileTooLarge(files.examPdf, MAX_PDF_MB)) {
            return res.status(400).json({ success: false, message: `PDF vượt quá ${MAX_PDF_MB}MB.` });
        }
        if (fileTooLarge(files.answerFile, MAX_ANSWER_MB)) {
            return res.status(400).json({ success: false, message: `File đáp án vượt quá ${MAX_ANSWER_MB}MB.` });
        }
        if (fileTooLarge(files.audioFile, MAX_AUDIO_MB)) {
            return res.status(400).json({ success: false, message: `Audio vượt quá ${MAX_AUDIO_MB}MB.` });
        }

        const jobId = await importService.createJob({
            adminId: req.admin?.id,
            title,
            hskLevel,
            examType,
            files: {
                examPdf: files.examPdf.originalname,
                answerFile: files.answerFile.originalname,
                audioFile: files.audioFile?.originalname || null,
            },
        });

        setImmediate(() => {
            importService.processJob(jobId, files, { title, hskLevel, examType })
                .catch(error => console.error('[hskImport] unhandled job error:', error));
        });

        return res.status(202).json({
            success: true,
            jobId,
            status: 'queued',
            message: 'OCR import job queued.',
        });
    } catch (error) {
        console.error('[hskImport] create error:', error);
        return res.status(500).json({
            success: false,
            message: error.publicMessage || 'Không tạo được OCR import job.',
            error: error.message,
        });
    }
}

async function getImportJob(req, res) {
    try {
        const job = await importService.getJob(req.params.jobId);
        if (!job) return res.status(404).json({ success: false, message: 'Import job not found.' });
        return res.json({ success: true, data: job });
    } catch (error) {
        console.error('[hskImport] get job error:', error);
        return res.status(500).json({ success: false, message: 'Không đọc được trạng thái import.' });
    }
}

module.exports = {
    uploadImportFiles,
    createOcrImport,
    getImportJob,
};

