/**
 * Pitch extraction & tone scoring — pure JS, no native deps.
 *
 * Input: WAV PCM mono 16-bit (the format FE `audioRecorder.ts` produces).
 * Output: array of f0 (Hz) per frame, plus tone-shape scoring helpers.
 *
 * Algorithm: autocorrelation (ACF) with parabolic peak interpolation.
 * Adequate for human voice (~70–500 Hz). For Mandarin tones we only care
 * about the *shape* of the pitch curve, so absolute accuracy is not critical.
 *
 * Frame: 30 ms window, 10 ms hop → 100 f0 values per second.
 */

const FRAME_MS = 30;
const HOP_MS = 10;
const MIN_HZ = 70;
const MAX_HZ = 500;
// Voiced frame minimum RMS (avoid analysing silence/noise as a "voiced" frame)
const VOICED_RMS_THRESHOLD = 0.005;

/**
 * Parse a WAV PCM (16-bit, mono or stereo→mono) Buffer/ArrayBuffer.
 * Returns {sampleRate, samples (Float32Array in [-1, 1])}.
 */
function parseWav(buf) {
    const ab = Buffer.isBuffer(buf)
        ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
        : buf;
    const view = new DataView(ab);
    if (view.byteLength < 44 || view.getUint32(0, false) !== 0x52494646 /* RIFF */) {
        throw new Error('Not a WAV file (no RIFF header)');
    }
    if (view.getUint32(8, false) !== 0x57415645 /* WAVE */) {
        throw new Error('Not a WAV file (no WAVE marker)');
    }

    // Walk chunks to find "fmt " and "data" — header is not always 44 bytes.
    let offset = 12;
    let fmt = null;
    let dataOffset = 0;
    let dataSize = 0;
    while (offset < view.byteLength - 8) {
        const chunkId = view.getUint32(offset, false);
        const chunkSize = view.getUint32(offset + 4, true);
        if (chunkId === 0x666d7420 /* 'fmt ' */) {
            fmt = {
                audioFormat: view.getUint16(offset + 8, true),
                channels: view.getUint16(offset + 10, true),
                sampleRate: view.getUint32(offset + 12, true),
                bitsPerSample: view.getUint16(offset + 22, true),
            };
        } else if (chunkId === 0x64617461 /* 'data' */) {
            dataOffset = offset + 8;
            dataSize = chunkSize;
            break;
        }
        offset += 8 + chunkSize + (chunkSize % 2);
    }
    if (!fmt) throw new Error('WAV: missing fmt chunk');
    if (!dataOffset) throw new Error('WAV: missing data chunk');
    if (fmt.bitsPerSample !== 16) {
        throw new Error(`WAV: expected 16-bit, got ${fmt.bitsPerSample}`);
    }

    const samplesPerChannel = dataSize / (fmt.channels * 2);
    const samples = new Float32Array(samplesPerChannel);
    let s = dataOffset;
    for (let i = 0; i < samplesPerChannel; i++) {
        if (fmt.channels === 1) {
            samples[i] = view.getInt16(s, true) / 32768;
            s += 2;
        } else {
            // Average all channels → mono
            let sum = 0;
            for (let c = 0; c < fmt.channels; c++) {
                sum += view.getInt16(s, true) / 32768;
                s += 2;
            }
            samples[i] = sum / fmt.channels;
        }
    }
    return { sampleRate: fmt.sampleRate, samples };
}

function rms(frame) {
    let s = 0;
    for (let i = 0; i < frame.length; i++) s += frame[i] * frame[i];
    return Math.sqrt(s / frame.length);
}

/**
 * Estimate fundamental frequency of `frame` using autocorrelation.
 * Returns 0 for unvoiced/silent frames.
 */
function autocorrelatePitch(frame, sampleRate) {
    const minLag = Math.floor(sampleRate / MAX_HZ);
    const maxLag = Math.floor(sampleRate / MIN_HZ);
    if (maxLag >= frame.length) return 0;

    let bestLag = -1;
    let bestCorr = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
        let corr = 0;
        for (let i = 0; i < frame.length - lag; i++) {
            corr += frame[i] * frame[i + lag];
        }
        if (corr > bestCorr) {
            bestCorr = corr;
            bestLag = lag;
        }
    }
    if (bestLag < 0 || bestCorr <= 0) return 0;

    // Parabolic interpolation around the peak for sub-sample precision.
    if (bestLag > minLag && bestLag < maxLag) {
        const y0 = sumCorr(frame, bestLag - 1);
        const y1 = bestCorr;
        const y2 = sumCorr(frame, bestLag + 1);
        const denom = (y0 - 2 * y1 + y2);
        if (denom !== 0) {
            const shift = 0.5 * (y0 - y2) / denom;
            return sampleRate / (bestLag + shift);
        }
    }
    return sampleRate / bestLag;
}

function sumCorr(frame, lag) {
    let corr = 0;
    for (let i = 0; i < frame.length - lag; i++) {
        corr += frame[i] * frame[i + lag];
    }
    return corr;
}

