// database.js
import sqlite3 from 'sqlite3';
const sqlite = sqlite3.verbose();
const DB_PATH = './receipts.db';

const db = new sqlite.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
        process.exit(1);
    } else {
        console.log('Connected to the SQLite database.');
        initializeDb();
    }
});

const initializeDb = () => {
    db.serialize(() => {
        db.run(`
            CREATE TABLE IF NOT EXISTS receipt_file (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_name TEXT NOT NULL,
                file_path TEXT NOT NULL UNIQUE,
                is_valid BOOLEAN DEFAULT FALSE,
                invalid_reason TEXT,
                is_processed BOOLEAN DEFAULT FALSE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `, (err) => {
            if (err) console.error("Error creating receipt_file table", err.message);
            else console.log("receipt_file table checked/created.");
        });

        // ─────────────────────────────────────────────────────────────────────────────
        // Modified: add an `items` column of type TEXT to store JSON
        // ─────────────────────────────────────────────────────────────────────────────
        db.run(`
            CREATE TABLE IF NOT EXISTS receipt (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                receipt_file_id INTEGER,
                purchased_at DATETIME,
                merchant_name TEXT,
                total_amount REAL,
                category TEXT,
                items TEXT,                     -- new column to store JSON array of items
                file_path TEXT,
                raw_extracted_text TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (receipt_file_id) REFERENCES receipt_file(id)
            )
        `, (err) => {
            if (err) console.error("Error creating receipt table", err.message);
            else console.log("receipt table checked/created.");
        });

        // Triggers to update updated_at timestamps
        db.run(`
            CREATE TRIGGER IF NOT EXISTS update_receipt_file_updated_at
            AFTER UPDATE ON receipt_file
            FOR EACH ROW
            BEGIN
                UPDATE receipt_file SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
            END;
        `);

        db.run(`
            CREATE TRIGGER IF NOT EXISTS update_receipt_updated_at
            AFTER UPDATE ON receipt
            FOR EACH ROW
            BEGIN
                UPDATE receipt SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
            END;
        `);
    });
};

const dbRun = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) {
                console.error('DB Run Error:', err.message, 'SQL:', sql, 'Params:', params);
                reject(err);
            } else {
                resolve(this); // contains lastID, changes
            }
        });
    });
};

const dbGet = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) {
                console.error('DB Get Error:', err.message, 'SQL:', sql, 'Params:', params);
                reject(err);
            } else {
                resolve(row);
            }
        });
    });
};

const dbAll = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) {
                console.error('DB All Error:', err.message, 'SQL:', sql, 'Params:', params);
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
};

export { db, dbRun, dbGet, dbAll };
