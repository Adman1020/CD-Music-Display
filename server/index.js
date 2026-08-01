const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('./db');
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
app.use('/data', express.static(path.join(__dirname, '../data')));

// Session setup — secret is auto-generated and stored in SQLite
app.use(session({
    secret: db.getSessionSecret(),
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Running behind localhost / Docker
        maxAge: 1000 * 60 * 60 * 24 * 7 // 1 week
    }
}));

// Routes
app.use('/auth', authRoutes);
app.use('/api', apiRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[CD-Display] Server running on port ${PORT}`);
    console.log(`[CD-Display] Setup complete: ${db.isSetupComplete()}`);
});
