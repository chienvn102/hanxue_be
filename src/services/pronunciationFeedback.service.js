/**
 * Pronunciation Feedback Service
 * Rule engine for generating detailed Vietnamese feedback
 * Based on phoneme-level assessment results
 */

/**
 * Common pronunciation errors for Vietnamese learners
 * Maps phonemes to Vietnamese feedback
 */
const PRONUNCIATION_RULES = {
    // zh/ch/sh confusion
    'zh': {
        alternatives: ['ch', 'sh'],
        feedback: 'Âm zh (như trong 知道) cần đặt lưỡi hơi sau, hơi cong lên. Đừng đọc như ch hay sh.',
        vietnameseTip: 'Giống chữ "tr" trong "trà" nhưng hơi cong lưỡi hơn.'
    },
    'ch': {
        alternatives: ['zh', 'sh'],
        feedback: 'Âm ch (như trong 吃饭) cần đặt lưỡi sau răng, hơi cong lên.',
        vietnameseTip: 'Giống chữ "tr" trong "trà".'
    },
    'sh': {
        alternatives: ['zh', 'ch'],
        feedback: 'Âm sh (như trong 时间) cần đặt lưỡi sau răng, hơi cong lên.',
        vietnameseTip: 'Giống chữ "s" trong "sữa" nhưng hơi cong lưỡi.'
    },

    // j/q/x confusion
    'j': {
        alternatives: ['q', 'x'],
        feedback: 'Âm j (như trong 家) cần đặt lưỡi sau răng, hơi cong lên.',
        vietnameseTip: 'Giống chữ "gi" trong "già".'
    },
    'q': {
        alternatives: ['j', 'x'],
        feedback: 'Âm q (như trong 去) cần đặt lưỡi sau răng, hơi cong lên.',
        vietnameseTip: 'Giống chữ "c" trong "cà" nhưng hơi cong lưỡi.'
    },
    'x': {
        alternatives: ['j', 'q'],
        feedback: 'Âm x (như trong 小) cần đặt lưỡi sau răng, hơi cong lên.',
        vietnameseTip: 'Giống chữ "s" trong "sữa".'
    },

    // z/c/s confusion
    'z': {
        alternatives: ['c', 's'],
        feedback: 'Âm z (như trong 在) cần đặt lưỡi sau răng, hơi cong lên.',
        vietnameseTip: 'Giống chữ "d" trong "đà" nhưng hơi cong lưỡi.'
    },
    'c': {
        alternatives: ['z', 's'],
        feedback: 'Âm c (như trong 次) cần đặt lưỡi sau răng, hơi cong lên.',
        vietnameseTip: 'Giống chữ "t" trong "tà" nhưng hơi cong lưỡi.'
    },
    's': {
        alternatives: ['z', 'c'],
        feedback: 'Âm s (như trong 三) cần đặt lưỡi sau răng, hơi cong lên.',
        vietnameseTip: 'Giống chữ "s" trong "sữa".'
    },

    // n/l confusion
    'n': {
        alternatives: ['l'],
        feedback: 'Âm n (như trong 你) cần đặt lưỡi sau răng, hơi cong lên.',
        vietnameseTip: 'Giống chữ "n" trong "nha".'
    },
    'l': {
        alternatives: ['n'],
        feedback: 'Âm l (như trong 来) cần đặt lưỡi sau răng, hơi cong lên.',
        vietnameseTip: 'Giống chữ "l" trong "la".'
    },

    // r sound
    'r': {
        alternatives: [],
        feedback: 'Âm r (như trong 人) cần đặt lưỡi sau răng, hơi cong lên.',
        vietnameseTip: 'Giống chữ "r" trong "ra" nhưng hơi cong lưỡi.'
    },

    // ü sound
    'ü': {
        alternatives: ['u'],
        feedback: 'Âm ü (như trong 去) cần đặt lưỡi hơi cong lên, hơi mở miệng.',
        vietnameseTip: 'Giống chữ "ư" trong "ư".'
    },

    // en/eng, in/ing confusion
    'en': {
        alternatives: ['eng'],
        feedback: 'Âm en (như trong 本) cần đặt lưỡi sau răng, hơi cong lên.',
        vietnameseTip: 'Giống chữ "en" trong "en".'
    },
    'eng': {
        alternatives: ['en'],
        feedback: 'Âm eng (như trong 朋) cần đặt lưỡi sau răng, hơi cong lên.',
        vietnameseTip: 'Giống chữ "eng" trong "eng".'
    },
    'in': {
        alternatives: ['ing'],
        feedback: 'Âm in (như trong 新) cần đặt lưỡi sau răng, hơi cong lên.',
        vietnameseTip: 'Giống chữ "in" trong "in".'
    },
    'ing': {
        alternatives: ['in'],
        feedback: 'Âm ing (như trong 听) cần đặt lưỡi sau răng, hơi cong lên.',
        vietnameseTip: 'Giống chữ "ing" trong "ing".'
    }
};

