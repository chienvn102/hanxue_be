/**
 * Practice Texts Service
 *
 * Strategy:
 *  1. Default: ask Groq to generate a fresh, diverse Chinese sentence per request
 *     (HSK-bounded vocabulary + length target per level + diversity hint).
 *  2. Fallback: pick from the static corpus below if Groq fails / is unavailable.
 *
 * The static corpus is intentionally larger than before (≥ 20 per level) so
 * that the fallback path also feels varied, not just the Groq path.
 */

const groqService = require('../services/groq');

/**
 * Length / structure guidance per HSK level.
 * Used both in the Groq prompt and to validate the response length.
 */
const LEVEL_GUIDE = {
    1: { minChars: 4,  maxChars: 12, style: 'một câu chào hỏi hoặc câu đơn giản hằng ngày' },
    2: { minChars: 6,  maxChars: 16, style: 'một câu thông dụng về sinh hoạt, công việc nhẹ' },
    3: { minChars: 10, maxChars: 22, style: 'một câu mô tả thói quen, sở thích, hoặc kế hoạch ngắn' },
    4: { minChars: 14, maxChars: 30, style: 'một câu trình bày ý kiến, cảm xúc, hoặc quan điểm rõ ràng' },
    5: { minChars: 20, maxChars: 45, style: 'một câu phức về xã hội, công việc, văn hóa, có mệnh đề phụ' },
    6: { minChars: 25, maxChars: 60, style: 'một câu học thuật / báo chí có cấu trúc phức, dùng liên từ' },
};

/**
 * Static fallback corpus — used only when Groq is unavailable.
 * Each level has ≥ 20 entries to keep variety high in the fallback path.
 */
