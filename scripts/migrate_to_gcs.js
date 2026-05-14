require('dotenv').config();

const fs = require('fs');
const path = require('path');
const db = require('../src/config/database');
const gcs = require('../src/services/gcs.service');

const ROOT_PUBLIC = path.join(__dirname, '..', 'public');

const MEDIA_COLUMNS = [
    { table: 'vocabulary', id: 'id', column: 'audio_url', kind: 'audio' },
    { table: 'grammar_points', id: 'id', column: 'audio_url', kind: 'audio' },
    { table: 'hsk_questions', id: 'id', column: 'question_audio', kind: 'audio' },
    { table: 'hsk_questions', id: 'id', column: 'question_image', kind: 'image' },
    { table: 'hsk_sections', id: 'id', column: 'audio_url', kind: 'audio' },
    { table: 'lessons', id: 'id', column: 'audio_url', kind: 'audio' },
    { table: 'textbook_lessons', id: 'id', column: 'passage_audio_url', kind: 'audio' },
];

function localPathFromUrl(url) {
    if (!url || /^https?:\/\//i.test(url)) return null;
    const normalized = String(url).replace(/^\/+/, '');
    return path.join(ROOT_PUBLIC, normalized);
}

function contentTypeFor(filePath, kind) {
    const ext = path.extname(filePath).toLowerCase();
    if (kind === 'image') {
        if (ext === '.png') return 'image/png';
        if (ext === '.webp') return 'image/webp';
        if (ext === '.gif') return 'image/gif';
        return 'image/jpeg';
    }
    if (ext === '.wav') return 'audio/wav';
    if (ext === '.ogg') return 'audio/ogg';
    if (ext === '.webm') return 'audio/webm';
    return 'audio/mpeg';
}

async function columnExists(table, column) {
    const [rows] = await db.execute(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
         LIMIT 1`,
        [table, column]
    );
    return rows.length > 0;
}

async function migrateColumn({ table, id, column, kind }, dryRun) {
    if (!(await columnExists(table, column))) {
        console.log(`skip ${table}.${column}: column missing`);
        return { scanned: 0, migrated: 0 };
    }

    const [rows] = await db.execute(
        `SELECT ${id} AS row_id, ${column} AS media_url
           FROM ${table}
          WHERE ${column} IS NOT NULL AND ${column} != '' AND ${column} NOT LIKE 'http%'`
    );

    let migrated = 0;
    for (const row of rows) {
        const filePath = localPathFromUrl(row.media_url);
        if (!filePath || !fs.existsSync(filePath)) {
            console.warn(`missing local file ${table}.${column}#${row.row_id}: ${row.media_url}`);
            continue;
        }

        const bucketName = gcs.getBucketName(kind);
        const objectName = `legacy/${table}/${column}/${path.basename(filePath)}`;
        const newUrl = dryRun
            ? `dry-run://${bucketName}/${objectName}`
            : await gcs.uploadBuffer({
                bucketName,
                objectName,
                buffer: await fs.promises.readFile(filePath),
                contentType: contentTypeFor(filePath, kind),
                publicRead: process.env.GCS_UPLOAD_PUBLIC === 'true',
            });

        console.log(`${table}.${column}#${row.row_id}: ${row.media_url} -> ${newUrl}`);
        if (!dryRun) {
            await db.execute(`UPDATE ${table} SET ${column} = ? WHERE ${id} = ?`, [newUrl, row.row_id]);
        }
        migrated++;
    }

    return { scanned: rows.length, migrated };
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const audioBucket = gcs.getBucketName('audio');
    const imageBucket = gcs.getBucketName('image');
    if (!audioBucket && !dryRun) throw new Error('GCS_BUCKET_AUDIO or GCS_BUCKET_MEDIA is required');
    if (!imageBucket && !dryRun) throw new Error('GCS_BUCKET_IMAGES or GCS_BUCKET_MEDIA is required');

    let scanned = 0;
    let migrated = 0;
    for (const spec of MEDIA_COLUMNS) {
        const result = await migrateColumn(spec, dryRun);
        scanned += result.scanned;
        migrated += result.migrated;
    }

    console.log(`Done. scanned=${scanned}, migrated=${migrated}, dryRun=${dryRun}`);
    await db.end();
}

main().catch(async (error) => {
    console.error('GCS migration failed:', error);
    try { await db.end(); } catch {}
    process.exit(1);
});