/**
 * Tone rules for Vietnamese learners
 */
const TONE_RULES = {
    2: {
        feedback: 'Thanh điệu 2 (má) cần giọng lên cao.',
        vietnameseTip: 'Giống thanh "á" trong tiếng Việt.'
    },
    3: {
        feedback: 'Thanh điệu 3 (mǎ) cần giọng xuống thấp rồi lên cao.',
        vietnameseTip: 'Giống thanh "ả" trong tiếng Việt.'
    },
    4: {
        feedback: 'Thanh điệu 4 (mà) cần giọng xuống thấp đột ngột.',
        vietnameseTip: 'Giống thanh "à" trong tiếng Việt.'
    },
    5: {
        feedback: 'Thanh điệu nhẹ (ma) cần giọng ngắn, nhẹ.',
        vietnameseTip: 'Giống thanh "a" trong tiếng Việt.'
    }
};

/**
 * Aspiration pairs rules
 */
const ASPIRATION_RULES = {
    'b': {
        pair: 'p',
        feedback: 'Âm b (như trong 不) cần không có hơi thở mạnh.',
        vietnameseTip: 'Giống chữ "b" trong tiếng Việt.'
    },
    'p': {
        pair: 'b',
        feedback: 'Âm p (như trong 怕) cần có hơi thở mạnh.',
        vietnameseTip: 'Giống chữ "ph" trong tiếng Việt.'
    },
    'd': {
        pair: 't',
        feedback: 'Âm d (như trong 的) cần không có hơi thở mạnh.',
        vietnameseTip: 'Giống chữ "đ" trong tiếng Việt.'
    },
    't': {
        pair: 'd',
        feedback: 'Âm t (như trong 他) cần có hơi thở mạnh.',
        vietnameseTip: 'Giống chữ "t" trong tiếng Việt.'
    },
    'g': {
        pair: 'k',
        feedback: 'Âm g (như trong 个) cần không có hơi thở mạnh.',
        vietnameseTip: 'Giống chữ "g" trong tiếng Việt.'
    },
    'k': {
        pair: 'g',
        feedback: 'Âm k (như trong 可) cần có hơi thở mạnh.',
        vietnameseTip: 'Giống chữ "kh" trong tiếng Việt.'
    }
};

/**
 * Apical vowel rules (zi/ci/si vs zhi/chi/shi/ri)
 */
