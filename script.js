console.log("script.js je uspešno učitan!");

const supabaseUrl = 'https://zeqzrziiligsmrqxonhj.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InplcXpyemlpbGlnc21ycXhvbmhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyNzA5MDksImV4cCI6MjA4NDg0NjkwOX0.p8utaac5OVzLUjNkhl3tdwUda0zZW34kQjFvyZVOE0s'; 
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

let html5QrCode = null;
let currentScore = 0;
let scannedReceiptId = "";
let isProcessingScan = false; 
let unityInstance = null;

// --- NAVIGACIJA ---
function navigate(id) {
    console.log("Navigacija na:", id);
    const pages = document.querySelectorAll('.page');
    pages.forEach(p => p.classList.remove('active'));

    const unityCont = document.getElementById('unity-container');
    if (unityCont) {
        unityCont.style.display = (id === 'page-game') ? 'block' : 'none';
    }

    const target = document.getElementById(id);
    if (target) {
        target.classList.add('active');
    } else {
        console.error("Strana nije pronađena: " + id);
    }
}

// --- SKENER LOGIKA ---
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
    if (isProcessingScan) return; 
    
    console.log("Skenirano:", decodedText);
    const status = document.getElementById('scan-status');

    // 1. Osnovna provera domena Poreske uprave
    if (!decodedText.startsWith("https://tap.sfr.urs.gov.rs")) {
        alert("Nevažeći kod. Skenirajte isključivo originalni QR kod sa fiskalnog računa.");
        return;
    }

    isProcessingScan = true;
    status.innerText = "Verifikacija računa (Edge Function)...";

    try {
        // 2. POZIV SUPABASE EDGE FUNKCIJE
        const { data: edgeData, error: edgeError } = await _supabase.functions.invoke('verify-receipt', {
            body: { receiptUrl: decodedText }
        });

        if (edgeError || !edgeData || edgeData.valid === false) {
            alert("Poreska uprava ne prepoznaje ovaj račun ili je falsifikovan!");
            isProcessingScan = false;
            status.innerText = "Skeniranje neuspešno.";
            return;
        }

        // 3. Izvlačenje parametara (PIB, Iznos, Datum)
        const urlParams = new URL(decodedText);
        const pib = urlParams.searchParams.get("pib");
        const dt = urlParams.searchParams.get("dt"); 
        const iznos = parseFloat(urlParams.searchParams.get("as"));

        // Provera da li je Gigatron (PIB: 102778428)
        if (pib !== "102778428") {
            alert("Ovo je ispravan račun, ali nije iz Gigatrona!");
            isProcessingScan = false;
            return;
        }

        // --- NOVO: PROVERA DATUMA (10.02.2026 - 31.12.2026) ---
        const godina = parseInt(dt.substring(0, 4));
        const mesec = parseInt(dt.substring(4, 6)) - 1; // JS meseci idu od 0-11
        const dan = parseInt(dt.substring(6, 8));
        const datumRacuna = new Date(godina, mesec, dan);

        const pocetakKonkursa = new Date(2026, 1, 10); // 10.02.2026.
        const krajKonkursa = new Date(2026, 11, 31, 23, 59, 59); // 31.12.2026.

        if (datumRacuna < pocetakKonkursa) {
            alert("Račun je izdat pre početka konkursa (10.02.2026).");
            isProcessingScan = false;
            return;
        }

        if (datumRacuna > krajKonkursa) {
            alert("Račun je izvan perioda trajanja konkursa.");
            isProcessingScan = false;
            return;
        }

        // Provera iznosa
        if (isNaN(iznos) || iznos < 3000) {
            alert(`Minimalni iznos je 3000 RSD. Vaš račun: ${iznos || 0} RSD.`);
            isProcessingScan = false;
            return;
        }

        // 4. Provera duplikata u bazi
        scannedReceiptId = urlParams.searchParams.get('vl') || decodedText.slice(-30);
        
        const { data: existing } = await _supabase
            .from('scanned_receipts')
            .select('receipt_id')
            .eq('receipt_id', scannedReceiptId)
            .maybeSingle();
        
        if (existing) {
            alert("Ovaj račun je već iskorišćen!");
            isProcessingScan = false;
            return;
        }

        // 5. Upis u bazu pod statusom "U TOKU"
        const { error: insertError } = await _supabase
            .from('scanned_receipts')
            .insert([{ receipt_id: scannedReceiptId, scanned_by: "IN_PROGRESS" }]);

        if (insertError) throw insertError;

        // Kraj skeniranja, prelazak na igru
        if (html5QrCode) await html5QrCode.stop().catch(() => {});
        
        status.innerText = "Račun potvrđen! Srećno!";
        navigate('page-game');
        loadUnityGame();

    } catch (err) {
        console.error("Greška pri verifikaciji:", err);
        alert("Sistem za verifikaciju trenutno nije dostupan.");
        isProcessingScan = false;
    }
}