/**
 * Extract per-frame f0 (Hz) from raw mono samples.
 * Frames where RMS is below threshold (silence) yield 0.
 */
function extractF0(samples, sampleRate) {
    const frameSize = Math.floor(sampleRate * FRAME_MS / 1000);
    const hopSize = Math.floor(sampleRate * HOP_MS / 1000);
    const out = [];
    for (let start = 0; start + frameSize < samples.length; start += hopSize) {
        const frame = samples.subarray(start, start + frameSize);
        if (rms(frame) < VOICED_RMS_THRESHOLD) {
            out.push(0);
        } else {
            out.push(autocorrelatePitch(frame, sampleRate));
        }
    }
    return out;
}

/**
 * Strip leading/trailing silent (0) frames and trim long internal silences,
 * then resample to `targetLen` points by linear interpolation. Returns null
 * if there are no voiced frames.
 */
function normalizeContour(f0Array, targetLen = 50) {
    const trimmed = [];
    let started = false;
    let trailingSilence = 0;
    for (const v of f0Array) {
        if (v > 0) {
            if (trailingSilence > 0 && started) {
                // Replace short silent gaps inside voiced span with last value
                for (let i = 0; i < trailingSilence; i++) trimmed.push(trimmed[trimmed.length - 1] || v);
                trailingSilence = 0;
            }
            trimmed.push(v);
            started = true;
        } else if (started) {
            trailingSilence++;
        }
    }
    if (trimmed.length < 3) return null;

    // Resample to targetLen with linear interpolation
    const out = new Array(targetLen);
    const step = (trimmed.length - 1) / (targetLen - 1);
    for (let i = 0; i < targetLen; i++) {
        const pos = i * step;
        const lo = Math.floor(pos);
        const hi = Math.min(lo + 1, trimmed.length - 1);
        const t = pos - lo;
        out[i] = trimmed[lo] * (1 - t) + trimmed[hi] * t;
    }
    return out;
}

/**
 * Score how well a user contour matches the expected shape for a Mandarin tone.
 * Tone codes: 1=high level, 2=rising, 3=dipping, 4=falling, 5=neutral.
 * Returns 0..100. Uses normalized log-pitch shape, not absolute frequency.
 */
function scoreToneShape(f0Array, tone) {
    const contour = normalizeContour(f0Array, 50);
    if (!contour) return 0;

    // Log-scale & normalize 0..1 across speaker's range to be octave-independent.
    const logs = contour.map(v => Math.log(v));
    const lo = Math.min(...logs);
    const hi = Math.max(...logs);
    const range = hi - lo || 1e-6;
    const norm = logs.map(v => (v - lo) / range);

    // Template (50 points) per tone
    const tpl = toneTemplate(tone);

    // Mean absolute error vs template, scaled to 0..100
    let err = 0;
    for (let i = 0; i < norm.length; i++) {
        err += Math.abs(norm[i] - tpl[i]);
    }
    const meanErr = err / norm.length;
    // meanErr ~0.05 => excellent, ~0.30 => terrible
    const score = Math.max(0, Math.min(100, Math.round(100 - meanErr * 250)));

    // Also reward range-magnitude for tones that should be expressive (2, 3, 4)
    const expressiveBonus = (tone === 1 || tone === 5)
        ? Math.max(0, 10 - range * 8)         // tone 1/5 should be flat
        : Math.min(10, Math.round(range * 4)); // others should have range
    return Math.max(0, Math.min(100, score + (tone === 1 || tone === 5 ? expressiveBonus : Math.min(expressiveBonus, 100 - score))));
}

function toneTemplate(tone) {
    const t = new Array(50);
    switch (tone) {
        case 1:                                      // flat high (~0.85 throughout)
            for (let i = 0; i < 50; i++) t[i] = 0.85;
            break;
        case 2:                                      // rising 0.2 → 0.95
            for (let i = 0; i < 50; i++) t[i] = 0.2 + 0.75 * (i / 49);
            break;
        case 3:                                      // dip 0.4 → 0.05 → 0.7
            for (let i = 0; i < 50; i++) {
                const x = i / 49;
                t[i] = x < 0.4
                    ? 0.4 - (0.35 * (x / 0.4))
                    : 0.05 + (0.65 * ((x - 0.4) / 0.6));
            }
            break;
        case 4:                                      // falling 0.95 → 0.05
            for (let i = 0; i < 50; i++) t[i] = 0.95 - 0.9 * (i / 49);
            break;
        case 5:                                      // neutral — short, mid, flat
        default:
            for (let i = 0; i < 50; i++) t[i] = 0.5;
            break;
    }
    return t;
}

/**
 * Convenience: parse WAV buffer → contour (50 pts normalized 0..1) + raw f0.
 */
function analyseWav(wavBuffer) {
    const { sampleRate, samples } = parseWav(wavBuffer);
    const f0 = extractF0(samples, sampleRate);
    const contour = normalizeContour(f0, 50);
    return { sampleRate, f0, contour };
}

module.exports = {
    parseWav,
    extractF0,
    normalizeContour,
    scoreToneShape,
    toneTemplate,
    analyseWav,
};
