const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const session = require('express-session');
const MongoStore = require('connect-mongo');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));

// ==========================================
// DATABASE CONNECTION
// ==========================================
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/orange-chaos-slot';
mongoose.connect(MONGO_URL)
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.error('❌ MongoDB Error:', err));

// ==========================================
// SCHEMAS
// ==========================================
const UserBalanceSchema = new mongoose.Schema({
    userId: { type: String, unique: true, required: true },
    username: String,
    balance: { type: Number, default: 1000 },
    totalWins: { type: Number, default: 0 },
    totalBets: { type: Number, default: 0 },
    totalSpins: { type: Number, default: 0 },
    biggestWin: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    lastSpinAt: Date
});

const SpinHistorySchema = new mongoose.Schema({
    userId: String,
    username: String,
    betAmount: Number,
    winAmount: Number,
    profit: Number,
    cascades: Number,
    bombMultiplier: Number,
    freeSpinsTriggered: Boolean,
    timestamp: { type: Date, default: Date.now }
});

const UserBalance = mongoose.model('UserBalance', UserBalanceSchema);
const SpinHistory = mongoose.model('SpinHistory', SpinHistorySchema);

// ==========================================
// SESSION CONFIGURATION (FIXED FOR PRODUCTION)
// ==========================================

// 🔥 FIX: WICHTIG! Damit Express das Secure-Cookie hinter einem Proxy (Railway, Heroku etc.) sendet:
app.set('trust proxy', 1);

app.use(session({
    secret: process.env.SESSION_SECRET || 'chaos-orange-secret-key-change-this',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: MONGO_URL,
        collectionName: 'sessions',
        touchAfter: 24 * 3600 // Lazy session update
    }),
    cookie: {
        secure: process.env.NODE_ENV === 'production' ? true : false,
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    },
    name: 'sessionId'
}));

// ==========================================
// MIDDLEWARE
// ==========================================
const requireAuth = (req, res, next) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    next();
};

// ==========================================
// GAME ENGINE
// ==========================================
const COLS = 6;
const ROWS = 5;

const symbols = [
    { name: 'ORANGE', pays: [10, 25, 50], weight: 10 },
    { name: 'ROLEX', pays: [2.5, 10, 25], weight: 20 },
    { name: 'CASH', pays: [2, 5, 15], weight: 30 },
    { name: 'ENERGY', pays: [1.5, 2, 10], weight: 40 },
    { name: 'A', pays: [1, 1.5, 5], weight: 60 },
    { name: 'K', pays: [0.8, 1.2, 4], weight: 70 },
    { name: 'Q', pays: [0.5, 1, 3], weight: 80 },
    { name: 'J', pays: [0.4, 0.9, 2], weight: 90 },
    { name: 'TEN', pays: [0.3, 0.8, 1.5], weight: 100 },
    { name: 'BOMB', weight: 8, isMulti: true },
    { name: 'SCATTER', weight: 6, isScatter: true }
];

const bombMultis = [2, 3, 4, 5, 8, 10, 15, 20, 25, 50, 100, 250, 500];

function getRandomSymbol() {
    let totalW = symbols.reduce((sum, sym) => sum + sym.weight, 0);
    let r = Math.random() * totalW;
    for (const sym of symbols) {
        if (r < sym.weight) {
            if (sym.name === 'BOMB') {
                return { name: 'BOMB', multi: bombMultis[Math.floor(Math.random() * bombMultis.length)] };
            }
            return { name: sym.name };
        }
        r -= sym.weight;
    }
    return { name: 'J' };
}

function generateGrid() {
    let grid = [];
    for (let c = 0; c < COLS; c++) {
        let col = [];
        for (let r = 0; r < ROWS; r++) col.push(getRandomSymbol());
        grid.push(col);
    }
    return grid;
}

function evaluateGrid(grid) {
    let counts = {};
    let positions = {};

    for (let c = 0; c < COLS; c++) {
        for (let r = 0; r < ROWS; r++) {
            let sym = grid[c][r].name;
            if (sym !== 'SCATTER' && sym !== 'BOMB') {
                counts[sym] = (counts[sym] || 0) + 1;
                if (!positions[sym]) positions[sym] = [];
                positions[sym].push({ c, r });
            }
        }
    }

    let wins = [];
    let symbolsToRemove = [];
    let stepWin = 0;

    for (let sym in counts) {
        if (counts[sym] >= 8) {
            let count = counts[sym];
            let payIndex = count >= 12 ? 2 : (count >= 10 ? 1 : 0);
            let symData = symbols.find(s => s.name === sym);
            let payout = symData.pays[payIndex];

            stepWin += payout;
            wins.push({ symbol: sym, count: count, payout: payout, positions: positions[sym] });
            symbolsToRemove.push(...positions[sym]);
        }
    }
    return { wins, stepWin, symbolsToRemove };
}

