const express = require('express');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
app.use(express.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const MONGO_URL = process.env.MONGO_URL || ''; 
if (MONGO_URL) {
    mongoose.connect(MONGO_URL).then(() => console.log('✅ Mit MongoDB verbunden!')).catch(err => console.error('❌ MongoDB Fehler:', err));
}

// ==========================================
// CHAOS ORANGE ENGINE (Extreme Volatility)
// ==========================================
const symbols = [
    { name: 'ORANGE', weight: 5,  pays: [0, 0, 0, 4, 10, 20] },   // Top Symbol
    { name: 'ROLEX',  weight: 10, pays: [0, 0, 0, 2, 6, 12] },    
    { name: 'BÜNDEL', weight: 15, pays: [0, 0, 0, 2, 6, 12] },    
    { name: 'ENERGY', weight: 20, pays: [0, 0, 0, 1, 3, 6] },     
    { name: 'CAP',    weight: 25, pays: [0, 0, 0, 1, 3, 6] },     
    { name: 'ACE',    weight: 40, pays: [0, 0, 0, 0.2, 1, 2] },
    { name: 'KING',   weight: 50, pays: [0, 0, 0, 0.2, 1, 2] },
    { name: 'QUEEN',  weight: 60, pays: [0, 0, 0, 0.2, 1, 2] },
    { name: 'JACK',   weight: 70, pays: [0, 0, 0, 0.2, 1, 2] },
    { name: 'TEN',    weight: 80, pays: [0, 0, 0, 0.2, 1, 2] },
    { name: 'WILD',   weight: 10, pays: [0, 0, 0, 0, 0, 20], isWild: true }, 
    { name: 'JUICER', weight: 8,  pays: [0, 0, 0, 0, 0, 0] }, // Expanding VS
    { name: 'BOMBER', weight: 5,  pays: [0, 0, 0, 0, 0, 0] }, // Gunman/Bomber
    { name: 'SCATTER',weight: 40, pays: [0, 0, 0, 0, 0, 0], isScatter: true } 
];

// Die absolut kranken Hacksaw-Multis (bis 1000x für den totalen Wahnsinn)
const multipliers = [2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 50, 75, 100, 250, 500, 1000];

// 19 Gewinnlinien
const paylines = [
    [0,0,0,0,0], [1,1,1,1,1], [2,2,2,2,2], [3,3,3,3,3], [4,4,4,4,4], 
    [0,1,2,1,0], [1,2,3,2,1], [2,3,4,3,2], [4,3,2,3,4], [3,2,1,2,3], 
    [2,1,0,1,2], [0,1,2,3,4], [4,3,2,1,0], [0,0,1,2,3], [4,4,3,2,1],
    [1,1,2,3,4], [3,3,2,1,0], [0,2,4,2,0], [4,2,0,2,4]
];

let gameState = {
    mode: 'BASE',
    freeSpinsLeft: 0,
    totalBonusWin: 0,
    dropsCollected: 0,
    chaosDropsUnlocked: 0,
    chaosDropsQueue: 0
};

let dummyBalance = 1000;

app.get('/', (req, res) => res.render('slot', { user: { username: 'Juicer', balance: dummyBalance } }));

app.post('/api/spin', (req, res) => {
    let betAmount = gameState.mode === 'BASE' ? 1 : 0;
    if (gameState.mode === 'BASE' && dummyBalance < betAmount) return res.json({ error: "BROKE!" });
    dummyBalance -= betAmount;

    let isChaosDrop = gameState.mode === 'CHAOS_DROP';
    let grid = Array(5).fill(null).map(() => Array(5).fill(null));
    
    // Feature Rule
    let allowedFeature = Math.random() > 0.5 ? 'JUICER' : 'BOMBER';
    if (gameState.mode === 'CHAOS_SPINS' && !isChaosDrop) allowedFeature = 'BOMBER'; 
    if (isChaosDrop) allowedFeature = 'JUICER';

    let bombersOnGrid = 0;
    let scatterCount = 0;
    let earlyScatters = 0; // Für die Teaser-Logik

    for (let col = 0; col < 5; col++) {
        let colHasFeature = false;
        let scatterInThisCol = false;

        for (let row = 0; row < 5; row++) {
            let symPool = symbols.filter(s => {
                if (s.name === 'SCATTER' && gameState.mode === 'CHAOS_SPINS') return false; 
                if (s.name === 'JUICER' && (allowedFeature !== 'JUICER' || colHasFeature)) return false; 
                if (s.name === 'BOMBER' && (allowedFeature !== 'BOMBER' || colHasFeature || bombersOnGrid >= 2)) return false; 
                return true;
            });

            if (gameState.mode === 'JUICE_SPINS') {
                let j = symPool.find(s=>s.name==='JUICER'); if(j) j.weight = 15;
                let b = symPool.find(s=>s.name==='BOMBER'); if(b) b.weight = 12;
            }

            let totalW = symPool.reduce((sum, sym) => sum + sym.weight, 0);
            let r = Math.random() * totalW;
            let chosen = symPool[symPool.length - 1];
            for (const sym of symPool) { if (r < sym.weight) { chosen = sym; break; } r -= sym.weight; }

            grid[row][col] = chosen.name;
            
            if (chosen.isScatter) {
                scatterCount++;
                scatterInThisCol = true;
            }
            if (chosen.name === 'JUICER' || chosen.name === 'BOMBER') colHasFeature = true;
            if (chosen.name === 'BOMBER') bombersOnGrid++;
        }
        
        // Zähle Scatters auf den ersten 3 Walzen für den Tension-Spin
        if (col < 3 && scatterInThisCol) earlyScatters++;
    }

    // Teaser Logik: Wenn auf den ersten 3 Walzen schon 2 Scatter sind -> Hype auf Walze 4 und 5!
    let isTeaser = (earlyScatters >= 2 && gameState.mode === 'BASE');

    // CHAOS DROP Guaranteed Juicers
    if (isChaosDrop) {
        let juicersToPlace = Math.min(5, gameState.chaosDropsUnlocked + 1);
        let cols = [0,1,2,3,4].sort(() => 0.5 - Math.random()).slice(0, juicersToPlace);
        cols.forEach(c => grid[Math.floor(Math.random()*5)][c] = 'JUICER');
    }

    let bombersExpanded = [];
    let juicersExpanded = [];
    let splattersFired = [];

    // BOMBER SPLATTER LOGIC
    for (let c = 0; c < 5; c++) {
        for (let r = 0; r < 5; r++) {
            if (grid[r][c] === 'BOMBER') {
                let drops = Math.floor(Math.random() * 6) + 1;
                let multi = multipliers[Math.floor(Math.random() * multipliers.length)];
                
                let availableSpots = [];
                for(let rr=0; rr<5; rr++) for(let cc=0; cc<5; cc++) {
                    if (cc !== c && grid[rr][cc] !== 'WILD' && grid[rr][cc] !== 'BOMBER') availableSpots.push({r:rr, c:cc});
                }
                availableSpots = availableSpots.sort(() => 0.5 - Math.random()).slice(0, drops);
                availableSpots.forEach(spot => {
                    grid[spot.r][spot.c] = 'WILD';
                    splattersFired.push({r: spot.r, c: spot.c});
                });

                bombersExpanded.push({ col: c, multi: multi, drops: drops, origin: {r, c} });
                for(let i=0; i<5; i++) grid[i][c] = 'WILD_BOMBER'; 
                
                if (gameState.mode === 'CHAOS_SPINS') {
                    gameState.dropsCollected += drops;
                    while (gameState.dropsCollected >= 6) {
                        gameState.dropsCollected -= 6;
                        gameState.chaosDropsUnlocked++;
                        gameState.chaosDropsQueue++;
                        gameState.freeSpinsLeft += 3;
                    }
                }
            }
        }
    }

    // JUICER WIN-CHECK LOGIC
    let activeJuicers = [];
    for(let c=0; c<5; c++) {
        for(let r=0; r<5; r++) if(grid[r][c] === 'JUICER') activeJuicers.push(c);
    }

    if (activeJuicers.length > 0) {
        let virtualGrid = JSON.parse(JSON.stringify(grid));
        activeJuicers.forEach(c => { for(let r=0; r<5; r++) virtualGrid[r][c] = 'WILD_TEST'; });

        let winningJuicers = new Set();
        paylines.forEach(line => {
            let matchCount = 0; let target = null; let lineJuicers = [];
            for (let c=0; c<5; c++) {
                let sym = virtualGrid[line[c]][c];
                if (sym === 'SCATTER') break;
                let isW = sym.includes('WILD');
                if (!target && !isW) target = sym;
                if (isW || sym === target) { 
                    matchCount++; 
                    if(sym === 'WILD_TEST') lineJuicers.push(c);
                } else break;
            }
            if (matchCount >= 3) lineJuicers.forEach(j => winningJuicers.add(j));
        });

        winningJuicers.forEach(c => {
            let m1 = multipliers[Math.floor(Math.random() * multipliers.length)];
            let m2 = multipliers[Math.floor(Math.random() * multipliers.length)];
            let winner = Math.random() > 0.5 ? m1 : m2; // Visual Tease possible later
            juicersExpanded.push({ col: c, multi: winner });
            for(let r=0; r<5; r++) grid[r][c] = 'WILD_JUICER';
        });
    }

    // GEWINNBERECHNUNG
    let totalWin = 0;
    paylines.forEach(line => {
        let matchCount = 0; let target = null; let lineMultis = [];

        for (let c=0; c<5; c++) {
            let sym = grid[line[c]][c];
            if (sym === 'SCATTER') break;
            let isW = sym.includes('WILD');
            if (!target && !isW) target = sym;
            if (isW || sym === target) { 
                matchCount++; 
                if (sym === 'WILD_BOMBER') { let b = bombersExpanded.find(x=>x.col === c); if(b && !lineMultis.includes(b.multi)) lineMultis.push(b.multi); }
                if (sym === 'WILD_JUICER') { let v = juicersExpanded.find(x=>x.col === c); if(v && !lineMultis.includes(v.multi)) lineMultis.push(v.multi); }
            } else break;
        }

        if (matchCount >= 3 && target) {
            let symData = symbols.find(s=>s.name === target);
            let baseW = (1) * symData.pays[matchCount]; 
            let multiSum = lineMultis.length > 0 ? lineMultis.reduce((a,b)=>a+b, 0) : 1;
            totalWin += baseW * multiSum;
        }
    });

    if (gameState.mode !== 'BASE') gameState.totalBonusWin += totalWin;
    dummyBalance += totalWin;

    // BONUS TRIGGER LOGIK
    let triggeredBonus = null;
    let oldMode = gameState.mode;

    if (gameState.mode === 'BASE') {
        if (scatterCount === 3) {
            gameState.mode = 'JUICE_SPINS'; gameState.freeSpinsLeft = 10; triggeredBonus = 'JUICE_SPINS';
        } else if (scatterCount >= 4) {
            gameState.mode = 'CHAOS_SPINS'; gameState.freeSpinsLeft = 10;
            gameState.dropsCollected = 0; gameState.chaosDropsUnlocked = 0; gameState.chaosDropsQueue = 0;
            triggeredBonus = 'CHAOS_SPINS';
        }
    } else if (gameState.mode === 'JUICE_SPINS') {
        if (scatterCount === 2) gameState.freeSpinsLeft += 2;
        if (scatterCount >= 3) gameState.freeSpinsLeft += 4;
    }

    let nextAction = 'SPIN';
    if (gameState.mode !== 'BASE' && oldMode !== 'BASE') {
        if (isChaosDrop) {
            gameState.chaosDropsQueue--;
            if (gameState.chaosDropsQueue === 0) gameState.mode = 'CHAOS_SPINS';
        } else if (gameState.chaosDropsQueue > 0) {
            gameState.mode = 'CHAOS_DROP'; nextAction = 'CHAOS_DROP';
        } else {
            gameState.freeSpinsLeft--;
        }
        if (gameState.freeSpinsLeft <= 0 && gameState.chaosDropsQueue <= 0) {
            nextAction = 'END_BONUS'; gameState.mode = 'BASE';
        }
    }

    res.json({
        grid: grid, 
        win: totalWin, 
        scatters: scatterCount, 
        bombers: bombersExpanded, 
        splatters: splattersFired,
        juicers: juicersExpanded, 
        newBalance: dummyBalance, 
        bonusTriggered: triggeredBonus, 
        spinsLeft: gameState.freeSpinsLeft,
        totalBonusWin: gameState.totalBonusWin, 
        nextAction: nextAction,
        drops: gameState.dropsCollected,
        isTeaser: isTeaser // TEASER FLAG FÜR FRONTEND!
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🍊 CHAOS ORANGE läuft auf Port ${PORT}`));
