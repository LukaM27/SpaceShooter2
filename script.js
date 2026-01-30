const supabaseUrl = 'https://zeqzrziiligsmrqxonhj.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InplcXpyemlpbGlnc21ycXhvbmhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyNzA5MDksImV4cCI6MjA4NDg0NjkwOX0.p8utaac5OVzLUjNkhl3tdwUda0zZW34kQjFvyZVOE0s'; 
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

let html5QrCode;
let currentScore = 0;
let scannedReceiptId = "";
let unityInstance = null;

function navigate(id) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

async function startScanner() {
    // DODAJ OVE DVE LINIJE DA TESTIRAŠ ODMAH
    navigate('page-game'); 
    loadUnityGame();

    try {
        html5QrCode = new Html5Qrcode("reader");
        await html5QrCode.start({ facingMode: "environment" }, { fps: 20, qrbox: 250 }, onScanSuccess);
    } catch (err) {
        alert("Kamera ne može da se pokrene. Proveri dozvole.");
    }
}

async function onScanSuccess(decodedText) {
    if (!decodedText.includes("102778428")) { 
        alert("Ovo nije Gigatron račun!"); 
        return; 
    }
    scannedReceiptId = new URLSearchParams(decodedText.split('?')[1]).get('vl') || decodedText.slice(-30);
    const { data: existing } = await _supabase.from('scanned_receipts').select('receipt_id').eq('receipt_id', scannedReceiptId).maybeSingle();
    if (existing) { 
        alert("Račun je već iskorišćen!"); 
        return; 
    }

    if (html5QrCode) await html5QrCode.stop();
    navigate('page-game');
    loadUnityGame();
}

function loadUnityGame() {
    const canvas = document.querySelector("#unity-canvas");
    const loadingBar = document.querySelector("#unity-loading-bar");
    const progressBar = document.querySelector("#unity-progress-bar-full");

    // VAŽNO: Koristimo tačan naziv tvojih fajlova
    // Izmeni ovu liniju da bude tačno ovako:
const gameName = "igra"; 

// I proveri da li ti putanje ispod izgledaju ovako:
const config = {
    dataUrl: "Build/" + gameName + ".data",
    frameworkUrl: "Build/" + gameName + ".framework.js",
    codeUrl: "Build/" + gameName + ".wasm",
    streamingAssetsUrl: "StreamingAssets",
    companyName: "DefaultCompany",
    productName: "GigatronGame",
    productVersion: "1.0",
};

    const loaderScript = document.createElement("script");
    loaderScript.src = "Build/" + gameName + ".loader.js"; 
    
    loaderScript.onload = () => {
        createUnityInstance(canvas, config, (progress) => {
            progressBar.style.width = (100 * progress) + "%";
        }).then((instance) => {
            unityInstance = instance;
            loadingBar.style.display = "none";
        }).catch((err) => {
            console.error("Unity Error:", err);
            alert("Greška: Proveri da li se fajlovi u Build folderu zovu baš: " + gameName);
        });
    };
    document.body.appendChild(loaderScript);
}

window.dispatchUnityScore = function(score) {
    currentScore = score;
    document.getElementById('game-over-box').classList.remove('hidden');
    document.getElementById('final-score-display').innerText = score;
    if (typeof confetti === 'function') {
        confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
    }
};

async function handleAuth() {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const msg = document.getElementById('auth-msg');

    if (!email || !password) { alert("Popuni sva polja!"); return; }
    msg.innerText = "Čuvanje...";
    
    let { data, error } = await _supabase.auth.signInWithPassword({ email, password });
    if (error) { const res = await _supabase.auth.signUp({ email, password }); data = res.data; error = res.error; }

    if (error) { msg.innerText = "Greška: " + error.message; return; }

    const { data: userRow } = await _supabase.from('leaderboard').select('points').eq('email', email).maybeSingle();
    const newTotal = (userRow?.points || 0) + currentScore;

    await _supabase.from('leaderboard').upsert({ email, points: newTotal, last_scan_date: new Date().toISOString() });
    await _supabase.from('scanned_receipts').insert([{ receipt_id: scannedReceiptId, scanned_by: email }]);

    showLeaderboard();
}

async function showLeaderboard() {
    navigate('page-leaderboard');
    const { data } = await _supabase.from('leaderboard').select('email, points').order('points', { ascending: false }).limit(10);
    document.getElementById('lb-body').innerHTML = data.map((u, i) => `<tr><td>${i+1}.</td><td>${u.email.split('@')[0]}***</td><td>${u.points}</td></tr>`).join('');
}