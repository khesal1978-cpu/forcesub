const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');

const renderPage = (content) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>VaultSub Admin</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
        body { margin: 0; font-family: 'Inter', sans-serif; background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; overflow: hidden; }
        .bg-glow { position: absolute; width: 800px; height: 800px; background: radial-gradient(circle, rgba(139,92,246,0.15) 0%, rgba(0,0,0,0) 70%); top: -300px; right: -300px; pointer-events: none; z-index: 0; }
        .bg-glow-2 { position: absolute; width: 600px; height: 600px; background: radial-gradient(circle, rgba(99,102,241,0.15) 0%, rgba(0,0,0,0) 70%); bottom: -200px; left: -200px; pointer-events: none; z-index: 0; }
        .glass-panel { background: rgba(30, 41, 59, 0.7); backdrop-filter: blur(16px); border: 1px solid rgba(255,255,255,0.08); border-radius: 24px; padding: 40px; width: 100%; max-width: 480px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); position: relative; z-index: 1; }
        h1 { margin-top: 0; font-size: 28px; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 12px; margin-bottom: 30px; justify-content: center; }
        h1 span { color: #8b5cf6; }
        .stats-box { background: rgba(15, 23, 42, 0.5); border: 1px solid rgba(139,92,246,0.3); border-radius: 16px; padding: 24px; text-align: center; margin-bottom: 30px; box-shadow: inset 0 0 20px rgba(139,92,246,0.05); }
        .stats-box .number { font-size: 48px; font-weight: 800; color: #a78bfa; margin: 0; line-height: 1; }
        .stats-box .label { font-size: 14px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; font-weight: 600; margin-top: 8px; }
        input, textarea { width: 100%; background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(255,255,255,0.1); color: white; padding: 16px; border-radius: 12px; margin-bottom: 16px; font-size: 16px; font-family: inherit; box-sizing: border-box; transition: all 0.3s ease; }
        input:focus, textarea:focus { outline: none; border-color: #8b5cf6; box-shadow: 0 0 0 3px rgba(139,92,246,0.2); }
        textarea { resize: vertical; min-height: 120px; }
        button { width: 100%; background: linear-gradient(135deg, #8b5cf6, #6366f1); color: white; border: none; padding: 16px; border-radius: 12px; font-size: 16px; font-weight: 600; cursor: pointer; transition: transform 0.2s ease, box-shadow 0.2s ease; }
        button:hover { transform: translateY(-2px); box-shadow: 0 10px 20px -10px rgba(139,92,246,0.6); }
        .logout { display: block; text-align: center; margin-top: 24px; color: #94a3b8; text-decoration: none; font-size: 14px; transition: color 0.2s ease; font-weight: 500; }
        .logout:hover { color: #f43f5e; }
        .alert { padding: 16px; border-radius: 12px; margin-bottom: 24px; font-size: 14px; font-weight: 500; text-align: center; }
        .alert.success { background: rgba(16, 185, 129, 0.1); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.2); }
        .alert.error { background: rgba(244, 63, 94, 0.1); color: #fb7185; border: 1px solid rgba(244, 63, 94, 0.2); }
    </style>
</head>
<body>
    <div class="bg-glow"></div>
    <div class="bg-glow-2"></div>
    <div class="glass-panel">
        <h1>🛡 Vault<span>Sub</span></h1>
        ${content}
    </div>
</body>
</html>
`;

module.exports = function startWebServer(bot, settings) {
    const app = express();
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(session({
        secret: 'vaultsub-super-secret-key-12345',
        resave: false,
        saveUninitialized: false,
        cookie: { maxAge: 24 * 60 * 60 * 1000 }
    }));

    // Authentication middleware
    const auth = (req, res, next) => {
        if (req.session.admin) return next();
        res.redirect('/login');
    };

    app.get('/login', (req, res) => {
        if (req.session.admin) return res.redirect('/');
        res.send(renderPage(`
            <form action="/login" method="POST">
                ${req.query.error ? '<div class="alert error">❌ Invalid credentials.</div>' : ''}
                <input type="text" name="username" placeholder="Username" required autofocus>
                <input type="password" name="password" placeholder="Password" required>
                <button type="submit">Secure Login</button>
            </form>
        `));
    });

    app.post('/login', (req, res) => {
        const { username, password } = req.body;
        if (username === 'tasbeel' && password === 'tasbeel') {
            req.session.admin = true;
            res.redirect('/');
        } else {
            res.redirect('/login?error=1');
        }
    });

    app.get('/logout', (req, res) => {
        req.session.destroy();
        res.redirect('/login');
    });

    app.get('/', auth, (req, res) => {
        const groupCount = settings.knownGroups ? settings.knownGroups.length : 0;
        res.send(renderPage(`
            ${req.query.success ? '<div class="alert success">✅ Broadcast sent successfully!</div>' : ''}
            <div class="stats-box">
                <p class="number">${groupCount}</p>
                <p class="label">Groups & Channels Tracked</p>
            </div>
            <form action="/broadcast" method="POST">
                <textarea name="message" placeholder="Type your broadcast message here..." required></textarea>
                <button type="submit">📢 Send Broadcast</button>
            </form>
            <a href="/logout" class="logout">Log out securely</a>
        `));
    });

    app.post('/broadcast', auth, async (req, res) => {
        const { message } = req.body;
        if (!message || !settings.knownGroups) return res.redirect('/');

        for (const chatId of settings.knownGroups) {
            try {
                await bot.sendMessage(chatId, message);
            } catch (err) {
                console.error("Failed to broadcast to " + chatId);
            }
        }
        res.redirect('/?success=1');
    });

    // Public endpoint for UptimeRobot / Cronjobs to keep Render alive
    app.get('/ping', (req, res) => {
        res.status(200).send('Bot is awake!');
    });

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`🚀 Web Dashboard running on port ${PORT}`);
    });
};