function applyGravity(grid, symbolsToRemove) {
    let newGrid = [];
    for (let c = 0; c < COLS; c++) {
        let newCol = [];
        for (let r = ROWS - 1; r >= 0; r--) {
            if (!symbolsToRemove.some(pos => pos.c === c && pos.r === r)) {
                newCol.unshift(grid[c][r]);
            }
        }
        while (newCol.length < ROWS) newCol.unshift(getRandomSymbol());
        newGrid.push(newCol);
    }
    return newGrid;
}

// ==========================================
// ROUTES
// ==========================================

// Home page - redirect to login or game
app.get('/', (req, res) => {
    if (req.session.userId) {
        return res.redirect('/game');
    }
    res.render('login');
});

// Login page
app.get('/login', (req, res) => {
    if (req.session.userId) {
        return res.redirect('/game');
    }
    res.render('login');
});

// Game page
app.get('/game', requireAuth, async (req, res) => {
    try {
        const user = await UserBalance.findOne({ userId: req.session.userId });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.render('slot', { user: user });
    } catch (e) {
        console.error(e);
        res.status(500).send('Error loading game');
    }
});

// Login endpoint
app.post('/login', async (req, res) => {
    try {
        const { username } = req.body;
        if (!username || username.trim().length === 0) {
            return res.status(400).json({ error: 'Username required' });
        }

        const userId = username.toLowerCase().replace(/[^a-z0-9]/g, '');
        let user = await UserBalance.findOne({ userId });

        if (!user) {
            user = await UserBalance.create({
                userId,
                username,
                balance: 1000
            });
            console.log(`✅ New user created: ${username}`);
        } else {
            console.log(`✅ User logged in: ${username}`);
        }

        // Set session
        req.session.userId = userId;
        req.session.username = username;
        
        // Save session explicitly
        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                return res.status(500).json({ error: 'Session error' });
            }
            res.json({ success: true, redirect: '/game' });
        });

    } catch (e) {
        console.error('Login error:', e);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Logout
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).send('Logout failed');
        }
        res.redirect('/');
    });
});

// Get user balance
app.get('/api/balance', requireAuth, async (req, res) => {
    try {
        const user = await UserBalance.findOne({ userId: req.session.userId });
        res.json({ balance: user?.balance || 0 });
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch balance' });
    }
});

