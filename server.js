const express = require('express');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
app.use(express.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Optional: DB Anbindung (falls du eine nutzt)
const MONGO_URL = process.env.MONGO_URL || ''; 
if (MONGO_URL) {
    mongoose.connect(MONGO_URL).then(() => console.log('✅ Mit MongoDB verbunden!')).catch(err => console.error('❌ MongoDB Fehler:', err));
}

// ==========================================
// CHAOS ORANGE: CASCADE ENGINE
// ==========================================
const COLS = 6;
const ROWS = 5;

// Scatter Pays (8-9, 10-11, 12+), Weights bestimmen Seltenheit
const symbols = [
    { name: 'ORANGE',  pays: [10, 25, 50], weight: 10 },
    { name: 'ROLEX',   pays: [2.5, 10, 25], weight: 20 },
    { name: 'CASH',    pays: [2, 5, 15], weight: 30 },
    { name: 'ENERGY',  pays: [1.5, 2, 10], weight: 40 },
    { name: 'A',       pays: [1, 1.5, 5], weight: 60 },
    { name: 'K',       pays: [0.8, 1.2, 4], weight: 70 },
    { name: 'Q',       pays: [0.5, 1, 3], weight: 80 },
    { name: 'J',       pays: [0.4, 0.9, 2], weight: 90 },
    { name: 'BOMB',    weight: 8, isMulti: true }, 
    { name: 'SCATTER', weight: 6, isScatter: true } 
];

const bombMultis = [2, 3, 4, 5, 8, 10, 15, 20, 25, 50, 100, 250, 500];

// Session State (Fake-DB)
let gameState = {
    mode: 'BASE',
    freeSpinsLeft: 0,
    totalBonusWin: 0,
    globalMultiplier: 0
};
let dummyBalance = 1000;

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
    for(let c = 0; c < COLS; c++) {
        let col = [];
        for(let r = 0; r < ROWS; r++) col.push(getRandomSymbol());
        grid.push(col);
    }
    return grid;
}

function evaluateGrid(grid) {
    let counts = {};
    let positions = {};
    
    for(let c = 0; c < COLS; c++) {
        for(let r = 0; r < ROWS; r++) {
            let sym = grid[c][r].name;
            if(sym !== 'SCATTER' && sym !== 'BOMB') {
                counts[sym] = (counts[sym] || 0) + 1;
                if(!positions[sym]) positions[sym] = [];
                positions[sym].push({c, r});
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
    for(let c = 0; c < COLS; c++) {
        let newCol = [];
        // Überlebende Symbole nach unten fallen lassen
        for(let r = ROWS - 1; r >= 0; r--) {
            if(!symbolsToRemove.some(pos => pos.c === c && pos.r === r)) {
                newCol.unshift(grid[c][r]); 
            }
        }
        // Leere Stellen oben mit neuen auffüllen
        while(newCol.length < ROWS) newCol.unshift(getRandomSymbol());
        newGrid.push(newCol);
    }
    return newGrid;
}

app.get('/', (req, res) => res.render('slot', { user: { balance: dummyBalance } }));

app.post('/api/spin', (req, res) => {
    const isBonusBuy = req.body.buyFeature === true;
    let betAmount = 1;
    let cost = isBonusBuy ? betAmount * 100 : betAmount;

    if (gameState.mode === 'BASE' && dummyBalance < cost) return res.json({ error: "BROKE!" });
    if (gameState.mode === 'BASE') dummyBalance -= cost;

    if (isBonusBuy && gameState.mode === 'BASE') {
        gameState.mode = 'FREE_SPINS';
        gameState.freeSpinsLeft = 15;
        gameState.globalMultiplier = 0;
        gameState.totalBonusWin = 0;
    }

    let grid = generateGrid();
    
    // Feature Buy = Garantiert 4 Scatter
    if(isBonusBuy) {
        let scCols = [0,1,2,3,4,5].sort(()=>0.5-Math.random()).slice(0,4);
        scCols.forEach(c => grid[c][Math.floor(Math.random()*ROWS)] = {name: 'SCATTER'});
    }

    let cascades = [];
    let cascadeActive = true;
    let totalBaseWin = 0;
    let stepCount = 0;

    let initialScatters = 0;
    for(let c=0; c<COLS; c++) for(let r=0; r<ROWS; r++) if(grid[c][r].name === 'SCATTER') initialScatters++;

    // Kaskaden-Schleife (bis keine Gewinne mehr)
    while(cascadeActive && stepCount < 20) {
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

    // Bomben Multiplikatoren am Ende addieren
    let finalGrid = cascades[cascades.length - 1].grid;
    let stepBombs = [];
    let totalBombMulti = 0;

    for(let c=0; c<COLS; c++) {
        for(let r=0; r<ROWS; r++) {
            if(finalGrid[c][r].name === 'BOMB') {
                stepBombs.push({c, r, multi: finalGrid[c][r].multi});
                totalBombMulti += finalGrid[c][r].multi;
            }
        }
    }

    let finalSpinWin = totalBaseWin;
    
    // Multipliziere, wenn es einen Gewinn GAB
    if (totalBaseWin > 0) {
        if (gameState.mode === 'FREE_SPINS') {
            if (totalBombMulti > 0) gameState.globalMultiplier += totalBombMulti;
            if (gameState.globalMultiplier > 0) finalSpinWin = totalBaseWin * gameState.globalMultiplier;
        } else {
            if (totalBombMulti > 0) finalSpinWin = totalBaseWin * totalBombMulti;
        }
    }

    dummyBalance += finalSpinWin;
    if (gameState.mode === 'FREE_SPINS') gameState.totalBonusWin += finalSpinWin;

    let triggeredBonus = false;
    if (gameState.mode === 'BASE' && initialScatters >= 4) {
        gameState.mode = 'FREE_SPINS';
        gameState.freeSpinsLeft = 15;
        gameState.globalMultiplier = 0;
        gameState.totalBonusWin = 0;
        triggeredBonus = true;
    }

    if (gameState.mode === 'FREE_SPINS' && initialScatters >= 3 && !triggeredBonus && !isBonusBuy) {
        gameState.freeSpinsLeft += 5;
    }

    let nextAction = 'SPIN';
    if (gameState.mode === 'FREE_SPINS' && !triggeredBonus && !isBonusBuy) {
        gameState.freeSpinsLeft--;
        if (gameState.freeSpinsLeft <= 0) {
            nextAction = 'END_BONUS';
            gameState.mode = 'BASE';
        }
    }

    res.json({
        cascades: cascades,
        bombs: stepBombs,
        totalBaseWin: totalBaseWin,
        finalSpinWin: finalSpinWin,
        newBalance: dummyBalance,
        bonusTriggered: triggeredBonus,
        spinsLeft: gameState.freeSpinsLeft,
        globalMultiplier: gameState.globalMultiplier,
        totalBonusWin: gameState.totalBonusWin,
        nextAction: nextAction
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🍊 CHAOS CASCADES laufen auf Port ${PORT}`));
