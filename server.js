const express = require('express');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
app.use(express.json());

// EJS als Template-Engine setzen
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ==========================================
// DATENBANK VERBINDUNG (Wartet auf Railway Variable)
// ==========================================
const MONGO_URL = process.env.MONGO_URL || ''; 

if (MONGO_URL) {
    mongoose.connect(MONGO_URL)
    .then(() => console.log('✅ Mit MongoDB verbunden!'))
    .catch(err => console.error('❌ MongoDB Fehler:', err));
} else {
    console.log('⚠️ Keine MONGO_URL gefunden. Server läuft im Demo-Modus!');
}

// ==========================================
// SLOT ENGINE (V2 Balanced RTP)
// ==========================================
const symbols = [
    { icon: '🍊', name: 'ORANGE', weight: 5,  pays: [0, 0, 0, 5, 20, 100] },
    { icon: '⌚', name: 'ROLEX',  weight: 10, pays: [0, 0, 0, 3, 10, 50] },
    { icon: '💵', name: 'BÜNDEL', weight: 15, pays: [0, 0, 0, 2, 8, 40] },
    { icon: '🥤', name: 'ENERGY', weight: 20, pays: [0, 0, 0, 1.5, 5, 25] },
    { icon: '🧢', name: 'CAP',    weight: 25, pays: [0, 0, 0, 1, 4, 15] },
    { icon: ' A', name: 'ACE',    weight: 40, pays: [0, 0, 0, 0.5, 2, 5] },
    { icon: ' K', name: 'KING',   weight: 50, pays: [0, 0, 0, 0.5, 1.5, 4] },
    { icon: ' Q', name: 'QUEEN',  weight: 60, pays: [0, 0, 0, 0.4, 1, 3] },
    { icon: ' J', name: 'JACK',   weight: 70, pays: [0, 0, 0, 0.4, 1, 3] },
    { icon: '10', name: 'TEN',    weight: 80, pays: [0, 0, 0, 0.2, 0.5, 2] },
    { icon: '🌪️', name: 'JUICER', weight: 7,  pays: [0, 0, 0, 0, 0, 0], isWild: true },
    // DEV CHEAT: Scatter Weight auf 150 gesetzt, damit du die Freispiele sofort siehst!
    { icon: '🌟', name: 'SCATTER',weight: 150, pays: [0, 0, 0, 0, 0, 0], isScatter: true } 
];

const multipliers = [
    ...Array(300).fill(2), ...Array(250).fill(3), ...Array(200).fill(4), 
    ...Array(100).fill(5), ...Array(60).fill(10), ...Array(40).fill(25), 
    ...Array(25).fill(50), ...Array(15).fill(100), ...Array(7).fill(250), 
    ...Array(2).fill(500), ...Array(1).fill(1000)
];

const paylines = [
    [0,0,0,0,0], [1,1,1,1,1], [2,2,2,2,2], [3,3,3,3,3], [4,4,4,4,4], 
    [0,1,2,3,4], [4,3,2,1,0], [0,1,2,1,0], [4,3,2,3,4], [1,2,3,2,1], 
    [3,2,1,2,3], [2,1,0,1,2], [2,3,4,3,2], [0,0,1,2,2]
];

function getRandomSymbol(isBonusGame = false) {
    let currentSymbols = symbols.map(s => ({...s})); 
    if (isBonusGame) {
        let juicer = currentSymbols.find(s => s.name === 'JUICER');
        juicer.weight = 15; 
    }
    const totalWeight = currentSymbols.reduce((sum, sym) => sum + sym.weight, 0);
    let randomNum = Math.random() * totalWeight;
    for (const sym of currentSymbols) {
        if (randomNum < sym.weight) return sym;
        randomNum -= sym.weight;
    }
    return currentSymbols[currentSymbols.length - 1];
}

// ==========================================
// API ROUTEN
// ==========================================

let dummyBalance = 1000;

app.get('/', (req, res) => {
    res.render('slot', { user: { username: 'Streamer', balance: dummyBalance } });
});

app.post('/api/spin', (req, res) => {
    const betAmount = 1; 

    if (dummyBalance < betAmount) {
        return res.json({ error: "NICHT GENUG BALANCE!" });
    }

    dummyBalance -= betAmount;

    let grid = Array(5).fill(null).map(() => Array(5).fill(null));
    let scatterCount = 0;

    for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 5; col++) {
            const sym = getRandomSymbol(false);
            grid[row][col] = sym;
            if (sym.isScatter) scatterCount++;
        }
    }

    let totalWin = 0;
    let expandedJuicers = new Map();
    let juicerDuels = []; 

    paylines.forEach((line) => {
        let matchCount = 0;
        let targetSymbol = null;
        let lineHasJuicer = false;
        let juicerColsInThisLine = [];

        for (let col = 0; col < 5; col++) {
            const row = line[col];
            const currentSymbol = grid[row][col];

            if (currentSymbol.isScatter) break;
            if (targetSymbol === null && !currentSymbol.isWild) targetSymbol = currentSymbol;

            if (currentSymbol.isWild || (targetSymbol && currentSymbol.name === targetSymbol.name)) {
                matchCount++;
                if (currentSymbol.isWild) { 
                    lineHasJuicer = true; 
                    juicerColsInThisLine.push(col); 
                }
            } else { break; }
        }

        if (matchCount >= 3 && targetSymbol) {
            let baseWin = betAmount * targetSymbol.pays[matchCount];
            let finalWin = baseWin;

            if (lineHasJuicer) {
                let totalMulti = 0;
                juicerColsInThisLine.forEach(col => {
                    if (!expandedJuicers.has(col)) {
                        const m1 = multipliers[Math.floor(Math.random() * multipliers.length)];
                        const m2 = multipliers[Math.floor(Math.random() * multipliers.length)];
                        const winner = Math.random() > 0.5 ? m1 : m2;
                        expandedJuicers.set(col, winner);
                        
                        juicerDuels.push({ col: col, multi: winner }); 
                    }
                    totalMulti += expandedJuicers.get(col);
                });
                finalWin = baseWin * totalMulti;
            }
            totalWin += finalWin;
        }
    });

    dummyBalance += totalWin;

    res.json({
        grid: grid,
        win: totalWin,
        scatters: scatterCount,
        juicerDuels: juicerDuels,
        newBalance: dummyBalance
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🎰 Chaos Orange Slot läuft auf Port ${PORT}`);
});
