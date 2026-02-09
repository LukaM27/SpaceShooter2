// --- PROVERA KONEKCIJE ---
console.log("script.js je uspešno učitan!");

const supabaseUrl = 'https://zeqzrziiligsmrqxonhj.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InplcXpyemlpbGlnc21ycXhvbmhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyNzA5MDksImV4cCI6MjA4NDg0NjkwOX0.p8utaac5OVzLUjNkhl3tdwUda0zZW34kQjFvyZVOE0s'; 
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

let html5QrCode = null;
let currentScore = 0;
let scannedReceiptId = "";
let unityInstance = null; // Čuvamo instancu globalno

// --- OSNOVNA NAVIGACIJA ---
function navigate(id) {
    console.log("Navigacija na:", id);
    const pages = document.querySelectorAll('.page');
    pages.forEach(p => p.classList.remove('active'));
    const target = document.getElementById(id);
    if (target) {
        target.classList.add('active');
    } else {
        console.error("Strana nije pronađena: " + id);
    }
}

// --- MODAL INFO (Funkcija koja ti je falila u html-u) ---
function toggleUserInfo() {
    // Ako hoćeš onaj popup sa podacima korisnika
    alert("Gigatron Scan2Win v1.0\nSkeniraj račun i osvoji poene!");
}

// --- SKENER FUNKCIJA ---
async function startScanner() {
    console.log("Funkcija startScanner je pozvana!");
    const status = document.getElementById('scan-status');
    
    try {
        if (html5QrCode) {
            await html5QrCode.stop().catch(() => {});
        }
        
        html5QrCode = new Html5Qrcode("reader");
        
        await html5QrCode.start(
            { facingMode: "environment" }, 
            { 
                fps: 20, 
                qrbox: { width: 250, height: 250 },
                aspectRatio: 1.0 
            }, 
            onScanSuccess
        );
        
        status.innerText = "Skenirajte Gigatron račun...";
    } catch (err) {
        console.error("Kamera error:", err);
        alert("Dozvolite pristup kameri!");
    }
}

async function onScanSuccess(decodedText) {
    console.log("Skenirano:", decodedText);
    
    // Provera da li je račun Gigatron (tvoj specifičan kod)
    if (!decodedText.includes("102778428")) {
        const readerBox = document.getElementById('reader-container');
        readerBox.classList.add('error-shake');
        setTimeout(() => readerBox.classList.remove('error-shake'), 400);
        alert("Nevažeći račun! Molimo skenirajte originalni Gigatron fiskalni račun.");
        return;
    }

    // Izvlačenje ID-a računa
    scannedReceiptId = new URLSearchParams(decodedText.split('?')[1]).get('vl') || decodedText.slice(-30);
    
    // Provera duplikata u bazi
    const { data: existing, error: checkError } = await _supabase
        .from('scanned_receipts')
        .select('receipt_id')
        .eq('receipt_id', scannedReceiptId)
        .maybeSingle();
    
    if (existing) {
        alert("Ovaj račun je već jednom iskorišćen za igru!");
        return;
    }

    // Ako je sve OK, gasi skener i pali igru
    if (html5QrCode) {
        await html5QrCode.stop();
    }
    navigate('page-game');
    loadUnityGame();
}

// --- UNITY LOGIKA (FIXED ZA RESPONSIVE) ---
function loadUnityGame() {
    console.log("Pokrećem Unity instancu...");
    const canvas = document.querySelector("#unity-canvas");
    const loadingBar = document.getElementById("unity-loading-bar");
    const progressBarFull = document.getElementById("unity-progress-bar-full");

    const config = {
        dataUrl: "build/igra.data",
        frameworkUrl: "build/igra.framework.js",
        codeUrl: "build/igra.wasm",
        streamingAssetsUrl: "StreamingAssets",
        companyName: "DefaultCompany",
        productName: "GigatronGame",
        productVersion: "1.0",
        decompressionFallback: true,
        devicePixelRatio: Math.min(window.devicePixelRatio, 2), // Optimizacija za mobile
    };

    const loaderScript = document.createElement("script");
    loaderScript.src = "build/igra.loader.js"; 
    
    loaderScript.onload = () => {
        createUnityInstance(canvas, config, (progress) => {
            if (progressBarFull) {
                progressBarFull.style.width = (100 * progress) + "%";
            }
        }).then((instance) => {
            unityInstance = instance;
            console.log("Unity je spreman i učitan!");
            if (loadingBar) {
                loadingBar.style.display = "none";
            }
        }).catch((err) => {
            console.error("Unity Load Error:", err);
            alert("Došlo je do greške pri učitavanju igre.");
        });
    };
    
    document.body.appendChild(loaderScript);
}

// --- KOMUNIKACIJA UNITY -> JS ---
window.SendScoreToDatabase = function(score) {
    console.log("Rezultat primljen iz Unity-ja:", score);
    currentScore = score;
    
    // Update UI elemenata
    const scoreDisplay = document.getElementById('js-score');
    const finalScoreDisplay = document.getElementById('final-score-display');
    const gameOverBox = document.getElementById('game-over-box');
    
    if (scoreDisplay) scoreDisplay.innerText = score;
    if (finalScoreDisplay) finalScoreDisplay.innerText = score;
    if (gameOverBox) gameOverBox.classList.remove('hidden');
    
    // Efekat konfeta (ako si ostavio biblioteku u head-u)
    if (typeof confetti === 'function' && score > 0) {
        confetti({
            particleCount: 150,
            spread: 70,
            origin: { y: 0.6 },
            colors: ['#FFD700', '#ffffff', '#ff0000']
        });
    }
};

// --- ČUVANJE U BAZU (SUPABASE) ---
async function handleAuth() {
    const emailInput = document.getElementById('auth-email');
    const msg = document.getElementById('auth-msg');
    const email = emailInput.value.trim();

    if (!email || !email.includes('@')) {
        alert("Molimo unesite ispravnu email adresu!");
        return;
    }
    
    msg.innerText = "Čuvanje rezultata u toku...";
    msg.style.color = "var(--yellow)";

    try {
        // 1. Upis u Leaderboard (Upsert na osnovu emaila)
        const { error: lbError } = await _supabase
            .from('leaderboard')
            .upsert({ 
                email: email, 
                points: currentScore, 
                last_scan_date: new Date().toISOString() 
            }, { onConflict: 'email' });

        if (lbError) throw lbError;

        // 2. Markiranje računa kao iskorišćenog
        const { error: receiptError } = await _supabase
            .from('scanned_receipts')
            .insert([{ 
                receipt_id: scannedReceiptId, 
                scanned_by: email 
            }]);

        if (receiptError) throw receiptError;

        msg.style.color = "var(--green)";
        msg.innerText = "Uspešno sačuvano! Rang lista se učitava...";
        
        setTimeout(() => {
            location.reload(); // Osvežavamo sve za novu igru
        }, 2500);

    } catch (err) {
        console.error("Database error:", err);
        msg.style.color = "var(--red)";
        msg.innerText = "Greška: " + err.message;
    }
}

// --- RESIZE LOGIKA ZA CANVAS ---
// Iako CSS radi 90% posla, ovo osigurava da Unity zna dimenzije
function resizeUnityCanvas() {
    const container = document.getElementById("unity-container");
    const canvas = document.getElementById("unity-canvas");
    if (container && canvas && unityInstance) {
        // Opciono: ovde možeš dodati specifičnu logiku ako Unity ne sluša CSS
    }
}

window.addEventListener("resize", resizeUnityCanvas);
