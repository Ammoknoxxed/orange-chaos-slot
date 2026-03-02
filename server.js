const express = require('express');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
app.use(express.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ==========================================
// DATENBANK VERBINDUNG
// ==========================================
const MONGO_URL = process.env.MONGO_URL || ''; 
if (MONGO_URL) {
    mongoose.connect(MONGO_URL).then(() => console.log('✅ Mit MongoDB verbunden!')).catch(err => console.error('❌ MongoDB Fehler:', err));
} else {
    console.log('⚠️ Keine MONGO_URL. Demo-Modus!');
}

// ==========================================
// DIE NEUE "DUEL AT DAWN" ENGINE
// ==========================================
const symbols = [
    { name: 'ORANGE', weight: 5,  pays: [0, 0, 0, 5, 20, 100] },
    { name: 'ROLEX',  weight: 10, pays: [0, 0, 0, 3, 10, 50] },
    { name: 'BÜNDEL', weight: 15, pays: [0, 0, 0, 2, 8, 40] },
    { name: 'ENERGY', weight: 20, pays: [0, 0, 0, 1.5, 5, 25] },
    { name: 'CAP',    weight: 25, pays: [0, 0, 0, 1, 4, 15] },
    { name: 'ACE',    weight: 40, pays: [0, 0, 0, 0.5, 2, 5] },
    { name: 'KING',   weight: 50, pays: [0, 0, 0, 0.5, 1.5, 4] },
    { name: 'QUEEN',  weight: 60, pays: [0, 0, 0, 0.4, 1, 3] },
    { name: 'JACK',   weight: 70, pays: [0, 0, 0, 0.4, 1, 3] },
    { name: 'TEN',    weight: 80, pays: [0, 0, 0, 0.2, 0.5, 2] },
    { name: 'WILD',   weight: 10, pays: [0, 0, 0, 5, 20, 100], isWild: true }, // Neues Wild Symbol
    { name: 'JUICER', weight: 8,  pays: [0, 0, 0, 0, 0, 0] }, // VS Symbol
    { name: 'OUTLAW', weight: 5,  pays: [0, 0, 0, 0, 0, 0] }, // Outlaw Symbol
    // GEBOOSTETER SCATTER FÜR TESTS (ca. alle 3 Spins ein Hit!)
    { name: 'SCATTER',weight: 45, pays: [0, 0, 0, 0, 0, 0], isScatter: true } 
];

// Die exakten Duel at Dawn Multiplikatoren (Gewichtet)
const multipliers = [
    ...Array(30).fill(2), ...Array(30).fill(3), ...Array(25).fill(4), ...Array(25).fill(5),
    ...Array(20).fill(6), ...Array(20).fill(7), ...Array(15).fill(8), ...Array(15).fill(9),
    ...Array(15).fill(10), ...Array(10).fill(15), ...Array(10).fill(20), ...Array(5).fill(25),
    ...Array(3).fill(50), ...Array(2).fill(75), ...Array(1).fill(100), ...Array(1).fill(200)
];

const paylines = [
    [0,0,0,0,0], [1,1,1,1,1], [2,2,2,2,2], [3,3,3,3,3], [4,4,4,4,4], 
    [0,1,2,3,4], [4,3,2,1,0], [0,1,2,1,0], [4,3,2,3,4], [1,2,3,2,1], 
    [3,2,1,2,3], [2,1,0,1,2], [2,3,4,3,2], [0,0,1,2,2]
];

// State Maschine für den Server (Speichert den Bonus-Fortschritt)
let gameState = {
    mode: 'BASE', // BASE, WILD_WEST, DUSK_DAWN, DUEL_SPIN
    freeSpinsLeft: 0,
    totalBonusWin: 0,
    bulletsCollected: 0,
    duelSpinsUnlocked: 0,
    duelSpinsQueue: 0
};

let dummyBalance = 1000;

app.get('/', (req, res) => res.render('slot', { user: { username: 'Gunslinger', balance: dummyBalance } }));

app.post('/api/spin', (req, res) => {
    let betAmount = gameState.mode === 'BASE' ? 1 : 0;
    if (gameState.mode === 'BASE' && dummyBalance < betAmount) return res.json({ error: "NICHT GENUG BALANCE!" });
    dummyBalance -= betAmount;

    let isDuelSpin = gameState.mode === 'DUEL_SPIN';
    
    // 1. GRID GENERIERUNG (Mutually Exclusive Logic)
    let grid = Array(5).fill(null).map(() => Array(5).fill(null));
    let scatterCount = 0;
    let hasVS = false;
    let outlawsOnGrid = 0;

    for (let col = 0; col < 5; col++) {
        let colHasVS = false;
        let colHasOutlaw = false;

        for (let row = 0; row < 5; row++) {
            let symPool = symbols.filter(s => {
                if (isDuelSpin && s.name !== 'JUICER') return true; // DuelSpins = Guaranteed VS logic later
                if (s.name === 'SCATTER' && gameState.mode === 'DUSK_DAWN') return false; 
                if (s.name === 'JUICER' && (outlawsOnGrid > 0 || colHasVS || gameState.mode === 'DUSK_DAWN')) return false; 
                if (s.name === 'OUTLAW' && (hasVS || colHasOutlaw || outlawsOnGrid >= 2 || isDuelSpin)) return false; 
                return true;
            });

            // Boost Boni
            if (gameState.mode === 'WILD_WEST') {
                let j = symPool.find(s=>s.name==='JUICER'); if(j) j.weight = 20;
                let o = symPool.find(s=>s.name==='OUTLAW'); if(o) o.weight = 15;
            }

            let totalW = symPool.reduce((sum, sym) => sum + sym.weight, 0);
            let r = Math.random() * totalW;
            let chosen = symPool[symPool.length - 1];
            for (const sym of symPool) { if (r < sym.weight) { chosen = sym; break; } r -= sym.weight; }

            grid[row][col] = chosen.name;
            if (chosen.isScatter) scatterCount++;
            if (chosen.name === 'JUICER') { colHasVS = true; hasVS = true; }
            if (chosen.name === 'OUTLAW') { colHasOutlaw = true; outlawsOnGrid++; }
        }
    }

    // DuelSpin Override (Garantiert VS Symbole)
    if (isDuelSpin) {
        let vsToPlace = Math.min(5, gameState.duelSpinsUnlocked + 1);
        let cols = [0,1,2,3,4].sort(() => 0.5 - Math.random()).slice(0, vsToPlace);
        cols.forEach(c => grid[Math.floor(Math.random()*5)][c] = 'JUICER');
        hasVS = true;
    }

    let outlawsExpanded = [];
    let vsExpanded = [];
    let shotsFired = [];

    // 2. THE OUTLAW FEATURE
    for (let c = 0; c < 5; c++) {
        for (let r = 0; r < 5; r++) {
            if (grid[r][c] === 'OUTLAW') {
                let bullets = Math.floor(Math.random() * 6) + 1;
                let multi = multipliers[Math.floor(Math.random() * multipliers.length)];
                
                // Schieße Wilds
                let availableSpots = [];
                for(let rr=0; rr<5; rr++) for(let cc=0; cc<5; cc++) {
                    if (cc !== c && grid[rr][cc] !== 'WILD' && grid[rr][cc] !== 'OUTLAW') availableSpots.push({r:rr, c:cc});
                }
                availableSpots = availableSpots.sort(() => 0.5 - Math.random()).slice(0, bullets);
                availableSpots.forEach(spot => {
                    grid[spot.r][spot.c] = 'WILD';
                    shotsFired.push({r: spot.r, c: spot.c});
                });

                outlawsExpanded.push({ col: c, multi: multi, bullets: bullets });
                // Outlaw Reel wird Wild
                for(let i=0; i<5; i++) grid[i][c] = 'WILD_OUTLAW'; 
                
                if (gameState.mode === 'DUSK_DAWN') {
                    gameState.bulletsCollected += bullets;
                    while (gameState.bulletsCollected >= 6) {
                        gameState.bulletsCollected -= 6;
                        gameState.duelSpinsUnlocked++;
                        gameState.duelSpinsQueue++;
                        gameState.freeSpinsLeft += 3; // +3 Spins pro Unlock!
                    }
                }
            }
        }
    }

    // 3. DUELREELS (VS FEATURE) - Prüfen, ob es einen Gewinn macht!
    let activeJuicers = [];
    if (hasVS) {
        let virtualGrid = JSON.parse(JSON.stringify(grid));
        // Mache alle VS testweise zu Wilds
        for(let c=0; c<5; c++) {
            let hasV = false;
            for(let r=0; r<5; r++) if(virtualGrid[r][c] === 'JUICER') hasV = true;
            if (hasV) {
                for(let r=0; r<5; r++) virtualGrid[r][c] = 'WILD_TEST';
                activeJuicers.push(c);
            }
        }

        // Teste Paylines
        let anyWin = false;
        paylines.forEach(line => {
            let matchCount = 0; let target = null; let hasTestWild = false;
            for (let c=0; c<5; c++) {
                let sym = virtualGrid[line[c]][c];
                if (sym === 'SCATTER') break;
                let isW = sym.includes('WILD');
                if (!target && !isW) target = sym;
                if (isW || sym === target) { matchCount++; if(sym === 'WILD_TEST') hasTestWild = true; } else break;
            }
            if (matchCount >= 3 && hasTestWild) anyWin = true;
        });

        // Wenn Gewinn, dann expandiere sie echt!
        if (anyWin) {
            activeJuicers.forEach(c => {
                let m1 = multipliers[Math.floor(Math.random() * multipliers.length)];
                let m2 = multipliers[Math.floor(Math.random() * multipliers.length)];
                let winner = Math.random() > 0.5 ? m1 : m2;
                vsExpanded.push({ col: c, multi: winner, duel: [m1, m2] });
                for(let r=0; r<5; r++) grid[r][c] = 'WILD_VS';
            });
        }
    }

    // 4. GEWINNBERECHNUNG
    let totalWin = 0;
    paylines.forEach(line => {
        let matchCount = 0; let target = null;
        let lineMultis = [];

        for (let c=0; c<5; c++) {
            let sym = grid[line[c]][c];
            if (sym === 'SCATTER') break;
            let isW = sym.includes('WILD');
            if (!target && !isW) target = sym;
            if (isW || sym === target) { 
                matchCount++; 
                if (sym === 'WILD_OUTLAW') { let o = outlawsExpanded.find(x=>x.col === c); if(o && !lineMultis.includes(o.multi)) lineMultis.push(o.multi); }
                if (sym === 'WILD_VS') { let v = vsExpanded.find(x=>x.col === c); if(v && !lineMultis.includes(v.multi)) lineMultis.push(v.multi); }
            } else break;
        }

        if (matchCount >= 3 && target) {
            let symData = symbols.find(s=>s.name === target);
            let baseW = (1) * symData.pays[matchCount]; // Einsatz immer 1€ für Baseberechnung
            let multiSum = lineMultis.length > 0 ? lineMultis.reduce((a,b)=>a+b, 0) : 1;
            totalWin += baseW * multiSum;
        }
    });

    if (gameState.mode !== 'BASE') gameState.totalBonusWin += totalWin;
    dummyBalance += totalWin;

    // 5. STATE MANAGEMENT (Boni Trigger)
    let triggeredBonus = null;
    let oldMode = gameState.mode;

    if (gameState.mode === 'BASE') {
        if (scatterCount === 3) {
            gameState.mode = 'WILD_WEST';
            gameState.freeSpinsLeft = 10;
            triggeredBonus = 'WILD_WEST';
        } else if (scatterCount >= 4) {
            gameState.mode = 'DUSK_DAWN';
            gameState.freeSpinsLeft = 10;
            gameState.bulletsCollected = 0;
            gameState.duelSpinsUnlocked = 0;
            gameState.duelSpinsQueue = 0;
            triggeredBonus = 'DUSK_DAWN';
        }
    } else if (gameState.mode === 'WILD_WEST') {
        if (scatterCount === 2) gameState.freeSpinsLeft += 2;
        if (scatterCount >= 3) gameState.freeSpinsLeft += 4;
    }

    // Queue Management
    let nextAction = 'SPIN';
    if (gameState.mode !== 'BASE' && oldMode !== 'BASE') {
        if (isDuelSpin) {
            gameState.duelSpinsQueue--;
            if (gameState.duelSpinsQueue === 0) gameState.mode = 'DUSK_DAWN';
        } else if (gameState.duelSpinsQueue > 0) {
            gameState.mode = 'DUEL_SPIN';
            nextAction = 'DUEL_SPIN';
        } else {
            gameState.freeSpinsLeft--;
        }
        
        if (gameState.freeSpinsLeft <= 0 && gameState.duelSpinsQueue <= 0) {
            nextAction = 'END_BONUS';
            gameState.mode = 'BASE';
        }
    }

    res.json({
        grid: grid,
        win: totalWin,
        scatters: scatterCount,
        outlaws: outlawsExpanded,
        shotsFired: shotsFired,
        vsJuicers: vsExpanded,
        newBalance: dummyBalance,
        bonusTriggered: triggeredBonus,
        spinsLeft: gameState.freeSpinsLeft,
        totalBonusWin: gameState.totalBonusWin,
        nextAction: nextAction
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🎰 Duel Engine läuft auf Port ${PORT}`));
