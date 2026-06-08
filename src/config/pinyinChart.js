/**
 * Static pinyin chart data — 23 initials × 36 finals, plus the table of valid
 * Mandarin syllables (not every initial × final combination exists).
 *
 * Source: standard pinyin table per HSK 1-3 textbooks; covers ~415 base
 * syllables (without tones). Adapted from the pinyin table commonly taught
 * in Vietnamese-language HSK textbooks.
 */

const INITIALS = [
    '∅',   // zero initial (just final, e.g. "a", "an", "ang")
    'b', 'p', 'm', 'f',
    'd', 't', 'n', 'l',
    'g', 'k', 'h',
    'j', 'q', 'x',
    'zh', 'ch', 'sh', 'r',
    'z', 'c', 's',
    'y', 'w',
];

const FINALS = [
    'a', 'o', 'e', 'i', 'u', 'ü',
    'ai', 'ei', 'ao', 'ou',
    'an', 'en', 'in', 'un', 'ün',
    'ang', 'eng', 'ing', 'ong',
    'ia', 'ie', 'iao', 'iu', 'ian', 'iang', 'iong',
    'ua', 'uo', 'uai', 'ui', 'uan', 'uang', 'ueng',
    'üe', 'üan', 'er',
];

/**
 * Map of initial → array of finals it pairs with to form a valid syllable.
 * "∅" means the final stands alone (e.g. "a", "ai", "an").
 * After "j/q/x", "ü" is written as "u" but listed here as "ü" for clarity.
 * After "y", "i+" finals lose the "i" (yi, ya, ye, yao, you, yan, yang, ying,
 * yong, yu, yue, yuan, yun); these are represented under "y" with the original
 * final name (i, ia, ie, …). The FE uses this to know what audio key to fetch.
 */
