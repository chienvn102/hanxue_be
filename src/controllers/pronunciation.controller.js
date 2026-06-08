/**
 * Pronunciation Lab Controller — backs the new "Phòng phát âm" tab in /chat.
 *
 * Endpoints (all mounted under /api/pronunciation, all require auth):
 *   GET  /pinyin-chart         — static chart data
 *   GET  /audio?syllable=ma3   — get playable URL (cache → Forvo → Edge TTS)
 *   GET  /minimal-pairs?level= — fetch random pairs from DB, pre-warm audio
 *   GET  /due                  — SRS due list
 *   GET  /stats                — per-user summary
 *   POST /tone-trainer         — multipart audio + body → analyse pitch
 *   POST /tone-match           — JSON body
 *   POST /shadow               — multipart audio + body (optional analysis)
 *   POST /minimal-pair         — JSON body
 *
 * SRS quality mapping (passed to srs.service.nextSrs):
 *   tone-trainer score 0-100 → q = clamp(round(score/20), 0..5)
 *   tone-match     correct/wrong → 5 / 2
 *   minimal-pair   correct/wrong → 5 / 1
 *   shadow         no auto-grade → 3 (recall hard) for now
 */

const pinyinChart = require('../config/pinyinChart');
const syllableAudio = require('../services/syllableAudio.service');
const pitch = require('../services/pitchExtraction.service');
const srsService = require('../services/srs.service');
const pronunciation = require('../models/pronunciation.model');

function err(res, status, message) {
    return res.status(status).json({ success: false, message });
}

function ok(res, data, extra = {}) {
    return res.json({ success: true, data, ...extra });
}

// ────────────────────────────────────────────────────────────
// GET /pinyin-chart
async function getPinyinChart(req, res) {
    return ok(res, {
        initials: pinyinChart.INITIALS,
        finals: pinyinChart.FINALS,
        valid: pinyinChart.VALID,
    });
}

// GET /audio?syllable=ma3
async function getAudio(req, res) {
    const syllable = String(req.query.syllable || '').toLowerCase().trim();
    try {
        const result = await syllableAudio.getSyllableAudio(syllable);
        return ok(res, result);
    } catch (e) {
        return err(res, e.status || 500, e.publicMessage || 'Không tạo được audio.');
    }
}

// GET /minimal-pairs?level=N&limit=M
async function listMinimalPairs(req, res) {
    try {
        const level = req.query.level;
        const limit = req.query.limit;
        const pairs = await pronunciation.getMinimalPairs({ level, limit });

        // Lazy-warm audio for each side (won't block — first call from FE will
        // resolve to disk if already cached). Skip if pair has audio_a/audio_b
        // already set in DB.
        const warmed = await Promise.all(pairs.map(async (p) => {
            const audioA = p.audio_a || await safeAudio(p.syllable_a);
            const audioB = p.audio_b || await safeAudio(p.syllable_b);
            return { ...p, audio_a: audioA, audio_b: audioB };
        }));

        return ok(res, warmed);
    } catch (e) {
        console.error('[pronunciation] listMinimalPairs:', e);
        return err(res, 500, 'Không tải được cặp từ.');
    }
}

async function safeAudio(syllable) {
    try {
        const { audio_url } = await syllableAudio.getSyllableAudio(syllable);
        return audio_url;
    } catch {
        return null;
    }
}

// GET /due
async function getDue(req, res) {
    try {
        const userId = req.user.userId;
        const limit = req.query.limit;
        const rows = await pronunciation.getDueSyllables(userId, limit);
        return ok(res, rows);
    } catch (e) {
        console.error('[pronunciation] getDue:', e);
        return err(res, 500, 'Không lấy được danh sách ôn.');
    }
}

// GET /stats
async function getStats(req, res) {
    try {
        const userId = req.user.userId;
        const stats = await pronunciation.getUserStats(userId);
        return ok(res, stats);
    } catch (e) {
        console.error('[pronunciation] getStats:', e);
        return err(res, 500, 'Không lấy được thống kê.');
    }
}

