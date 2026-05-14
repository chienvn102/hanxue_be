async function generateImage() {
    const err = new Error('Imagen generation is not configured');
    err.publicMessage = 'Dich vu tao anh AI chua duoc cau hinh.';
    err.status = 501;
    throw err;
}

module.exports = {
    generateImage,
};
