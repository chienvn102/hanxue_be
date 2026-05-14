const { pinyin } = require('pinyin-pro');

function convert(text) {
    if (!text) return [];
    return pinyin(text, {
        toneType: 'symbol',
        type: 'array',
        nonZh: 'removed',
    });
}

module.exports = {
    convert,
};
