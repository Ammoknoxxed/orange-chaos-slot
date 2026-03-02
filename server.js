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
// DUEL AT DAWN ENGINE (1:1 Payouts & Rules)
// ==========================================
const symbols = [
    { name: 'ORANGE', weight: 5,  pays: [0, 0, 0, 4, 10, 20] },   // Sheriff
    { name: 'ROLEX',  weight: 10, pays: [0, 0, 0, 2, 6, 12] },    // Guns
    { name: 'BÜNDEL', weight: 15, pays: [0, 0, 0, 2, 6, 12] },    // Hat
    { name: 'ENERGY', weight: 20, pays: [0, 0, 0, 1, 3, 6] },     // Skull
    { name: 'CAP',    weight: 25, pays: [0, 0, 0, 1, 3, 6] },     // Wheel
    { name: 'ACE',    weight: 40, pays: [0, 0, 0, 0.2, 1, 2] },
    { name: 'KING',   weight: 50, pays: [0, 0, 0, 0.2, 1, 2] },
    { name: 'QUEEN',  weight: 60, pays: [0, 0, 0, 0.2, 1, 2] },
    { name: 'JACK',   weight: 70, pays: [0, 0, 0, 0.2, 1, 2] },
    { name: 'TEN',    weight: 80, pays: [0, 0, 0, 0.2, 1, 2] },
    { name: 'WILD',   weight: 10, pays: [0, 0, 0, 0, 0, 20], isWild: true }, 
    { name: 'JUICER', weight: 8,  pays: [0, 0, 0, 0, 0, 0] }, // VS
    { name: 'OUTLAW', weight: 5,  pays: [0, 0, 0, 0, 0, 0] }, // Gunman
    { name: 'SCATTER',weight: 40, pays: [0, 0, 0, 0, 0, 0], isScatter: true } 
];

const multipliers = [2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 50, 75, 100, 200];

// Exakt 19 Gewinnlinien für ein 5x5 Hacksaw Grid
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
    bulletsCollected: 0,
    duelSpinsUnlocked: 0,
    duelSpinsQueue: 0
};

let dummyBalance = 1000;

app.get('/', (req, res) => res.render('slot', { user: { username: 'Outlaw', balance: dummyBalance } }));

