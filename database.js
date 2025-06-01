// database.js
import sqlite3 from 'sqlite3';
const sqlite = sqlite3.verbose();

const DB_PATH = './receipts.db';

const db = new sqlite.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
        // If the DB can't be opened, the app is likely unusable.
        // Consider exiting or implementing a retry mechanism for robust applications.
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

        db.run(`
            CREATE TABLE IF NOT EXISTS receipt (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                receipt_file_id INTEGER,
                purchased_at DATETIME,
                merchant_name TEXT,
                total_amount REAL,
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

        // Triggers (keep as is, they are fine)
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