const VALID = {
    '∅': ['a', 'o', 'e', 'ai', 'ei', 'ao', 'ou', 'an', 'en', 'ang', 'eng', 'er'],
    'b': ['a', 'o', 'i', 'u', 'ai', 'ei', 'ao', 'an', 'en', 'in', 'ang', 'eng', 'ing', 'ie', 'iao', 'ian'],
    'p': ['a', 'o', 'i', 'u', 'ai', 'ei', 'ao', 'ou', 'an', 'en', 'in', 'ang', 'eng', 'ing', 'ie', 'iao', 'ian'],
    'm': ['a', 'o', 'e', 'i', 'u', 'ai', 'ei', 'ao', 'ou', 'an', 'en', 'in', 'ang', 'eng', 'ing', 'ie', 'iao', 'iu', 'ian'],
    'f': ['a', 'o', 'u', 'ei', 'an', 'en', 'ang', 'eng', 'ou'],
    'd': ['a', 'e', 'i', 'u', 'ai', 'ei', 'ao', 'ou', 'an', 'en', 'ang', 'eng', 'ing', 'ie', 'iao', 'iu', 'ian', 'iang', 'ong', 'uo', 'ui', 'uan'],
    't': ['a', 'e', 'i', 'u', 'ai', 'ao', 'ou', 'an', 'ang', 'eng', 'ing', 'ie', 'iao', 'ian', 'ong', 'uo', 'ui', 'uan'],
    'n': ['a', 'e', 'i', 'u', 'ü', 'ai', 'ei', 'ao', 'ou', 'an', 'en', 'in', 'ang', 'eng', 'ing', 'ie', 'iao', 'iu', 'ian', 'iang', 'ong', 'uo', 'uan', 'üe'],
    'l': ['a', 'e', 'i', 'u', 'ü', 'ai', 'ei', 'ao', 'ou', 'an', 'in', 'ang', 'eng', 'ing', 'ia', 'ie', 'iao', 'iu', 'ian', 'iang', 'ong', 'uo', 'uan', 'un', 'üe'],
    'g': ['a', 'e', 'u', 'ai', 'ei', 'ao', 'ou', 'an', 'en', 'ang', 'eng', 'ong', 'ua', 'uo', 'uai', 'ui', 'uan', 'un', 'uang'],
    'k': ['a', 'e', 'u', 'ai', 'ao', 'ou', 'an', 'en', 'ang', 'eng', 'ong', 'ua', 'uo', 'uai', 'ui', 'uan', 'un', 'uang'],
    'h': ['a', 'e', 'u', 'ai', 'ei', 'ao', 'ou', 'an', 'en', 'ang', 'eng', 'ong', 'ua', 'uo', 'uai', 'ui', 'uan', 'un', 'uang'],
    'j': ['i', 'ü', 'ia', 'ie', 'iao', 'iu', 'ian', 'iang', 'in', 'ing', 'iong', 'üe', 'üan', 'ün'],
    'q': ['i', 'ü', 'ia', 'ie', 'iao', 'iu', 'ian', 'iang', 'in', 'ing', 'iong', 'üe', 'üan', 'ün'],
    'x': ['i', 'ü', 'ia', 'ie', 'iao', 'iu', 'ian', 'iang', 'in', 'ing', 'iong', 'üe', 'üan', 'ün'],
    'zh': ['a', 'e', 'i', 'u', 'ai', 'ei', 'ao', 'ou', 'an', 'en', 'ang', 'eng', 'ong', 'ua', 'uo', 'uai', 'ui', 'uan', 'un', 'uang'],
    'ch': ['a', 'e', 'i', 'u', 'ai', 'ao', 'ou', 'an', 'en', 'ang', 'eng', 'ong', 'ua', 'uo', 'uai', 'ui', 'uan', 'un', 'uang'],
    'sh': ['a', 'e', 'i', 'u', 'ai', 'ei', 'ao', 'ou', 'an', 'en', 'ang', 'eng', 'ua', 'uo', 'uai', 'ui', 'uan', 'un', 'uang'],
    'r': ['e', 'i', 'u', 'ao', 'ou', 'an', 'en', 'ang', 'eng', 'ong', 'uo', 'ui', 'uan', 'un'],
    'z': ['a', 'e', 'i', 'u', 'ai', 'ei', 'ao', 'ou', 'an', 'en', 'ang', 'eng', 'ong', 'uo', 'ui', 'uan', 'un'],
    'c': ['a', 'e', 'i', 'u', 'ai', 'ao', 'ou', 'an', 'en', 'ang', 'eng', 'ong', 'uo', 'ui', 'uan', 'un'],
    's': ['a', 'e', 'i', 'u', 'ai', 'ao', 'ou', 'an', 'en', 'ang', 'eng', 'ong', 'uo', 'ui', 'uan', 'un'],
    // For y/w, finals listed match how they are written when standalone:
    //   yi=i, ya=ia, ye=ie, yao=iao, you=iu, yan=ian, yang=iang, ying=ing, yong=iong
    //   yu=ü, yue=üe, yuan=üan, yun=ün
    'y': ['i', 'ia', 'ie', 'iao', 'iu', 'ian', 'iang', 'ing', 'iong', 'ü', 'üe', 'üan', 'ün'],
    //   wu=u, wa=ua, wo=uo, wai=uai, wei=ui, wan=uan, wen=un, wang=uang, weng=ueng
    'w': ['u', 'ua', 'uo', 'uai', 'ui', 'uan', 'un', 'uang', 'ueng'],
};

/**
 * Render syllable string from (initial, final) — handles j/q/x dropping ü→u
 * dieresis, y/w as zero-initial replacements, and zero-initial finals.
 * Tone digit appended.
 */
function buildSyllable(initial, final, tone) {
    let base;
    if (initial === '∅') {
        base = final;
    } else if (initial === 'y') {
        // i → yi, ia → ya, ü → yu, üe → yue, etc.
        if (final === 'i') base = 'yi';
        else if (final === 'in') base = 'yin';
        else if (final === 'ing') base = 'ying';
        else if (final === 'ü') base = 'yu';
        else if (final === 'üe') base = 'yue';
        else if (final === 'üan') base = 'yuan';
        else if (final === 'ün') base = 'yun';
        else if (final.startsWith('i')) base = 'y' + final.slice(1);
        else base = 'y' + final;
    } else if (initial === 'w') {
        if (final === 'u') base = 'wu';
        else if (final.startsWith('u')) base = 'w' + final.slice(1);
        else base = 'w' + final;
    } else if (['j', 'q', 'x'].includes(initial)) {
        // ü → u in writing (only context-dependent)
        const f = final.replace(/ü/g, 'u');
        base = initial + f;
    } else {
        base = initial + final;
    }
    return base + String(tone || 1);
}

module.exports = {
    INITIALS,
    FINALS,
    VALID,
    buildSyllable,
};