const BASE_PRACTICE_TEXTS = {
    1: [
        { id: 1,  text: '你好',           pinyin: 'nǐ hǎo',                  meaning: 'Xin chào' },
        { id: 2,  text: '谢谢',           pinyin: 'xiè xie',                 meaning: 'Cảm ơn' },
        { id: 3,  text: '再见',           pinyin: 'zài jiàn',                meaning: 'Tạm biệt' },
        { id: 4,  text: '对不起',         pinyin: 'duì bu qǐ',               meaning: 'Xin lỗi' },
        { id: 5,  text: '没关系',         pinyin: 'méi guān xi',             meaning: 'Không sao' },
        { id: 6,  text: '我很好',         pinyin: 'wǒ hěn hǎo',              meaning: 'Tôi rất tốt' },
        { id: 7,  text: '你叫什么名字',   pinyin: 'nǐ jiào shén me míng zi', meaning: 'Bạn tên là gì' },
        { id: 8,  text: '我是中国人',     pinyin: 'wǒ shì zhōng guó rén',    meaning: 'Tôi là người Trung Quốc' },
        { id: 9,  text: '很高兴认识你',   pinyin: 'hěn gāo xìng rèn shi nǐ', meaning: 'Rất vui được gặp bạn' },
        { id: 10, text: '今天天气很好',   pinyin: 'jīn tiān tiān qì hěn hǎo',meaning: 'Hôm nay trời rất đẹp' },
        { id: 11, text: '我爱你',         pinyin: 'wǒ ài nǐ',                meaning: 'Tôi yêu bạn' },
        { id: 12, text: '请进',           pinyin: 'qǐng jìn',                meaning: 'Mời vào' },
        { id: 13, text: '我在学习',       pinyin: 'wǒ zài xué xí',           meaning: 'Tôi đang học' },
        { id: 14, text: '这是我的书',     pinyin: 'zhè shì wǒ de shū',       meaning: 'Đây là sách của tôi' },
        { id: 15, text: '他是我的朋友',   pinyin: 'tā shì wǒ de péng you',   meaning: 'Anh ấy là bạn tôi' },
        { id: 16, text: '我有一只猫',     pinyin: 'wǒ yǒu yī zhī māo',       meaning: 'Tôi có một con mèo' },
        { id: 17, text: '我会说一点中文', pinyin: 'wǒ huì shuō yī diǎn zhōng wén', meaning: 'Tôi biết nói chút tiếng Trung' },
        { id: 18, text: '老师好',         pinyin: 'lǎo shī hǎo',             meaning: 'Chào thầy/cô' },
        { id: 19, text: '我喜欢苹果',     pinyin: 'wǒ xǐ huan píng guǒ',     meaning: 'Tôi thích táo' },
        { id: 20, text: '现在是早上',     pinyin: 'xiàn zài shì zǎo shang',  meaning: 'Bây giờ là buổi sáng' },
    ],
    2: [
        { id: 21, text: '我想学中文',                 pinyin: 'wǒ xiǎng xué zhōng wén',           meaning: 'Tôi muốn học tiếng Trung' },
        { id: 22, text: '这个多少钱',                 pinyin: 'zhè ge duō shǎo qián',             meaning: 'Cái này bao nhiêu tiền' },
        { id: 23, text: '我有一个问题',               pinyin: 'wǒ yǒu yī gè wèn tí',              meaning: 'Tôi có một câu hỏi' },
        { id: 24, text: '你能帮我吗',                 pinyin: 'nǐ néng bāng wǒ ma',               meaning: 'Bạn có thể giúp tôi không' },
        { id: 25, text: '我不太明白',                 pinyin: 'wǒ bù tài míng bai',               meaning: 'Tôi không hiểu lắm' },
        { id: 26, text: '请再说一遍',                 pinyin: 'qǐng zài shuō yī biàn',            meaning: 'Xin nói lại một lần' },
        { id: 27, text: '我有点累了',                 pinyin: 'wǒ yǒu diǎn lèi le',               meaning: 'Tôi hơi mệt rồi' },
        { id: 28, text: '现在几点了',                 pinyin: 'xiàn zài jǐ diǎn le',              meaning: 'Bây giờ mấy giờ rồi' },
        { id: 29, text: '我饿了，想吃饭',             pinyin: 'wǒ è le, xiǎng chī fàn',           meaning: 'Tôi đói rồi, muốn ăn cơm' },
        { id: 30, text: '我想喝一杯水',               pinyin: 'wǒ xiǎng hē yī bēi shuǐ',          meaning: 'Tôi muốn uống một cốc nước' },
        { id: 31, text: '今天我去图书馆',             pinyin: 'jīn tiān wǒ qù tú shū guǎn',       meaning: 'Hôm nay tôi đi thư viện' },
        { id: 32, text: '我喜欢看电影',               pinyin: 'wǒ xǐ huan kàn diàn yǐng',         meaning: 'Tôi thích xem phim' },
        { id: 33, text: '我每天都跑步',               pinyin: 'wǒ měi tiān dōu pǎo bù',           meaning: 'Tôi chạy bộ mỗi ngày' },
        { id: 34, text: '我家有四口人',               pinyin: 'wǒ jiā yǒu sì kǒu rén',            meaning: 'Nhà tôi có bốn người' },
        { id: 35, text: '我哥哥比我大',               pinyin: 'wǒ gē ge bǐ wǒ dà',                meaning: 'Anh tôi lớn hơn tôi' },
        { id: 36, text: '我已经吃过饭了',             pinyin: 'wǒ yǐ jīng chī guò fàn le',        meaning: 'Tôi đã ăn cơm rồi' },
        { id: 37, text: '昨天我很忙',                 pinyin: 'zuó tiān wǒ hěn máng',             meaning: 'Hôm qua tôi rất bận' },
        { id: 38, text: '请把书给我',                 pinyin: 'qǐng bǎ shū gěi wǒ',               meaning: 'Xin đưa sách cho tôi' },
        { id: 39, text: '这个东西真便宜',             pinyin: 'zhè ge dōng xi zhēn pián yi',      meaning: 'Cái này thật rẻ' },
        { id: 40, text: '我们一起去吃饭吧',           pinyin: 'wǒ men yī qǐ qù chī fàn ba',       meaning: 'Chúng ta cùng đi ăn cơm nhé' },
    ],
    3: [
        { id: 41, text: '我每天早上七点起床',         pinyin: 'wǒ měi tiān zǎo shang qī diǎn qǐ chuáng', meaning: 'Tôi dậy lúc 7h sáng mỗi ngày' },
        { id: 42, text: '我喜欢吃中国菜',             pinyin: 'wǒ xǐ huan chī zhōng guó cài',     meaning: 'Tôi thích ăn món Trung Quốc' },
        { id: 43, text: '这个周末你有什么计划',       pinyin: 'zhè ge zhōu mò nǐ yǒu shén me jì huà', meaning: 'Cuối tuần này bạn có kế hoạch gì' },
        { id: 44, text: '我正在学习汉语',             pinyin: 'wǒ zhèng zài xué xí hàn yǔ',       meaning: 'Tôi đang học tiếng Trung' },
        { id: 45, text: '你觉得这个怎么样',           pinyin: 'nǐ jué de zhè ge zěn me yàng',     meaning: 'Bạn thấy cái này thế nào' },
        { id: 46, text: '我最近有点忙，没时间运动',   pinyin: 'wǒ zuì jìn yǒu diǎn máng, méi shí jiān yùn dòng', meaning: 'Gần đây tôi hơi bận, không có thời gian tập thể dục' },
        { id: 47, text: '你能告诉我去机场怎么走吗',   pinyin: 'nǐ néng gào su wǒ qù jī chǎng zěn me zǒu ma', meaning: 'Bạn có thể chỉ tôi đường ra sân bay không' },
        { id: 48, text: '我需要买一些日用品',         pinyin: 'wǒ xū yào mǎi yī xiē rì yòng pǐn', meaning: 'Tôi cần mua một ít đồ dùng hằng ngày' },
        { id: 49, text: '这个房间很大也很干净',       pinyin: 'zhè ge fáng jiān hěn dà yě hěn gān jìng', meaning: 'Căn phòng này vừa rộng vừa sạch' },
        { id: 50, text: '我经常去图书馆借书',         pinyin: 'wǒ jīng cháng qù tú shū guǎn jiè shū', meaning: 'Tôi thường đến thư viện mượn sách' },
        { id: 51, text: '昨天晚上我看了一部电影',     pinyin: 'zuó tiān wǎn shang wǒ kàn le yī bù diàn yǐng', meaning: 'Tối qua tôi đã xem một bộ phim' },
        { id: 52, text: '我打算下个月去北京旅行',     pinyin: 'wǒ dǎ suàn xià gè yuè qù běi jīng lǚ xíng', meaning: 'Tháng sau tôi định đi du lịch Bắc Kinh' },
        { id: 53, text: '这家餐厅的菜味道很好',       pinyin: 'zhè jiā cān tīng de cài wèi dào hěn hǎo', meaning: 'Món ăn ở nhà hàng này rất ngon' },
        { id: 54, text: '我的中文老师很有耐心',       pinyin: 'wǒ de zhōng wén lǎo shī hěn yǒu nài xīn', meaning: 'Cô giáo tiếng Trung của tôi rất kiên nhẫn' },
        { id: 55, text: '我希望可以多说一点汉语',     pinyin: 'wǒ xī wàng kě yǐ duō shuō yī diǎn hàn yǔ', meaning: 'Tôi hy vọng có thể nói tiếng Trung nhiều hơn' },
        { id: 56, text: '你今天看起来很高兴',         pinyin: 'nǐ jīn tiān kàn qǐ lái hěn gāo xìng', meaning: 'Hôm nay trông bạn rất vui' },
        { id: 57, text: '我刚搬到一个新的城市',       pinyin: 'wǒ gāng bān dào yī gè xīn de chéng shì', meaning: 'Tôi vừa chuyển đến một thành phố mới' },
        { id: 58, text: '请把空调温度调低一点',       pinyin: 'qǐng bǎ kōng tiáo wēn dù tiáo dī yī diǎn', meaning: 'Xin chỉnh nhiệt độ điều hoà thấp xuống một chút' },
        { id: 59, text: '我从来没有去过那个地方',     pinyin: 'wǒ cóng lái méi yǒu qù guò nà ge dì fang', meaning: 'Tôi chưa từng đến nơi đó' },
        { id: 60, text: '你为什么决定学习中文',       pinyin: 'nǐ wèi shén me jué dìng xué xí zhōng wén', meaning: 'Tại sao bạn quyết định học tiếng Trung' },
    ],
    4: [
        { id: 61, text: '我对中国的传统文化很感兴趣',                 pinyin: 'wǒ duì zhōng guó de chuán tǒng wén huà hěn gǎn xìng qù', meaning: 'Tôi rất quan tâm đến văn hoá truyền thống Trung Quốc' },
        { id: 62, text: '这个决定对我来说非常重要',                   pinyin: 'zhè ge jué dìng duì wǒ lái shuō fēi cháng zhòng yào',   meaning: 'Quyết định này với tôi vô cùng quan trọng' },
        { id: 63, text: '我希望今年能把汉语水平提高',                 pinyin: 'wǒ xī wàng jīn nián néng bǎ hàn yǔ shuǐ píng tí gāo',   meaning: 'Tôi hy vọng năm nay nâng được trình độ tiếng Trung' },
        { id: 64, text: '这种学习方法看起来很有效果',                 pinyin: 'zhè zhǒng xué xí fāng fǎ kàn qǐ lái hěn yǒu xiào guǒ',  meaning: 'Phương pháp học này có vẻ rất hiệu quả' },
        { id: 65, text: '我需要更多的时间来准备这个报告',             pinyin: 'wǒ xū yào gèng duō de shí jiān lái zhǔn bèi zhè ge bào gào', meaning: 'Tôi cần thêm thời gian để chuẩn bị bản báo cáo này' },
        { id: 66, text: '这座城市最近发展得非常快',                   pinyin: 'zhè zuò chéng shì zuì jìn fā zhǎn de fēi cháng kuài',   meaning: 'Thành phố này gần đây phát triển rất nhanh' },
        { id: 67, text: '我觉得颜色搭配影响整体的感觉',               pinyin: 'wǒ jué de yán sè dā pèi yǐng xiǎng zhěng tǐ de gǎn jué',meaning: 'Tôi nghĩ phối màu ảnh hưởng đến cảm giác tổng thể' },
        { id: 68, text: '这家餐厅的菜不仅好吃，价格也合理',           pinyin: 'zhè jiā cān tīng de cài bù jǐn hǎo chī, jià gé yě hé lǐ',meaning: 'Món ở nhà hàng này không chỉ ngon mà giá cũng hợp lý' },
        { id: 69, text: '保持房间干净是一种好习惯',                   pinyin: 'bǎo chí fáng jiān gān jìng shì yī zhǒng hǎo xí guàn',   meaning: 'Giữ phòng sạch sẽ là một thói quen tốt' },
        { id: 70, text: '今天的天气特别舒服，适合出去散步',           pinyin: 'jīn tiān de tiān qì tè bié shū fu, shì hé chū qù sàn bù',meaning: 'Thời tiết hôm nay rất dễ chịu, thích hợp đi dạo' },
        { id: 71, text: '运动不仅可以保持健康，还能让心情变好',       pinyin: 'yùn dòng bù jǐn kě yǐ bǎo chí jiàn kāng, hái néng ràng xīn qíng biàn hǎo', meaning: 'Tập thể dục vừa giữ sức khoẻ vừa giúp tâm trạng tốt hơn' },
        { id: 72, text: '虽然他工作很忙，但是每天都会陪家人吃饭',     pinyin: 'suī rán tā gōng zuò hěn máng, dàn shì měi tiān dōu huì péi jiā rén chī fàn', meaning: 'Tuy anh ấy bận nhưng ngày nào cũng ăn cơm cùng gia đình' },
        { id: 73, text: '我建议你先听一遍录音再开始练习',             pinyin: 'wǒ jiàn yì nǐ xiān tīng yī biàn lù yīn zài kāi shǐ liàn xí', meaning: 'Mình khuyên bạn nghe bản ghi một lần trước khi luyện tập' },
        { id: 74, text: '只要坚持每天复习，进步就会很明显',           pinyin: 'zhǐ yào jiān chí měi tiān fù xí, jìn bù jiù huì hěn míng xiǎn', meaning: 'Chỉ cần kiên trì ôn mỗi ngày, tiến bộ sẽ rõ rệt' },
        { id: 75, text: '我对这次旅行充满了期待',                     pinyin: 'wǒ duì zhè cì lǚ xíng chōng mǎn le qī dài',             meaning: 'Tôi rất háo hức với chuyến đi lần này' },
        { id: 76, text: '父母的支持让我有更大的信心',                 pinyin: 'fù mǔ de zhī chí ràng wǒ yǒu gèng dà de xìn xīn',       meaning: 'Sự ủng hộ của bố mẹ giúp tôi tự tin hơn' },
        { id: 77, text: '听音乐是我放松心情的方法',                   pinyin: 'tīng yīn yuè shì wǒ fàng sōng xīn qíng de fāng fǎ',     meaning: 'Nghe nhạc là cách tôi thư giãn tâm trạng' },
        { id: 78, text: '我们应该尊重每个人的不同选择',               pinyin: 'wǒ men yīng gāi zūn zhòng měi gè rén de bù tóng xuǎn zé',meaning: 'Chúng ta nên tôn trọng lựa chọn khác nhau của mỗi người' },
        { id: 79, text: '看书让我了解到很多新的知识',                 pinyin: 'kàn shū ràng wǒ liǎo jiě dào hěn duō xīn de zhī shi',   meaning: 'Đọc sách giúp tôi biết thêm nhiều kiến thức mới' },
        { id: 80, text: '工作和生活之间的平衡很难找到',               pinyin: 'gōng zuò hé shēng huó zhī jiān de píng héng hěn nán zhǎo dào', meaning: 'Cân bằng giữa công việc và cuộc sống rất khó tìm' },
    ],
    5: [
        { id: 81, text: '随着科技的快速发展，人们的生活方式发生了巨大变化', pinyin: 'suí zhe kē jì de kuài sù fā zhǎn, rén men de shēng huó fāng shì fā shēng le jù dà biàn huà', meaning: 'Cùng với sự phát triển nhanh của công nghệ, lối sống con người đã thay đổi to lớn' },
        { id: 82, text: '解决这个问题需要各方面的共同合作',                 pinyin: 'jiě jué zhè ge wèn tí xū yào gè fāng miàn de gòng tóng hé zuò', meaning: 'Giải quyết vấn đề này cần sự hợp tác từ nhiều phía' },
        { id: 83, text: '我们应该重视环境保护，从身边的小事做起',           pinyin: 'wǒ men yīng gāi zhòng shì huán jìng bǎo hù, cóng shēn biān de xiǎo shì zuò qǐ', meaning: 'Chúng ta nên chú trọng bảo vệ môi trường, bắt đầu từ những việc nhỏ xung quanh' },
        { id: 84, text: '这次的项目对公司未来的发展是一个重要机会',         pinyin: 'zhè cì de xiàng mù duì gōng sī wèi lái de fā zhǎn shì yī gè zhòng yào jī huì', meaning: 'Dự án lần này là cơ hội quan trọng cho tương lai công ty' },
        { id: 85, text: '我建议大家用更积极的态度去面对挑战',               pinyin: 'wǒ jiàn yì dà jiā yòng gèng jī jí de tài dù qù miàn duì tiǎo zhàn', meaning: 'Tôi đề nghị mọi người chủ động hơn khi đối mặt thách thức' },
        { id: 86, text: '一个成熟的计划往往需要经过反复的讨论和修改',       pinyin: 'yī gè chéng shú de jì huà wǎng wǎng xū yào jīng guò fǎn fù de tǎo lùn hé xiū gǎi', meaning: 'Một kế hoạch chỉn chu thường phải trải qua thảo luận và sửa đổi nhiều lần' },
        { id: 87, text: '只有不断学习的人才能跟上社会的变化',               pinyin: 'zhǐ yǒu bù duàn xué xí de rén cái néng gēn shàng shè huì de biàn huà', meaning: 'Chỉ người liên tục học mới theo kịp sự thay đổi của xã hội' },
        { id: 88, text: '在压力大的时候，找朋友聊聊天能帮助我们放松',       pinyin: 'zài yā lì dà de shí hou, zhǎo péng you liáo liao tiān néng bāng zhù wǒ men fàng sōng', meaning: 'Khi áp lực lớn, trò chuyện với bạn bè giúp ta thư giãn' },
        { id: 89, text: '一种产品能否成功，关键在于是否解决用户的真实需求', pinyin: 'yī zhǒng chǎn pǐn néng fǒu chéng gōng, guān jiàn zài yú shì fǒu jiě jué yòng hù de zhēn shí xū qiú', meaning: 'Một sản phẩm có thành công hay không, mấu chốt ở việc nó có giải quyết nhu cầu thật của người dùng hay không' },
        { id: 90, text: '阅读经典作品能让我们对历史有更深入的理解',         pinyin: 'yuè dú jīng diǎn zuò pǐn néng ràng wǒ men duì lì shǐ yǒu gèng shēn rù de lǐ jiě', meaning: 'Đọc tác phẩm kinh điển giúp ta hiểu lịch sử sâu sắc hơn' },
        { id: 91, text: '虽然过程很辛苦，但是结果让所有人都很满意',         pinyin: 'suī rán guò chéng hěn xīn kǔ, dàn shì jié guǒ ràng suǒ yǒu rén dōu hěn mǎn yì', meaning: 'Tuy quá trình vất vả nhưng kết quả khiến mọi người hài lòng' },
        { id: 92, text: '一个好的领导者应该懂得倾听不同的意见',             pinyin: 'yī gè hǎo de lǐng dǎo zhě yīng gāi dǒng de qīng tīng bù tóng de yì jiàn', meaning: 'Một người lãnh đạo giỏi nên biết lắng nghe các ý kiến khác nhau' },
        { id: 93, text: '健康的饮食和规律的作息是长期保持精力的关键',       pinyin: 'jiàn kāng de yǐn shí hé guī lǜ de zuò xī shì cháng qī bǎo chí jīng lì de guān jiàn', meaning: 'Ăn uống lành mạnh và nghỉ ngơi điều độ là chìa khoá giữ năng lượng lâu dài' },
        { id: 94, text: '我们对未来既要保持希望，也要有清醒的判断',         pinyin: 'wǒ men duì wèi lái jì yào bǎo chí xī wàng, yě yào yǒu qīng xǐng de pàn duàn', meaning: 'Với tương lai, ta vừa cần giữ hy vọng vừa cần phán đoán tỉnh táo' },
        { id: 95, text: '通过这次合作，我们建立了更加稳定的伙伴关系',       pinyin: 'tōng guò zhè cì hé zuò, wǒ men jiàn lì le gèng jiā wěn dìng de huǒ bàn guān xì', meaning: 'Qua lần hợp tác này, chúng ta xây dựng quan hệ đối tác bền vững hơn' },
        { id: 96, text: '面对突发事件，冷静的判断比情绪化的反应更重要',     pinyin: 'miàn duì tū fā shì jiàn, lěng jìng de pàn duàn bǐ qíng xù huà de fǎn yìng gèng zhòng yào', meaning: 'Trước sự cố, phán đoán bình tĩnh quan trọng hơn phản ứng cảm tính' },
        { id: 97, text: '不同文化之间的交流可以让我们看到更多的可能性',     pinyin: 'bù tóng wén huà zhī jiān de jiāo liú kě yǐ ràng wǒ men kàn dào gèng duō de kě néng xìng', meaning: 'Giao lưu giữa các nền văn hoá giúp ta thấy nhiều khả năng hơn' },
        { id: 98, text: '一个家庭的氛围常常影响一个孩子的性格',             pinyin: 'yī gè jiā tíng de fēn wéi cháng cháng yǐng xiǎng yī gè hái zǐ de xìng gé', meaning: 'Bầu không khí gia đình thường ảnh hưởng tới tính cách của một đứa trẻ' },
        { id: 99, text: '为了实现这个目标，我们必须付出更多的努力',         pinyin: 'wèi le shí xiàn zhè ge mù biāo, wǒ men bì xū fù chū gèng duō de nǔ lì', meaning: 'Để đạt được mục tiêu này, chúng ta phải nỗ lực nhiều hơn' },
        { id: 100, text: '团队中的信任是完成复杂任务的重要基础',           pinyin: 'tuán duì zhōng de xìn rèn shì wán chéng fù zá rèn wù de zhòng yào jī chǔ', meaning: 'Sự tin tưởng trong đội là nền tảng quan trọng để hoàn thành nhiệm vụ phức tạp' },
    ],
    6: [
        { id: 101, text: '在当今全球化的背景下，跨文化交流变得越来越重要',                       pinyin: 'zài dāng jīn quán qiú huà de bèi jǐng xià, kuà wén huà jiāo liú biàn de yuè lái yuè zhòng yào', meaning: 'Trong bối cảnh toàn cầu hoá ngày nay, giao lưu liên văn hoá ngày càng quan trọng' },
        { id: 102, text: '这一理论在长期的实践中得到了充分的验证和发展',                       pinyin: 'zhè yī lǐ lùn zài cháng qī de shí jiàn zhōng dé dào le chōng fèn de yàn zhèng hé fā zhǎn', meaning: 'Lý thuyết này đã được kiểm chứng và phát triển đầy đủ qua thực tiễn lâu dài' },
        { id: 103, text: '我们应当从历史中吸取教训，避免重复犯同样的错误',                     pinyin: 'wǒ men yīng dāng cóng lì shǐ zhōng xī qǔ jiào xùn, bì miǎn chóng fù fàn tóng yàng de cuò wù', meaning: 'Chúng ta nên rút bài học từ lịch sử để tránh lặp lại sai lầm tương tự' },
        { id: 104, text: '这种创新性的方法为解决复杂问题提供了崭新的思路',                     pinyin: 'zhè zhǒng chuàng xīn xìng de fāng fǎ wèi jiě jué fù zá wèn tí tí gōng le zhǎn xīn de sī lù', meaning: 'Phương pháp đổi mới này mở ra hướng tư duy mới cho việc giải quyết các vấn đề phức tạp' },
        { id: 105, text: '在追求个人发展的同时，我们也应该承担相应的社会责任',                 pinyin: 'zài zhuī qiú gè rén fā zhǎn de tóng shí, wǒ men yě yīng gāi chéng dān xiāng yìng de shè huì zé rèn', meaning: 'Khi theo đuổi phát triển cá nhân, ta cũng nên gánh vác trách nhiệm xã hội tương ứng' },
        { id: 106, text: '人工智能的进步既带来了机遇，也提出了关于伦理的新挑战',               pinyin: 'rén gōng zhì néng de jìn bù jì dài lái le jī yù, yě tí chū le guān yú lún lǐ de xīn tiǎo zhàn', meaning: 'Tiến bộ của trí tuệ nhân tạo vừa mở ra cơ hội, vừa đặt ra thách thức mới về đạo đức' },
        { id: 107, text: '一座城市的可持续发展离不开科学规划和长远的眼光',                     pinyin: 'yī zuò chéng shì de kě chí xù fā zhǎn lí bù kāi kē xué guī huà hé cháng yuǎn de yǎn guāng', meaning: 'Phát triển bền vững của một thành phố không thể tách rời quy hoạch khoa học và tầm nhìn dài hạn' },
        { id: 108, text: '阅读不仅是获取知识的途径，更是塑造独立思考能力的重要方式',           pinyin: 'yuè dú bù jǐn shì huò qǔ zhī shi de tú jìng, gèng shì sù zào dú lì sī kǎo néng lì de zhòng yào fāng shì', meaning: 'Đọc sách không chỉ là cách tiếp nhận kiến thức, mà còn là cách quan trọng để rèn năng lực tư duy độc lập' },
        { id: 109, text: '在面对重大决策时，理性的分析和情感的考量同样不可忽视',               pinyin: 'zài miàn duì zhòng dà jué cè shí, lǐ xìng de fēn xī hé qíng gǎn de kǎo liàng tóng yàng bù kě hū shì', meaning: 'Khi đối diện quyết định lớn, phân tích lý trí và cân nhắc cảm xúc đều không thể bỏ qua' },
        { id: 110, text: '一项制度的真正价值，体现在它能否在复杂情境中保持公平',               pinyin: 'yī xiàng zhì dù de zhēn zhèng jià zhí, tǐ xiàn zài tā néng fǒu zài fù zá qíng jìng zhōng bǎo chí gōng píng', meaning: 'Giá trị thực sự của một thể chế thể hiện ở việc nó có giữ được công bằng trong các tình huống phức tạp hay không' },
        { id: 111, text: '通过反思过去的经验，我们可以更准确地预测未来可能出现的问题',         pinyin: 'tōng guò fǎn sī guò qù de jīng yàn, wǒ men kě yǐ gèng zhǔn què de yù cè wèi lái kě néng chū xiàn de wèn tí', meaning: 'Bằng cách nhìn lại kinh nghiệm quá khứ, ta có thể dự đoán chính xác hơn các vấn đề có thể xảy ra trong tương lai' },
        { id: 112, text: '在合作中，每一个成员的价值观都会影响整体的氛围和效率',               pinyin: 'zài hé zuò zhōng, měi yī gè chéng yuán de jià zhí guān dōu huì yǐng xiǎng zhěng tǐ de fēn wéi hé xiào lǜ', meaning: 'Trong hợp tác, giá trị quan của mỗi thành viên đều ảnh hưởng đến không khí và hiệu suất chung' },
        { id: 113, text: '社会的进步不仅取决于经济的增长，也取决于每个个体的成长',             pinyin: 'shè huì de jìn bù bù jǐn qǔ jué yú jīng jì de zēng zhǎng, yě qǔ jué yú měi gè gè tǐ de chéng zhǎng', meaning: 'Tiến bộ của xã hội không chỉ phụ thuộc tăng trưởng kinh tế mà còn phụ thuộc sự trưởng thành của mỗi cá thể' },
        { id: 114, text: '在信息爆炸的时代，辨别真伪的能力变得格外重要',                       pinyin: 'zài xìn xī bào zhà de shí dài, biàn bié zhēn wěi de néng lì biàn de gé wài zhòng yào', meaning: 'Trong thời đại bùng nổ thông tin, khả năng phân biệt thật giả trở nên đặc biệt quan trọng' },
        { id: 115, text: '一个真正成熟的人，能够在不确定的环境中保持冷静与自律',               pinyin: 'yī gè zhēn zhèng chéng shú de rén, néng gòu zài bù què dìng de huán jìng zhōng bǎo chí lěng jìng yǔ zì lǜ', meaning: 'Một người thực sự trưởng thành biết giữ bình tĩnh và kỷ luật trong môi trường bất định' },
        { id: 116, text: '通过开放的讨论，团队往往能够找到更具创造性的解决方案',               pinyin: 'tōng guò kāi fàng de tǎo lùn, tuán duì wǎng wǎng néng gòu zhǎo dào gèng jù chuàng zào xìng de jiě jué fāng àn', meaning: 'Qua thảo luận cởi mở, đội ngũ thường tìm ra giải pháp giàu sáng tạo hơn' },
        { id: 117, text: '在传统与现代之间，找到合适的平衡点是一种智慧',                       pinyin: 'zài chuán tǒng yǔ xiàn dài zhī jiān, zhǎo dào hé shì de píng héng diǎn shì yī zhǒng zhì huì', meaning: 'Tìm điểm cân bằng phù hợp giữa truyền thống và hiện đại là một loại trí tuệ' },
        { id: 118, text: '只有真正理解他人的处境，沟通才能产生有意义的结果',                   pinyin: 'zhǐ yǒu zhēn zhèng lǐ jiě tā rén de chǔ jìng, gōu tōng cái néng chǎn shēng yǒu yì yì de jié guǒ', meaning: 'Chỉ khi thực sự hiểu hoàn cảnh của người khác, giao tiếp mới mang lại kết quả ý nghĩa' },
        { id: 119, text: '坚持长期主义往往比追求短期利益带来更深远的影响',                     pinyin: 'jiān chí cháng qī zhǔ yì wǎng wǎng bǐ zhuī qiú duǎn qī lì yì dài lái gèng shēn yuǎn de yǐng xiǎng', meaning: 'Kiên trì với chủ nghĩa dài hạn thường mang lại tác động sâu xa hơn so với chạy theo lợi ích ngắn hạn' },
        { id: 120, text: '一项政策的成功不仅取决于设计，更取决于执行的细节',                   pinyin: 'yī xiàng zhèng cè de chéng gōng bù jǐn qǔ jué yú shè jì, gèng qǔ jué yú zhí xíng de xì jié', meaning: 'Thành công của một chính sách không chỉ ở thiết kế mà còn ở chi tiết thực thi' },
    ],
};