app.post('/api/spin', (req, res) => {
    let betAmount = gameState.mode === 'BASE' ? 1 : 0;
    if (gameState.mode === 'BASE' && dummyBalance < betAmount) return res.json({ error: "BROKE!" });
    dummyBalance -= betAmount;

    let isDuelSpin = gameState.mode === 'DUEL_SPIN';
    
    let grid = Array(5).fill(null).map(() => Array(5).fill(null));
    let scatterCount = 0;
    
    // REGEL: VS und Outlaw NIEMALS gleichzeitig! Wir würfeln vorher, was dieser Spin erlauben darf.
    let allowedFeature = Math.random() > 0.5 ? 'JUICER' : 'OUTLAW';
    if (gameState.mode === 'DUSK_DAWN' && !isDuelSpin) allowedFeature = 'OUTLAW'; // Keine normalen VS im blauen Bonus
    if (isDuelSpin) allowedFeature = 'JUICER';

    let outlawsOnGrid = 0;

    for (let col = 0; col < 5; col++) {
        let colHasFeature = false;
        for (let row = 0; row < 5; row++) {
            let symPool = symbols.filter(s => {
                if (s.name === 'SCATTER' && gameState.mode === 'DUSK_DAWN') return false; 
                if (s.name === 'JUICER' && (allowedFeature !== 'JUICER' || colHasFeature)) return false; 
                if (s.name === 'OUTLAW' && (allowedFeature !== 'OUTLAW' || colHasFeature || outlawsOnGrid >= 2)) return false; 
                return true;
            });

            if (gameState.mode === 'WILD_WEST') {
                let j = symPool.find(s=>s.name==='JUICER'); if(j) j.weight = 15;
                let o = symPool.find(s=>s.name==='OUTLAW'); if(o) o.weight = 12;
            }

            let totalW = symPool.reduce((sum, sym) => sum + sym.weight, 0);
            let r = Math.random() * totalW;
            let chosen = symPool[symPool.length - 1];
            for (const sym of symPool) { if (r < sym.weight) { chosen = sym; break; } r -= sym.weight; }

            grid[row][col] = chosen.name;
            if (chosen.isScatter) scatterCount++;
            if (chosen.name === 'JUICER' || chosen.name === 'OUTLAW') colHasFeature = true;
            if (chosen.name === 'OUTLAW') outlawsOnGrid++;
        }
    }

    // DuelSpin Guaranteed VS
    if (isDuelSpin) {
        let vsToPlace = Math.min(5, gameState.duelSpinsUnlocked + 1); // Spin 1=2VS, 2=3VS, 3=4VS, 4=5VS
        let cols = [0,1,2,3,4].sort(() => 0.5 - Math.random()).slice(0, vsToPlace);
        cols.forEach(c => grid[Math.floor(Math.random()*5)][c] = 'JUICER');
    }

    let outlawsExpanded = [];
    let vsExpanded = [];
    let shotsFired = [];

    // OUTLAW SHOOTING LOGIC
    for (let c = 0; c < 5; c++) {
        for (let r = 0; r < 5; r++) {
            if (grid[r][c] === 'OUTLAW') {
                let bullets = Math.floor(Math.random() * 6) + 1;
                let multi = multipliers[Math.floor(Math.random() * multipliers.length)];
                
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
                for(let i=0; i<5; i++) grid[i][c] = 'WILD_OUTLAW'; 
                
                if (gameState.mode === 'DUSK_DAWN') {
                    gameState.bulletsCollected += bullets;
                    while (gameState.bulletsCollected >= 6) {
                        gameState.bulletsCollected -= 6;
                        gameState.duelSpinsUnlocked++;
                        gameState.duelSpinsQueue++;
                        gameState.freeSpinsLeft += 3;
                    }
                }
            }
        }
    }

    // VS WIN-CHECK LOGIC (Tease!)
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

        // Nur die, die gewinnen, klappen echt aus!
        winningJuicers.forEach(c => {
            let m1 = multipliers[Math.floor(Math.random() * multipliers.length)];
            let m2 = multipliers[Math.floor(Math.random() * multipliers.length)];
            let winner = Math.random() > 0.5 ? m1 : m2;
            vsExpanded.push({ col: c, multi: winner, duel: [m1, m2] });
            for(let r=0; r<5; r++) grid[r][c] = 'WILD_VS';
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
                if (sym === 'WILD_OUTLAW') { let o = outlawsExpanded.find(x=>x.col === c); if(o && !lineMultis.includes(o.multi)) lineMultis.push(o.multi); }
                if (sym === 'WILD_VS') { let v = vsExpanded.find(x=>x.col === c); if(v && !lineMultis.includes(v.multi)) lineMultis.push(v.multi); }
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
            gameState.mode = 'WILD_WEST'; gameState.freeSpinsLeft = 10; triggeredBonus = 'WILD_WEST';
        } else if (scatterCount >= 4) {
            gameState.mode = 'DUSK_DAWN'; gameState.freeSpinsLeft = 10;
            gameState.bulletsCollected = 0; gameState.duelSpinsUnlocked = 0; gameState.duelSpinsQueue = 0;
            triggeredBonus = 'DUSK_DAWN';
        }
    } else if (gameState.mode === 'WILD_WEST') {
        if (scatterCount === 2) gameState.freeSpinsLeft += 2;
        if (scatterCount >= 3) gameState.freeSpinsLeft += 4;
    }

    let nextAction = 'SPIN';
    if (gameState.mode !== 'BASE' && oldMode !== 'BASE') {
        if (isDuelSpin) {
            gameState.duelSpinsQueue--;
            if (gameState.duelSpinsQueue === 0) gameState.mode = 'DUSK_DAWN';
        } else if (gameState.duelSpinsQueue > 0) {
            gameState.mode = 'DUEL_SPIN'; nextAction = 'DUEL_SPIN';
        } else {
            gameState.freeSpinsLeft--;
        }
        if (gameState.freeSpinsLeft <= 0 && gameState.duelSpinsQueue <= 0) {
            nextAction = 'END_BONUS'; gameState.mode = 'BASE';
        }
    }

    res.json({
        grid: grid, win: totalWin, scatters: scatterCount, outlaws: outlawsExpanded, shotsFired: shotsFired,
        vsJuicers: vsExpanded, newBalance: dummyBalance, bonusTriggered: triggeredBonus, spinsLeft: gameState.freeSpinsLeft,
        totalBonusWin: gameState.totalBonusWin, nextAction: nextAction,
        bullets: gameState.bulletsCollected // Für das UI
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🎰 The Beast runs on ${PORT}`));