// Main spin endpoint
app.post('/api/spin', requireAuth, async (req, res) => {
    try {
        const { buyFeature, bet } = req.body;
        const betAmount = Math.max(0.1, Math.min(100, parseFloat(bet) || 1));
        const cost = buyFeature ? betAmount * 100 : betAmount;

        // Get user
        let user = await UserBalance.findOne({ userId: req.session.userId });
        if (!user) {
            return res.status(400).json({ error: 'User not found' });
        }

        // Check balance
        if (user.balance < cost) {
            return res.json({ error: 'Insufficient balance' });
        }

        // Deduct bet
        user.balance -= cost;
        user.totalBets += cost;
        user.totalSpins += 1;
        user.lastSpinAt = new Date();

        // Initialize game state
        let gameState = {
            mode: 'BASE',
            freeSpinsLeft: 0,
            totalBonusWin: 0,
            globalMultiplier: 0
        };

        // Generate grid
        let grid = generateGrid();

        // Feature buy = guaranteed 4 scatters
        if (buyFeature) {
            let scCols = [0, 1, 2, 3, 4, 5].sort(() => 0.5 - Math.random()).slice(0, 4);
            scCols.forEach(c => grid[c][Math.floor(Math.random() * ROWS)] = { name: 'SCATTER' });
            gameState.mode = 'FREE_SPINS';
            gameState.freeSpinsLeft = 15;
        }

        // Count initial scatters
        let initialScatters = 0;
        for (let c = 0; c < COLS; c++) {
            for (let r = 0; r < ROWS; r++) {
                if (grid[c][r].name === 'SCATTER') initialScatters++;
            }
        }

        // Cascade loop
        let cascades = [];
        let cascadeActive = true;
        let totalBaseWin = 0;
        let stepCount = 0;

        while (cascadeActive && stepCount < 20) {
            let evalResult = evaluateGrid(grid);

            cascades.push({
                grid: JSON.parse(JSON.stringify(grid)),
                wins: evalResult.wins,
                stepWin: evalResult.stepWin,
                removed: evalResult.symbolsToRemove
            });

            if (evalResult.wins.length > 0) {
                totalBaseWin += evalResult.stepWin;
                grid = applyGravity(grid, evalResult.symbolsToRemove);
                stepCount++;
            } else {
                cascadeActive = false;
            }
        }

        // Calculate bomb multipliers
        let finalGrid = cascades[cascades.length - 1].grid;
        let stepBombs = [];
        let totalBombMulti = 0;

        for (let c = 0; c < COLS; c++) {
            for (let r = 0; r < ROWS; r++) {
                if (finalGrid[c][r].name === 'BOMB') {
                    stepBombs.push({ c, r, multi: finalGrid[c][r].multi });
                    totalBombMulti += finalGrid[c][r].multi;
                }
            }
        }

        // Calculate final win
        let finalSpinWin = totalBaseWin;
        if (totalBaseWin > 0) {
            if (gameState.mode === 'FREE_SPINS') {
                if (totalBombMulti > 0) gameState.globalMultiplier += totalBombMulti;
                if (gameState.globalMultiplier > 0) finalSpinWin = totalBaseWin * gameState.globalMultiplier;
            } else {
                if (totalBombMulti > 0) finalSpinWin = totalBaseWin * totalBombMulti;
            }
        }

        // Apply winnings
        user.balance += finalSpinWin;
        user.totalWins += finalSpinWin;
        if (finalSpinWin > user.biggestWin) user.biggestWin = finalSpinWin;

        // Check for bonus trigger
        let triggeredBonus = false;
        if (gameState.mode === 'BASE' && initialScatters >= 4) {
            gameState.mode = 'FREE_SPINS';
            gameState.freeSpinsLeft = 15;
            gameState.globalMultiplier = 0;
            gameState.totalBonusWin = 0;
            triggeredBonus = true;
        }

        // Retrigger free spins
        if (gameState.mode === 'FREE_SPINS' && initialScatters >= 3 && !triggeredBonus && !buyFeature) {
            gameState.freeSpinsLeft += 5;
        }

        // Decrement free spins
        let nextAction = 'SPIN';
        if (gameState.mode === 'FREE_SPINS' && !triggeredBonus && !buyFeature) {
            gameState.freeSpinsLeft--;
            if (gameState.freeSpinsLeft <= 0) {
                nextAction = 'END_BONUS';
                gameState.mode = 'BASE';
            }
        }

        // Save spin history
        await SpinHistory.create({
            userId: req.session.userId,
            username: req.session.username,
            betAmount: betAmount,
            winAmount: finalSpinWin,
            profit: finalSpinWin - cost,
            cascades: cascades.length,
            bombMultiplier: totalBombMulti,
            freeSpinsTriggered: triggeredBonus
        });

        // Save user
        await user.save();

        res.json({
            cascades: cascades,
            bombs: stepBombs,
            totalBaseWin: totalBaseWin,
            finalSpinWin: finalSpinWin,
            newBalance: user.balance,
            bonusTriggered: triggeredBonus,
            spinsLeft: gameState.freeSpinsLeft,
            globalMultiplier: gameState.globalMultiplier,
            totalBonusWin: gameState.totalBonusWin,
            nextAction: nextAction,
            profit: finalSpinWin - cost
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Spin failed' });
    }
});

// Leaderboard
app.get('/api/leaderboard', async (req, res) => {
    try {
        const top = await UserBalance.find()
            .sort({ totalWins: -1 })
            .limit(10)
            .select('username totalWins biggestWin totalSpins balance');
        res.json(top);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
});

// User stats
app.get('/api/stats', requireAuth, async (req, res) => {
    try {
        const user = await UserBalance.findOne({ userId: req.session.userId });
        const history = await SpinHistory.find({ userId: req.session.userId })
            .sort({ timestamp: -1 })
            .limit(20);

        res.json({
            user: {
                username: user.username,
                balance: user.balance,
                totalWins: user.totalWins,
                totalBets: user.totalBets,
                totalSpins: user.totalSpins,
                biggestWin: user.biggestWin,
                roi: user.totalBets > 0 ? ((user.totalWins - user.totalBets) / user.totalBets * 100).toFixed(2) : 0
            },
            recentSpins: history
        });
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// ==========================================
// START SERVER
// ==========================================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🍊 CHAOS CASCADES running on http://localhost:${PORT}`);
});
