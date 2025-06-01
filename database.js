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
    }
});

console.log("Database path:", DB_PATH);

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS receipt_file (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        is_valid INTEGER NOT NULL,
        invalid_reason TEXT,
        is_processed INTEGER NOT NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL
    )`);

    console.log("Table 'receipt_file' created.");

    const tableExists = db.prepare('SELECT name FROM sqlite_master WHERE type="table" AND name="receipt_file"').get();
    if (!tableExists) {
        console.log("Table 'receipt_file' does not exist.");
    }else{
        console.log("Table 'receipt_file' exists.");
    }
    
});