const APICAL_VOWEL_RULES = {
    'zi': {
        feedback: 'Âm zi (như trong 字) cần đặt lưỡi sau răng, hơi cong lên.',
        vietnameseTip: 'Giống chữ "tư" trong tiếng Việt.'
    },
    'ci': {
        feedback: 'Âm ci (như trong 次) cần đặt lưỡi sau răng, hơi cong lên.',
        vietnameseTip: 'Giống chữ "tư" trong tiếng Việt.'
    },
    'si': {
        feedback: 'Âm si (như trong 四) cần đặt lưỡi sau răng, hơi cong lên.',
        vietnameseTip: 'Giống chữ "tư" trong tiếng Việt.'
    },
    'zhi': {
        feedback: 'Âm zhi (như trong 知) cần đặt lưỡi sau răng, hơi cong lên.',
        vietnameseTip: 'Giống chữ "tri" trong tiếng Việt.'
    },
    'chi': {
        feedback: 'Âm chi (như trong 吃) cần đặt lưỡi sau răng, hơi cong lên.',
        vietnameseTip: 'Giống chữ "tri" trong tiếng Việt.'
    },
    'shi': {
        feedback: 'Âm shi (như trong 是) cần đặt lưỡi sau răng, hơi cong lên.',
        vietnameseTip: 'Giống chữ "tri" trong tiếng Việt.'
    },
    'ri': {
        feedback: 'Âm ri (như trong 日) cần đặt lưỡi sau răng, hơi cong lên.',
        vietnameseTip: 'Giống chữ "ri" trong tiếng Việt.'
    }
};

/**
 * Final vowel rules (an/ang, ian/iang, uan/uang, ong)
 */
const FINAL_VOWEL_RULES = {
    'an': {
        pair: 'ang',
        feedback: 'Âm an (như trong 安) cần không có âm mũi.',
        vietnameseTip: 'Giống chữ "an" trong tiếng Việt.'
    },
    'ang': {
        pair: 'an',
        feedback: 'Âm ang (như trong 忙) cần có âm mũi.',
        vietnameseTip: 'Giống chữ "ang" trong tiếng Việt.'
    },
    'ian': {
        pair: 'iang',
        feedback: 'Âm ian (như trong 天) cần không có âm mũi.',
        vietnameseTip: 'Giống chữ "iên" trong tiếng Việt.'
    },
    'iang': {
        pair: 'ian',
        feedback: 'Âm iang (như trong 想) cần có âm mũi.',
        vietnameseTip: 'Giống chữ "iêng" trong tiếng Việt.'
    },
    'uan': {
        pair: 'uang',
        feedback: 'Âm uan (như trong 短) cần không có âm mũi.',
        vietnameseTip: 'Giống chữ "oan" trong tiếng Việt.'
    },
    'uang': {
        pair: 'uan',
        feedback: 'Âm uang (như trong 光) cần có âm mũi.',
        vietnameseTip: 'Giống chữ "oang" trong tiếng Việt.'
    },
    'ong': {
        feedback: 'Âm ong (như trong 中) cần có âm mũi.',
        vietnameseTip: 'Giống chữ "ông" trong tiếng Việt.'
    }
};

/**
 * Generate detailed feedback based on pronunciation result
 * @param {Object} pronResult - Result from Azure Speech
 * @returns {string} - Vietnamese feedback text
 */