// --- UNITY LOGIKA ---
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
        matchWebGLToCanvasSize: true, 
    };

    const loaderScript = document.createElement("script");
    loaderScript.src = "build/igra.loader.js"; 
    loaderScript.onload = () => {
        createUnityInstance(canvas, config, (progress) => {
            const bar = document.getElementById("unity-progress-bar-full");
            if (bar) bar.style.width = (100 * progress) + "%";
        }).then((instance) => {
            unityInstance = instance;
            console.log("Unity spreman!");
            if (loadingBar) loadingBar.style.display = "none";
        });
    };
    document.body.appendChild(loaderScript);
}

window.SendScoreToDatabase = function(score) {
    currentScore = score;
    document.getElementById('game-over-box').classList.remove('hidden');
    document.getElementById('final-score-display').innerText = score;
};

// --- AUTH I ČUVANJE BODOVA ---
async function handleAuth() {
    const emailField = document.getElementById('auth-email');
    const passwordField = document.getElementById('auth-password');
    const email = emailField.value.trim().toLowerCase();
    const password = passwordField.value;
    const msg = document.getElementById('auth-msg');

    if (!email || password.length < 6) {
        alert("Email je obavezan, a lozinka mora imati bar 6 karaktera!");
        return;
    }

    msg.innerText = "Provera naloga...";

    try {
        const { data: signInData, error: signInError } = await _supabase.auth.signInWithPassword({
            email: email,
            password: password,
        });

        if (!signInError) {
            await saveScore(email, msg);
            return;
        }

        const { data: signUpData, error: signUpError } = await _supabase.auth.signUp({
            email: email,
            password: password,
        });

        if (signUpError) throw signUpError;

        if (signUpData.session) {
            await saveScore(email, msg);
        } else {
            localStorage.setItem('pending_points', currentScore);
            localStorage.setItem('pending_receipt', scannedReceiptId);
            msg.innerText = "Potvrdite email da biste sačuvali bodove!";
        }

    } catch (err) {
        msg.innerText = err.message;
        msg.style.color = "red";
    }
}

async function saveScore(email, msg) {
    try {
        const { data: scoreData } = await _supabase
            .from('leaderboard')
            .select('points')
            .eq('email', email)
            .maybeSingle();

        let totalPoints = currentScore + (scoreData ? scoreData.points : 0);

        await _supabase.from('leaderboard').upsert({ 
            email: email, 
            points: totalPoints, 
            last_scan_date: new Date().toISOString() 
        });

        await _supabase.from('scanned_receipts')
            .update({ scanned_by: email })
            .eq('receipt_id', scannedReceiptId);

        msg.innerText = "Poeni sačuvani!";
        msg.style.color = "green";
        
        setTimeout(async () => {
            await showLeaderboard();
            navigate('page-leaderboard');
        }, 1500);

    } catch (e) {
        msg.innerText = "Greška pri čuvanju.";
    }
}

async function showLeaderboard() {
    const lbBody = document.getElementById('lb-body');
    if (!lbBody) return;
    try {
        const { data, error } = await _supabase
            .from('leaderboard')
            .select('email, points')
            .order('points', { ascending: false })
            .limit(10);

        if (error) throw error;
        lbBody.innerHTML = data.map((user, index) => `
            <tr>
                <td>${index + 1}.</td>
                <td>${user.email.split('@')[0]}</td>
                <td style="color: var(--yellow); font-weight: bold;">${user.points}</td>
            </tr>
        `).join('');
    } catch (err) {
        lbBody.innerHTML = '<tr><td>Greška.</td></tr>';
    }
}

// --- DODATNI EVENTI ---
window.addEventListener('load', async () => {
    await showLeaderboard();
});

async function handleLogout() {
    await _supabase.auth.signOut();
    window.location.reload();
}
