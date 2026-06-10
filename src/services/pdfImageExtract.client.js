/**
 * Client for the hanxue-pdf-extract Cloud Run service.
 *
 * Offloads PDF → image extraction OFF the 1GB droplet (rasterizing PDFs on the
 * droplet risks OOM — same failure mode as the Edge TTS incident). The Cloud Run
 * service pulls embedded images, maps them to question numbers, uploads crops to
 * GCS, and returns gs:// references this droplet stores on questions.
 *
 * Auth: Cloud Run is deployed with --no-allow-unauthenticated. We mint a Google
 * ID token (audience = service URL) using the droplet's service account
 * (GOOGLE_APPLICATION_CREDENTIALS) and send it as a Bearer token. No shared
 * secret to manage.
 *
 * NOTE: This client is intentionally NOT wired into the live OCR import flow yet.
 * Wiring happens in a follow-up once the Cloud Run service is deployed + the
 * URL is set in PDF_EXTRACT_URL. Until then the import flow is unchanged.
 *
 * Required env:
 *   PDF_EXTRACT_URL  — full https URL of the deployed Cloud Run service
 *                      (e.g. https://hanxue-pdf-extract-xxxx.a.run.app)
 *   PDF_EXTRACT_TIMEOUT_MS — optional, default 120000
 */

const PDF_EXTRACT_URL = process.env.PDF_EXTRACT_URL || '';
const PDF_EXTRACT_TIMEOUT_MS = parseInt(process.env.PDF_EXTRACT_TIMEOUT_MS || '120000', 10);

let _idTokenClient = null;

/**
 * Lazily build a google-auth-library ID-token client bound to the Cloud Run
 * audience. Reused across calls.
 */
async function getIdTokenClient() {
    if (_idTokenClient) return _idTokenClient;
    if (!PDF_EXTRACT_URL) {
        const e = new Error('PDF_EXTRACT_URL not configured');
        e.publicMessage = 'Dịch vụ tách ảnh PDF chưa được cấu hình.';
        e.status = 503;
        throw e;
    }
    const { GoogleAuth } = require('google-auth-library');
    const auth = new GoogleAuth();
    _idTokenClient = await auth.getIdTokenClient(PDF_EXTRACT_URL);
    return _idTokenClient;
}

function isConfigured() {
    return Boolean(PDF_EXTRACT_URL);
}

/**
 * Ask Cloud Run to extract images from a PDF already stored in GCS.
 *
 * @param {object} params
 * @param {string} params.pdfGs   — gs://bucket/object of the exam PDF
 * @param {string|number} params.jobId
 * @param {number} [params.level]
 * @returns {Promise<{images: Array, warnings: string[]}>}
 *   images: [{ question_number, kind, gs_url, page, bbox }]
 */
async function extractImages({ pdfGs, jobId, level }) {
    const client = await getIdTokenClient();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PDF_EXTRACT_TIMEOUT_MS);
    try {
        // google-auth-library's client.request adds the ID token automatically.
        const res = await client.request({
            url: `${PDF_EXTRACT_URL.replace(/\/$/, '')}/extract`,
            method: 'POST',
            data: { pdf_gs: pdfGs, job_id: String(jobId), level: level || null },
            timeout: PDF_EXTRACT_TIMEOUT_MS,
            responseType: 'json',
            signal: controller.signal,
        });
        const body = res.data || {};
        return {
            images: Array.isArray(body.images) ? body.images : [],
            warnings: Array.isArray(body.warnings) ? body.warnings : [],
        };
    } catch (err) {
        const e = new Error(`pdf-extract call failed: ${err.message}`);
        e.publicMessage = 'Không tách được ảnh từ PDF (dịch vụ tách ảnh lỗi).';
        e.status = 502;
        throw e;
    } finally {
        clearTimeout(timer);
    }
}

module.exports = {
    isConfigured,
    extractImages,
};
