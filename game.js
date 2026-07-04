// Game Variables
let score = 0;
let correctCount = 0;
let totalAnswered = 0;
let lives = 3;
let rhythmInterval = null;
let combo = 0;

// Rhythm state
let currentBeat = 0; // 1 to 8
let isSoundOn = true;
const bpm = 100;
const beatMs = 60000 / bpm; // 600ms per beat

// Equation state
let currentEquation = null;
let choices = []; // [ { val, isCorrect }, { val, isCorrect } ]
let playState = 'REVEALING'; // 'REVEALING', 'AWAITING_INPUT', 'EVALUATED'

// Web Audio API Synthesizer
let audioCtx = null;

function initAudio() {
    if (!audioCtx) {
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.warn("AudioContext not supported:", e);
        }
    }
}

function playSynthSound(freq, type, duration, slideTo) {
    initAudio();
    if (!audioCtx || !isSoundOn) return;
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

    if (slideTo) {
        osc.frequency.exponentialRampToValueAtTime(slideTo, audioCtx.currentTime + duration);
    }

    gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

// Metronome click sounds
function playMetronomeClick(isDownbeat) {
    if (isDownbeat) {
        // High click for Beat 1
        playSynthSound(880, 'sine', 0.04);
    } else if (currentBeat === 5) {
        // High chime for answering phase start
        playSynthSound(587.33, 'triangle', 0.1); // D5
    } else {
        // Standard tick
        playSynthSound(440, 'sine', 0.03);
    }
}

// Feedback sounds
function playSuccessSound() {
    playSynthSound(523.25, 'sine', 0.08, 783.99); // C5 to G5 slide
}

function playFailureSound() {
    playSynthSound(150, 'sawtooth', 0.25, 80);
}

// DOM elements
const gameContainer = document.getElementById('game-container');
const lifeDisplay = document.getElementById('life-display');
const scoreDisplay = document.getElementById('score-display');
const comboDisplay = document.getElementById('combo-display');
const feedback = document.getElementById('feedback');

// Formula Blocks
const blockTerm1 = document.getElementById('formula-term1');
const blockOperator = document.getElementById('formula-operator');
const blockTerm2 = document.getElementById('formula-term2');
const blockEquals = document.getElementById('formula-equals');
const blockResult = document.getElementById('formula-result');

// Buttons
const btnChoiceLeft = document.getElementById('btn-choice-left');
const btnChoiceRight = document.getElementById('btn-choice-right');
const valChoiceLeft = document.getElementById('val-choice-left');
const valChoiceRight = document.getElementById('val-choice-right');
const btnSoundToggle = document.getElementById('btn-sound-toggle');

// Overlay elements
const startOverlay = document.getElementById('start-overlay');
const endOverlay = document.getElementById('end-overlay');
const btnStartGame = document.getElementById('btn-start-game');
const btnRestartGame = document.getElementById('btn-restart-game');
const finalScore = document.getElementById('final-score');
const finalCorrect = document.getElementById('final-correct');
const finalAccuracy = document.getElementById('final-accuracy');

// Shuffles choices
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// Generate random equation
function generateEquation() {
    let left, right, op, result;
    while (true) {
        left = (Math.random() > 0.5 ? 1 : -1) * Math.floor(Math.random() * 4 + 1); // -4 to 4
        right = (Math.random() > 0.5 ? 1 : -1) * Math.floor(Math.random() * 4 + 1); // -4 to 4
        op = Math.random() > 0.5 ? '+' : '-';

        if (op === '+') {
            result = left + right;
        } else {
            result = left - right;
        }

        // Keep results clean and fitting
        if (Math.abs(result) <= 8) {
            break;
        }
    }

    const leftSign = left > 0 ? '＋' : '－';
    const leftSignClass = left > 0 ? 'positive' : 'negative';
    const leftMagnitude = Math.abs(left);

    const rightSign = right > 0 ? '＋' : '－';
    const rightSignClass = right > 0 ? 'positive' : 'negative';
    const rightMagnitude = Math.abs(right);

    const opSign = op === '+' ? '＋' : '－';

    return {
        leftVal: left,
        rightVal: right,
        op: op,
        opSign: opSign,
        result: result,
        term1HTML: `(<span class="sign ${leftSignClass}">${leftSign}</span><span class="digit ${leftSignClass}">${leftMagnitude}</span>)`,
        term2HTML: `(<span class="sign ${rightSignClass}">${rightSign}</span><span class="digit ${rightSignClass}">${rightMagnitude}</span>)`
    };
}

// Generate a distracting incorrect answer by combining term magnitudes
function getConfusingWrongAnswer(left, right, op, correctAns) {
    const L = Math.abs(left);
    const R = Math.abs(right);

    const candidates = new Set();

    // 1. Absolute sum: +(L + R) and -(L + R)
    candidates.add(L + R);
    candidates.add(-(L + R));

    // 2. Absolute difference: +(L - R) and -(L - R)
    candidates.add(Math.abs(L - R));
    candidates.add(-Math.abs(L - R));

    // 3. Opposing correct answer sign
    candidates.add(-correctAns);

    // Filter out correct answer and 0 (unless correct answer is 0)
    const pool = Array.from(candidates).filter(v => v !== correctAns && (v !== 0 || correctAns === 0));

    if (pool.length > 0) {
        const idx = Math.floor(Math.random() * pool.length);
        return pool[idx];
    } else {
        // Fallback offset
        return correctAns > 0 ? -correctAns : 5;
    }
}

// Format choice value to use colored and sized sign tags
function formatChoiceHTML(val) {
    const sign = val > 0 ? '＋' : '－';
    const signClass = val > 0 ? 'positive' : 'negative';
    const magnitude = Math.abs(val);
    return `<span class="sign ${signClass}">${sign}</span><span class="digit ${signClass}">${magnitude}</span>`;
}

// Start Game Session
function startGame() {
    score = 0;
    correctCount = 0;
    totalAnswered = 0;
    lives = 3;
    combo = 0;
    currentBeat = 0;
    gameMode = 'PLAYING';

    scoreDisplay.textContent = '0000';
    comboDisplay.textContent = '0';
    lifeDisplay.textContent = '❤️❤️❤️';

    startOverlay.style.display = 'none';
    endOverlay.style.display = 'none';

    feedback.textContent = 'RHYTHM INITIALIZED. Awaiting beat 1.';
    feedback.className = 'feedback-message neutral';

    // Reset visual nodes
    resetBeatNodes();
    clearFormulaDisplay();

    // Start intervals
    if (rhythmInterval) clearInterval(rhythmInterval);
    rhythmInterval = setInterval(onBeatTick, beatMs);
}

// End Game
function endGame() {
    clearInterval(rhythmInterval);
    gameMode = 'GAME_OVER';

    btnChoiceLeft.disabled = true;
    btnChoiceRight.disabled = true;

    finalScore.textContent = score;
    finalCorrect.textContent = `${correctCount} / ${totalAnswered}`;

    const accuracy = totalAnswered > 0 ? Math.round((correctCount / totalAnswered) * 100) : 0;
    finalAccuracy.textContent = `${accuracy}%`;

    endOverlay.style.display = 'flex';
}

// Clear formula blocks
function clearFormulaDisplay() {
    blockTerm1.innerHTML = '&nbsp;';
    blockOperator.innerHTML = '&nbsp;';
    blockTerm2.innerHTML = '&nbsp;';
    blockEquals.innerHTML = '&nbsp;';
    blockResult.innerHTML = '?';

    blockTerm1.className = 'formula-block';
    blockOperator.className = 'formula-block operator-block';
    blockTerm2.className = 'formula-block';
    blockEquals.className = 'formula-block equals-block';
    blockResult.className = 'formula-block result-block';
}

// Reset beat nodes colors
function resetBeatNodes() {
    for (let i = 1; i <= 8; i++) {
        const node = document.getElementById(`node-${i}`);
        node.className = `beat-node ${i >= 5 ? 'target-node' : ''}`;
    }
}

// Main Beat Tick Loop
function onBeatTick() {
    if (gameMode === 'GAME_OVER') return;

    currentBeat++;
    if (currentBeat > 8) {
        // Before resetting, check if player missed the answer in the previous loop
        if (playState === 'AWAITING_INPUT') {
            handleTimeout();
        }
        currentBeat = 1;
        resetBeatNodes();
    }

    // Play Metronome
    playMetronomeClick(currentBeat === 1);

    // Flash background container slightly on beat
    gameContainer.classList.add('beat-flash');
    setTimeout(() => {
        gameContainer.classList.remove('beat-flash');
    }, 60);

    // Highlight current beat node
    const node = document.getElementById(`node-${currentBeat}`);
    if (node) {
        node.classList.add('active-beat');
    }

    // Phase transitions
    switch (currentBeat) {
        case 1:
            // Generate next formula
            currentEquation = generateEquation();
            clearFormulaDisplay();
            playState = 'REVEALING';

            // Reveal term 1
            blockTerm1.innerHTML = currentEquation.term1HTML;
            blockTerm1.classList.add('visible');

            // Reset buttons
            btnChoiceLeft.classList.remove('selected-success', 'selected-failure');
            btnChoiceRight.classList.remove('selected-success', 'selected-failure');
            btnChoiceLeft.disabled = true;
            btnChoiceRight.disabled = true;
            valChoiceLeft.textContent = '?';
            valChoiceRight.textContent = '?';

            feedback.textContent = '1拍目: 数値展開を開始。';
            feedback.className = 'feedback-message neutral';
            break;

        case 2:
            // Reveal operator
            blockOperator.textContent = currentEquation.opSign;
            blockOperator.classList.add('visible');
            feedback.textContent = '2拍目: 演算ベクトルを検知。';
            break;

        case 3:
            // Reveal term 2
            blockTerm2.innerHTML = currentEquation.term2HTML;
            blockTerm2.classList.add('visible');
            feedback.textContent = '3拍目: 第2項を受信。';
            break;

        case 4:
            // Reveal equals
            blockEquals.textContent = '＝';
            blockEquals.classList.add('visible');
            feedback.textContent = '4拍目: イコライザー同調。解答準備。';
            break;

        case 5:
            // Start input phase
            playState = 'AWAITING_INPUT';

            // Generate choices
            const correctAns = currentEquation.result;
            const wrongAns = getConfusingWrongAnswer(currentEquation.leftVal, currentEquation.rightVal, currentEquation.op, correctAns);

            choices = [
                { val: correctAns, isCorrect: true },
                { val: wrongAns, isCorrect: false }
            ];
            shuffle(choices);

            // Display choices
            valChoiceLeft.innerHTML = formatChoiceHTML(choices[0].val);
            valChoiceRight.innerHTML = formatChoiceHTML(choices[1].val);

            // Enable buttons
            btnChoiceLeft.disabled = false;
            btnChoiceRight.disabled = false;

            feedback.textContent = 'DECISION WINDOW OPEN: Choose the correct result.';
            feedback.className = 'feedback-message selected-state';
            break;

        default:
            // Beats 6, 7, 8: Await answer or show evaluation
            break;
    }
}

// User makes a choice
function makeChoice(side) {
    if (playState !== 'AWAITING_INPUT') return;

    playState = 'EVALUATED';
    totalAnswered++;

    // Disable choices
    btnChoiceLeft.disabled = true;
    btnChoiceRight.disabled = true;

    const choiceIdx = side === 'left' ? 0 : 1;
    const isCorrect = choices[choiceIdx].isCorrect;

    // Visual Node check
    const activeNode = document.getElementById(`node-${currentBeat}`);

    if (isCorrect) {
        correctCount++;
        combo++;
        comboDisplay.textContent = combo;

        // Score allocation
        const points = 100 + Math.min(combo * 10, 100);
        score += points;
        scoreDisplay.textContent = score.toString().padStart(4, '0');

        playSuccessSound();

        // Button highlight
        if (side === 'left') {
            btnChoiceLeft.classList.add('selected-success');
        } else {
            btnChoiceRight.classList.add('selected-success');
        }

        // Node coloring
        if (activeNode) {
            activeNode.classList.add('status-success');
        }

        blockResult.textContent = currentEquation.result > 0 ? `+${currentEquation.result}` : currentEquation.result;
        blockResult.className = 'formula-block result-block visible evaluated';

        gameContainer.classList.add('success-flash');
        setTimeout(() => gameContainer.classList.remove('success-flash'), 250);

        feedback.textContent = `SUCCESS! (+${points} pts)`;
        feedback.className = 'feedback-message success';

    } else {
        combo = 0;
        comboDisplay.textContent = '0';
        lives--;
        lifeDisplay.textContent = '❤️'.repeat(lives) || 'DEAD';

        playFailureSound();

        // Button highlight
        if (side === 'left') {
            btnChoiceLeft.classList.add('selected-failure');
        } else {
            btnChoiceRight.classList.add('selected-failure');
        }

        // Highlight correct option as outline
        if (choices[0].isCorrect) {
            btnChoiceLeft.classList.add('selected-success');
        } else {
            btnChoiceRight.classList.add('selected-success');
        }

        if (activeNode) {
            activeNode.classList.add('status-failure');
        }

        blockResult.textContent = currentEquation.result > 0 ? `+${currentEquation.result}` : currentEquation.result;
        blockResult.className = 'formula-block result-block visible incorrect';

        gameContainer.classList.add('error-flash');
        setTimeout(() => gameContainer.classList.remove('error-flash'), 250);

        feedback.textContent = `ERROR: Correct answer is ${currentEquation.result}`;
        feedback.className = 'feedback-message error';

        if (lives <= 0) {
            setTimeout(endGame, 600);
        }
    }
}

// Timeout handler (end of Beat 8)
function handleTimeout() {
    playState = 'EVALUATED';
    totalAnswered++;
    combo = 0;
    comboDisplay.textContent = '0';
    lives--;
    lifeDisplay.textContent = '❤️'.repeat(lives) || 'DEAD';

    btnChoiceLeft.disabled = true;
    btnChoiceRight.disabled = true;

    playFailureSound();

    // Mark Node 8 as failure
    const node8 = document.getElementById('node-8');
    if (node8) {
        node8.classList.add('status-failure');
    }

    blockResult.textContent = currentEquation.result > 0 ? `+${currentEquation.result}` : currentEquation.result;
    blockResult.className = 'formula-block result-block visible incorrect';

    gameContainer.classList.add('error-flash');
    setTimeout(() => gameContainer.classList.remove('error-flash'), 250);

    feedback.textContent = `TIME OVER: Correct answer is ${currentEquation.result}`;
    feedback.className = 'feedback-message error';

    if (lives <= 0) {
        setTimeout(endGame, 600);
    }
}

// Event Listeners
btnChoiceLeft.addEventListener('click', () => makeChoice('left'));
btnChoiceRight.addEventListener('click', () => makeChoice('right'));

btnStartGame.addEventListener('click', startGame);
btnRestartGame.addEventListener('click', startGame);

btnSoundToggle.addEventListener('click', () => {
    isSoundOn = !isSoundOn;
    btnSoundToggle.textContent = `SOUND: ${isSoundOn ? 'ON' : 'OFF'}`;
});

// Keyboard binds
window.addEventListener('keydown', (e) => {
    if (gameMode === 'START_SCREEN') {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            startGame();
        }
        return;
    }

    if (gameMode === 'GAME_OVER') {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            startGame();
        }
        return;
    }

    if (gameMode === 'PLAYING' && playState === 'AWAITING_INPUT') {
        if (e.key === 'a' || e.key === 'ArrowLeft') {
            e.preventDefault();
            makeChoice('left');
        } else if (e.key === 'd' || e.key === 'ArrowRight') {
            e.preventDefault();
            makeChoice('right');
        }
    }
});