function generateFeedback(pronResult) {
    const score = pronResult.pronunciationScore;
    const accuracy = pronResult.accuracyScore;
    const fluency = pronResult.fluencyScore;
    const completeness = pronResult.completenessScore;
    const weakPhonemes = pronResult.weakPhonemes || [];
    const words = pronResult.words || [];

    let feedback = '';

    // Overall feedback
    if (score >= 90) {
        feedback = '太棒了！你的发音非常标准。';
    } else if (score >= 80) {
        feedback = '很好！你的发音很不错。';
    } else if (score >= 70) {
        feedback = '不错！继续努力。';
    } else if (score >= 60) {
        feedback = '还可以，但需要多练习。';
    } else {
        feedback = '需要多加练习。';
    }

    // ✅ NEW: Pace guidance based on fluency
    if (fluency < 60) {
        feedback += ' 你读得太快了，试着读慢一点，每个字都要读清楚。';
    } else if (fluency < 70) {
        feedback += ' 试着读得更连贯一些，不要停顿太多。';
    } else if (fluency > 90) {
        feedback += ' 你的语速很好，很自然。';
    }

    // ✅ NEW: Missing/repeated syllable based on completeness + miscue
    if (completeness < 70) {
        feedback += ' 你漏掉了一些字，要确保读完整句话。';
    } else if (completeness < 85) {
        feedback += ' 注意不要漏掉任何字。';
    }

    // Specific feedback
    if (accuracy < 70) {
        feedback += ' 准确度需要提高，注意每个字的发音。';
    }

    // ✅ NEW: Phoneme-level feedback with enhanced rules
    if (weakPhonemes.length > 0) {
        feedback += ' 特别是：';

        // Group by phoneme type
        const phonemeGroups = {};
        weakPhonemes.forEach(p => {
            if (!phonemeGroups[p.phoneme]) {
                phonemeGroups[p.phoneme] = [];
            }
            phonemeGroups[p.phoneme].push(p.word);
        });

        // Generate feedback for each weak phoneme
        Object.keys(phonemeGroups).forEach(phoneme => {
            const words = phonemeGroups[phoneme].join('、');

            // Check all rule types
            let rule = PRONUNCIATION_RULES[phoneme];
            if (!rule) rule = ASPIRATION_RULES[phoneme];
            if (!rule) rule = APICAL_VOWEL_RULES[phoneme];
            if (!rule) rule = FINAL_VOWEL_RULES[phoneme];

            if (rule) {
                feedback += `${words} 中的${phoneme}音需要多练习。${rule.feedback} ${rule.vietnameseTip} `;
            } else {
                feedback += `${words} 中的${phoneme}音需要多练习。`;
            }
        });
    }

    // ✅ NEW: Tone-level feedback
    const toneIssues = analyzeToneIssues(words);
    if (toneIssues.length > 0) {
        feedback += ' 注意声调：';
        toneIssues.forEach(issue => {
            const rule = TONE_RULES[issue.tone];
            if (rule) {
                feedback += `${issue.word} 的声调${issue.tone}需要改进。${rule.feedback} ${rule.vietnameseTip} `;
            }
        });
    }

    // Word-level feedback (keep for reference)
    if (words.length > 0) {
        const problemWords = words.filter(w => w.accuracyScore < 70);
        if (problemWords.length > 0 && weakPhonemes.length === 0 && toneIssues.length === 0) {
            // Only show word-level if no phoneme-level or tone-level feedback
            feedback += ' 特别是：';
            problemWords.forEach(w => {
                feedback += `${w.word} 这个字需要多练习。`;
            });
        }

        const goodWords = words.filter(w => w.accuracyScore >= 85);
        if (goodWords.length > 0) {
            feedback += ' 读得好的字有：';
            goodWords.forEach(w => {
                feedback += `${w.word}、`;
            });
            feedback = feedback.slice(0, -1) + '。';
        }
    }

    return feedback;
}

/**
 * Analyze tone issues from word-level data
 * @param {Array} words - Word data from Azure Speech
 * @returns {Array} - Tone issues
 */
function analyzeToneIssues(words) {
    const toneIssues = [];

    // This is a simplified analysis - in production, you'd need more sophisticated tone detection
    // Azure Speech SDK doesn't provide detailed tone information, so this is a placeholder
    // You might need to integrate with a tone detection service or use heuristics

    words.forEach(word => {
        // Placeholder: In production, you'd analyze the word's pinyin and compare with expected tones
        // For now, we'll just check if the word has low accuracy and might be a tone issue
        if (word.accuracyScore < 70 && word.errorType === 'Mispronunciation') {
            // This is a simplified check - in production, you'd need actual tone analysis
            // For now, we'll just flag it as a potential tone issue
            // You could integrate with a pinyin library to get the expected tone
        }
    });

    return toneIssues;
}

module.exports = {
    generateFeedback,
    PRONUNCIATION_RULES,
    TONE_RULES,
    ASPIRATION_RULES,
    APICAL_VOWEL_RULES,
    FINAL_VOWEL_RULES
};