// POST /tone-trainer
async function toneTrainerSubmit(req, res) {
    const userId = req.user.userId;
    try {
        if (!req.file) {
            return err(res, 400, 'Vui lòng gửi file âm thanh (trường "audio").');
        }
        const syllable = String(req.body.syllable || '').toLowerCase().trim();
        const tone = parseInt(req.body.tone, 10);
        if (!/^[a-zü]+[1-5]$/.test(syllable)) {
            return err(res, 400, 'Âm tiết không hợp lệ (vd "ma3").');
        }
        if (![1, 2, 3, 4, 5].includes(tone)) {
            return err(res, 400, 'Tone phải là 1-5.');
        }

        let nativeContour = null;
        if (req.body.referenceUrl) {
            // FE can pass a native f0 array directly to avoid BE re-fetching the audio.
            try { nativeContour = JSON.parse(req.body.nativeContour || 'null'); } catch { /* ignore */ }
        }

        let analysis;
        try {
            analysis = pitch.analyseWav(req.file.buffer);
        } catch (e) {
            return err(res, 400, `Audio không hợp lệ: ${e.message}`);
        }
        const userContour = analysis.contour;
        if (!userContour) {
            return err(res, 400, 'Không phát hiện được giọng nói. Hãy nói to và rõ hơn.');
        }
        const score = pitch.scoreToneShape(analysis.f0, tone);

        const quality = Math.max(0, Math.min(5, Math.round(score / 20)));
        const srs = srsService.nextSrs(await pronunciation.getSrs(userId, syllable) || {}, quality);

        await pronunciation.upsertSrs(userId, syllable, {
            isCorrect: score >= 60,
            score,
            srs,
        });
        await pronunciation.logAttempt({
            userId,
            drillType: 'tone_trainer',
            syllable,
            pinyinWithTone: syllableAudio.applyToneMark(syllable),
            referenceAudioUrl: req.body.referenceUrl || null,
            score,
            isCorrect: score >= 60,
            details: {
                tone,
                user_contour: userContour.map(v => Math.round(v * 1000) / 1000),
                native_contour: nativeContour,
            },
        });

        const feedback = buildToneFeedback(score, tone);

        return ok(res, {
            score,
            tone,
            syllable,
            user_contour: userContour,
            native_contour: nativeContour,
            template_contour: pitch.toneTemplate(tone),
            feedback_vi: feedback,
            srs: {
                next_review_at: srs.next_review_at,
                interval_days: srs.interval_days,
            },
        });
    } catch (e) {
        console.error('[pronunciation] toneTrainerSubmit:', e);
        return err(res, 500, 'Lỗi chấm tone. Vui lòng thử lại.');
    }
}

function buildToneFeedback(score, tone) {
    const t = { 1: 'cao đều', 2: 'đi lên', 3: 'xuống rồi lên', 4: 'rơi xuống', 5: 'nhẹ trung tính' }[tone] || '';
    if (score >= 85) return `Rất tốt! Đường cao độ của bạn khớp với thanh ${tone} (${t}).`;
    if (score >= 70) return `Khá ổn. Thanh ${tone} cần ${t} — giữ độ dài và biên độ rõ hơn một chút.`;
    if (score >= 50) return `Tạm được. Hình dạng thanh ${tone} là ${t}. Hãy nghe lại bản mẫu và lặp lại 2-3 lần.`;
    return `Cần luyện thêm. Thanh ${tone} phải ${t}. Hãy phóng đại biên độ và nói chậm hơn.`;
}

// POST /tone-match
async function toneMatchSubmit(req, res) {
    const userId = req.user.userId;
    try {
        const syllable = String(req.body.syllable || '').toLowerCase().trim();
        const picked = parseInt(req.body.picked, 10);
        const correct = parseInt(req.body.correct, 10);
        if (!/^[a-zü]+[1-5]$/.test(syllable)) {
            return err(res, 400, 'Âm tiết không hợp lệ.');
        }
        if (![1, 2, 3, 4, 5].includes(picked) || ![1, 2, 3, 4, 5].includes(correct)) {
            return err(res, 400, 'picked/correct phải là 1-5.');
        }
        const isCorrect = picked === correct;
        const quality = isCorrect ? 5 : 2;
        const srs = srsService.nextSrs(await pronunciation.getSrs(userId, syllable) || {}, quality);

        await pronunciation.upsertSrs(userId, syllable, {
            isCorrect,
            score: isCorrect ? 100 : 0,
            srs,
        });
        await pronunciation.logAttempt({
            userId,
            drillType: 'tone_match',
            syllable,
            pinyinWithTone: syllableAudio.applyToneMark(syllable),
            isCorrect,
            score: isCorrect ? 100 : 0,
            details: { picked, correct },
        });

        return ok(res, { correct: isCorrect, picked, expected: correct });
    } catch (e) {
        console.error('[pronunciation] toneMatchSubmit:', e);
        return err(res, 500, 'Lỗi ghi kết quả tone match.');
    }
}

