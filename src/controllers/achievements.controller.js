const achievementsService = require('../services/achievements.service');

exports.list = async (req, res) => {
    try {
        const unlocked = await achievementsService.getUnlocked(req.user.userId);
        const unlockedMap = new Map(unlocked.map(u => [u.key, u]));

        const items = achievementsService.catalog.map(b => {
            const u = unlockedMap.get(b.key);
            return {
                key: b.key,
                name: b.name,
                target: b.target,
                icon: b.icon,
                earned: !!u,
                earnedAt: u ? u.earnedAt : null,
                metricValue: u ? u.metricValue : null,
            };
        });

        res.json({ success: true, data: items });
    } catch (error) {
        console.error('achievements.list error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};
