// --- PROVERA KONEKCIJE ---
console.log("script.js je uspešno učitan!");

const supabaseUrl = 'https://zeqzrziiligsmrqxonhj.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InplcXpyemlpbGlnc21ycXhvbmhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyNzA5MDksImV4cCI6MjA4NDg0NjkwOX0.p8utaac5OVzLUjNkhl3tdwUda0zZW34kQjFvyZVOE0s'; 
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

let html5QrCode = null;
let currentScore = 0;
let scannedReceiptId = "";

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

// --- SKENER FUNKCIJA (OVO TI JE FALILO) ---
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
            { fps: 20, qrbox: 250 }, 
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
    
    if (!decodedText.includes("102778428")) {
        alert("Nevažeći račun!");
        return;
    }

    scannedReceiptId = new URLSearchParams(decodedText.split('?')[1]).get('vl') || decodedText.slice(-30);
    
    // 1. Provera da li je već iskorišćen
    const { data: existing } = await _supabase
        .from('scanned_receipts')
        .select('receipt_id')
        .eq('receipt_id', scannedReceiptId)
        .maybeSingle();
    
    if (existing) {
        alert("Ovaj račun je već iskorišćen!");
        return;
    }

    // --- NOVO: ODMAH OZNAČI KAO ISKORIŠĆENO ---
    // Upisujemo samo ID računa, bez emaila (jer se korisnik još nije ulogovao)
    const { error: insertError } = await _supabase
        .from('scanned_receipts')
        .insert([{ receipt_id: scannedReceiptId, scanned_by: "IN_PROGRESS" }]);

    if (insertError) {
        console.error("Greška pri zaključavanju računa:", insertError);
        alert("Sistemska greška pri validaciji računa.");
        return;
    }
    // ------------------------------------------

    if (html5QrCode) await html5QrCode.stop();
    navigate('page-game');
    loadUnityGame();
}

// --- UNITY ---
function loadUnityGame() {
    console.log("Pokrećem Unity instancu...");
    const canvas = document.querySelector("#unity-canvas");
    const loadingBar = document.getElementById("unity-loading-bar");

    const config = {
        dataUrl: "build/igra.data",
        frameworkUrl: "build/igra.framework.js",
        codeUrl: "build/igra.wasm",
        streamingAssetsUrl: "StreamingAssets",
        companyName: "DefaultCompany",
        productName: "GigatronGame",
        productVersion: "1.0",
        decompressionFallback: true,
        devicePixelRatio: Math.min(window.devicePixelRatio, 2),
        // DODAJ OVU LINIJU ISPOD:
        matchWebGLToCanvasSize: true, 
    };

    const loaderScript = document.createElement("script");
    loaderScript.src = "build/igra.loader.js"; 
    loaderScript.onload = () => {
        createUnityInstance(canvas, config, (progress) => {
            const bar = document.getElementById("unity-progress-bar-full");
            if (bar) bar.style.width = (100 * progress) + "%";
        }).then((instance) => {
            console.log("Unity spreman!");
            if (loadingBar) loadingBar.style.display = "none";
        });
    };
    document.body.appendChild(loaderScript);
}

// Poziva Unity
window.SendScoreToDatabase = function(score) {
    currentScore = score;
    document.getElementById('game-over-box').classList.remove('hidden');
    document.getElementById('final-score-display').innerText = score;
};

// --- ČUVANJE U BAZU ---
async function handleAuth() {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const msg = document.getElementById('auth-msg');

    if (!email || !password) {
        alert("Molimo unesite email i lozinku!");
        return;
    }

    msg.innerText = "Slanje podataka...";
    msg.style.color = "var(--yellow)";

    try {
        // 1. Auth (SignUp)
        const { data: authData, error: authError } = await _supabase.auth.signUp({
            email: email,
            password: password,
        });
        if (authError) throw authError;

        // 2. Čuvanje u Leaderboard
        const { error: lbError } = await _supabase.from('leaderboard').upsert({ 
            email: email, 
            points: currentScore, 
            last_scan_date: new Date().toISOString() 
        }, { onConflict: 'email' });
        if (lbError) throw lbError;

        // --- NOVO: DODAJ EMAIL U VEĆ POSTOJEĆI ZAPIS RAČUNA ---
        await _supabase
            .from('scanned_receipts')
            .update({ scanned_by: email })
            .eq('receipt_id', scannedReceiptId);
        // ---------------------------------------------------

        msg.innerText = "Rezultat sačuvan! Učitavam rang listu...";
        msg.style.color = "var(--green)";
        
        setTimeout(async () => {
            await showLeaderboard();
            navigate('page-leaderboard');
        }, 2000);

    } catch (err) {
        console.error("Greška:", err);
        msg.innerText = "Greška: " + err.message;
        msg.style.color = "var(--red)";
    }
}

const container = document.getElementById("unity-container");
const canvas = document.getElementById("unity-canvas");

function resizeUnityCanvas() {
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
}

window.addEventListener("resize", resizeUnityCanvas);
resizeUnityCanvas();
// --- PRIKAZ RANG LISTE ---
async function showLeaderboard() {
    console.log("Osvežavam rang listu...");
    const lbBody = document.getElementById('lb-body');
    if (!lbBody) return;

    lbBody.innerHTML = '<tr><td colspan="3">Učitavanje...</td></tr>';

    try {
        const { data, error } = await _supabase
            .from('leaderboard')
            .select('email, points')
            .order('points', { ascending: false })
            .limit(10);

        if (error) throw error;

        if (!data || data.length === 0) {
            lbBody.innerHTML = '<tr><td colspan="3">Nema rezultata.</td></tr>';
            return;
        }

        lbBody.innerHTML = data.map((user, index) => `
            <tr>
                <td>${index + 1}.</td>
                <td>${user.email.split('@')[0]}</td>
                <td style="color: var(--yellow); font-weight: bold;">${user.points}</td>
            </tr>
        `).join('');

    } catch (err) {
        console.error("Greška pri učitavanju tabele:", err);
        lbBody.innerHTML = '<tr><td colspan="3">Greška pri učitavanju.</td></tr>';
    }
}