/**
 * Pick a random item from the static fallback corpus.
 */
function pickFromCorpus(level) {
    const texts = BASE_PRACTICE_TEXTS[level] || BASE_PRACTICE_TEXTS[1];
    const randomIndex = Math.floor(Math.random() * texts.length);
    return texts[randomIndex];
}

/**
 * Strip Markdown / code-fence wrappers Groq sometimes adds.
 */
function stripFences(text) {
    if (!text) return '';
    return text
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
}

/**
 * Ask Groq to generate a fresh, diverse Chinese practice sentence for the
 * given HSK level. Returns null if Groq fails or output is invalid — caller
 * should fall back to the static corpus.
 *
 * The diversity hint (random topic seed) is critical: without it Groq tends
 * to keep returning the same handful of sentences.
 */
async function generatePracticeTextWithGroq(level, requestId) {
    const guide = LEVEL_GUIDE[level] || LEVEL_GUIDE[1];

    // Diversity seeds — pick one at random per request so the model can't latch
    // onto a single greeting. These are intentionally broad themes only, not
    // the actual sentence content.
    const TOPICS = [
        'gia đình', 'bạn bè', 'trường học', 'công việc', 'sức khoẻ', 'du lịch',
        'thể thao', 'sở thích cá nhân', 'âm nhạc', 'phim ảnh', 'ẩm thực', 'mua sắm',
        'thời tiết', 'môi trường', 'công nghệ', 'sách vở', 'thành phố', 'lễ hội',
        'kế hoạch tương lai', 'kỉ niệm', 'cảm xúc', 'thói quen hằng ngày',
    ];
    const topic = TOPICS[Math.floor(Math.random() * TOPICS.length)];

    const systemPrompt = `Bạn là giáo viên tiếng Trung. Mỗi lần được hỏi, bạn sinh đúng MỘT câu tiếng Trung mới để học viên Việt Nam luyện phát âm.

Yêu cầu:
- Trình độ HSK ${level}: chỉ dùng từ vựng và ngữ pháp HSK ${level} trở xuống.
- Phong cách: ${guide.style}.
- Độ dài: từ ${guide.minChars} đến ${guide.maxChars} ký tự Hán (không kể dấu câu).
- ĐA DẠNG: tránh các câu chào sáo rỗng (你好, 谢谢, 再见, 我爱你...). Tạo câu MỚI khác lần trước.
- Không thêm pinyin/dịch vào trong câu Hán.

ĐỊNH DẠNG ĐẦU RA: chỉ trả về một dòng JSON hợp lệ duy nhất, không có markdown, không có dấu \`\`\`, không có giải thích:
{"text":"...","pinyin":"...","meaning":"..."}

Trong đó:
- "text": câu tiếng Trung (chỉ Hán tự + dấu câu Trung).
- "pinyin": phiên âm có thanh điệu, viết thường, có dấu cách giữa các từ.
- "meaning": dịch tiếng Việt tự nhiên.`;

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: `Sinh một câu luyện phát âm HSK ${level} chủ đề "${topic}". Mã ngẫu nhiên: ${Math.random().toString(36).slice(2, 10)}.` },
    ];

    let result;
    try {
        result = await groqService.sendMessage(messages, requestId || ('practice-gen-' + Date.now()));
    } catch (err) {
        console.error('[practiceTexts] Groq failed:', err.message);
        return null;
    }

    const raw = stripFences(result.text);
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        console.error('[practiceTexts] JSON parse failed. raw:', raw.slice(0, 200));
        return null;
    }

    if (!parsed || typeof parsed.text !== 'string' || !parsed.text.trim()) {
        console.error('[practiceTexts] Invalid Groq output (missing text):', parsed);
        return null;
    }

    const hanCharCount = (parsed.text.match(/[一-鿿]/g) || []).length;
    if (hanCharCount < Math.max(1, guide.minChars - 2)) {
        console.warn(`[practiceTexts] Output too short for HSK ${level} (${hanCharCount} chars):`, parsed.text);
        // Still return it — better than nothing, but log for tuning.
    }

    return {
        id: 0, // Groq-generated sentences don't have a stable id
        text: parsed.text.trim(),
        pinyin: (parsed.pinyin || '').trim(),
        meaning: (parsed.meaning || '').trim(),
        source: 'groq',
    };
}

/**
 * Main entry: get a practice text for the given HSK level.
 * Tries Groq generation first (with diversity), falls back to static corpus.
 *
 * @param {number} level - HSK level (1-6)
 * @param {boolean} useGroq - When false, always use the corpus (e.g. when GROQ key missing)
 * @param {string} [requestId]
 * @returns {Promise<{ id, text, pinyin, meaning, source }>}
 */
async function getPracticeText(level, useGroq = true, requestId) {
    if (useGroq) {
        const generated = await generatePracticeTextWithGroq(level, requestId);
        if (generated) return generated;
    }
    const fallback = pickFromCorpus(level);
    return { ...fallback, source: 'corpus' };
}

/**
 * Get all practice texts in the static corpus for a level.
 */
function getPracticeTextsByLevel(level) {
    return BASE_PRACTICE_TEXTS[level] || BASE_PRACTICE_TEXTS[1];
}

module.exports = {
    BASE_PRACTICE_TEXTS,
    LEVEL_GUIDE,
    getPracticeText,
    getPracticeTextsByLevel,
    generatePracticeTextWithGroq,
};
