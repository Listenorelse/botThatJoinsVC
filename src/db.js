const mysql = require('mysql2/promise');
const config = require('./config.json'); // Load database credentials

// Create a MySQL connection pool
const pool = mysql.createPool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

module.exports = pool;