// POST /shadow
async function shadowSubmit(req, res) {
    const userId = req.user.userId;
    try {
        if (!req.file) {
            return err(res, 400, 'Vui lòng gửi file âm thanh.');
        }
        const syllable = String(req.body.syllable || '').toLowerCase().trim();
        if (!/^[a-zü]+[1-5]$/.test(syllable)) {
            return err(res, 400, 'Âm tiết không hợp lệ.');
        }
        const playbackRate = parseFloat(req.body.playbackRate) || 1;

        // Light analysis: just confirm there was voiced audio.
        let analysis;
        try {
            analysis = pitch.analyseWav(req.file.buffer);
        } catch (e) {
            return err(res, 400, `Audio không hợp lệ: ${e.message}`);
        }
        const voicedFrames = analysis.f0.filter(v => v > 0).length;
        const tone = parseInt(req.body.tone, 10);
        const score = (Number.isFinite(tone) && tone >= 1 && tone <= 5)
            ? pitch.scoreToneShape(analysis.f0, tone)
            : Math.min(100, Math.round(voicedFrames * 2));

        const quality = score >= 70 ? 4 : (score >= 50 ? 3 : 2);
        const srs = srsService.nextSrs(await pronunciation.getSrs(userId, syllable) || {}, quality);

        await pronunciation.upsertSrs(userId, syllable, {
            isCorrect: score >= 60,
            score,
            srs,
        });
        await pronunciation.logAttempt({
            userId,
            drillType: 'shadow',
            syllable,
            pinyinWithTone: syllableAudio.applyToneMark(syllable),
            referenceAudioUrl: req.body.referenceUrl || null,
            score,
            isCorrect: score >= 60,
            details: { playbackRate, voicedFrames },
        });

        return ok(res, {
            score,
            voiced_frames: voicedFrames,
            playback_rate: playbackRate,
        });
    } catch (e) {
        console.error('[pronunciation] shadowSubmit:', e);
        return err(res, 500, 'Lỗi ghi shadow.');
    }
}

// POST /minimal-pair
async function minimalPairSubmit(req, res) {
    const userId = req.user.userId;
    try {
        const pairId = parseInt(req.body.pairId, 10);
        const picked = String(req.body.picked || '').toUpperCase();
        const correct = String(req.body.correct || '').toUpperCase();
        if (!Number.isFinite(pairId)) return err(res, 400, 'pairId không hợp lệ.');
        if (!['A', 'B'].includes(picked) || !['A', 'B'].includes(correct)) {
            return err(res, 400, 'picked/correct phải là "A" hoặc "B".');
        }

        const pair = await pronunciation.getMinimalPair(pairId);
        if (!pair) return err(res, 404, 'Không tìm thấy cặp từ.');

        const isCorrect = picked === correct;
        const quality = isCorrect ? 5 : 1;

        // Update SRS for both syllables — even the one not played, since the
        // user demonstrated they can/can't distinguish them.
        for (const syll of [pair.syllable_a, pair.syllable_b]) {
            const srs = srsService.nextSrs(await pronunciation.getSrs(userId, syll) || {}, quality);
            await pronunciation.upsertSrs(userId, syll, {
                isCorrect,
                score: isCorrect ? 100 : 0,
                srs,
            });
        }
        await pronunciation.logAttempt({
            userId,
            drillType: 'minimal_pair',
            syllable: correct === 'A' ? pair.syllable_a : pair.syllable_b,
            isCorrect,
            score: isCorrect ? 100 : 0,
            details: { pair_id: pairId, picked, correct, group_label: pair.group_label },
        });

        return ok(res, {
            correct: isCorrect,
            picked,
            expected: correct,
            char_correct: correct === 'A' ? pair.char_a : pair.char_b,
            hint_vi: pair.hint_vi,
        });
    } catch (e) {
        console.error('[pronunciation] minimalPairSubmit:', e);
        return err(res, 500, 'Lỗi ghi kết quả.');
    }
}

module.exports = {
    getPinyinChart,
    getAudio,
    listMinimalPairs,
    getDue,
    getStats,
    toneTrainerSubmit,
    toneMatchSubmit,
    shadowSubmit,
    minimalPairSubmit,
};
