// --- PROVERA KONEKCIJE ---
console.log("script.js je uspešno učitan!");

const supabaseUrl = 'https://zeqzrziiligsmrqxonhj.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InplcXpyemlpbGlnc21ycXhvbmhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyNzA5MDksImV4cCI6MjA4NDg0NjkwOX0.p8utaac5OVzLUjNkhl3tdwUda0zZW34kQjFvyZVOE0s'; 
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

let html5QrCode = null;
let currentScore = 0;
let scannedReceiptId = "";
let isProcessingScan = false; // Kočnica da ne okine skener dva puta

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
    // 1. Ako već obrađujemo jedan sken, ignoriši ostale
    if (isProcessingScan) return; 
    
    console.log("Skenirano:", decodedText);
    
    if (!decodedText.includes("102778428")) {
        alert("Nevažeći račun!");
        return;
    }

    // Aktiviramo kočnicu
    isProcessingScan = true; 
    scannedReceiptId = new URLSearchParams(decodedText.split('?')[1]).get('vl') || decodedText.slice(-30);
    
    try {
        // 2. Provera duplikata
        const { data: existing } = await _supabase
            .from('scanned_receipts')
            .select('receipt_id')
            .eq('receipt_id', scannedReceiptId)
            .maybeSingle();
        
        if (existing) {
            alert("Ovaj račun je već iskorišćen!");
            isProcessingScan = false; // Resetujemo kočnicu da bi mogao skenirati drugi račun
            return;
        }

        // 3. ODMAH zaključaj račun
        const { error: insertError } = await _supabase
            .from('scanned_receipts')
            .insert([{ receipt_id: scannedReceiptId, scanned_by: "IN_PROGRESS" }]);

        if (insertError) throw insertError;

        // 4. Ugasi skener i prebaci na igru
        if (html5QrCode) {
            await html5QrCode.stop().catch(() => {});
        }
        
        navigate('page-game');
        loadUnityGame();

    } catch (err) {
        console.error("Greška:", err);
        alert("Problem sa bazom podataka. Pokušajte ponovo.");
        isProcessingScan = false; // Resetujemo kočnicu u slučaju greške
    }
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

async function handleAuth() {
    const email = document.getElementById('auth-email').value.trim().toLowerCase();
    const password = document.getElementById('auth-password').value;
    const msg = document.getElementById('auth-msg');

    if (!email || password.length < 6) {
        alert("Email je obavezan, a lozinka mora imati bar 6 karaktera!");
        return;
    }

    msg.innerText = "Provera identiteta...";
    msg.style.color = "var(--yellow)";

    try {
        // 1. KORAK: Prvo uvek pokušaj PRIJAVU (Login)
        let { data: authData, error: signInError } = await _supabase.auth.signInWithPassword({
            email: email,
            password: password,
        });

        // 2. KORAK: Analiza greške pri prijavi
        if (signInError) {
            // Ako je greška "Invalid login credentials", to može značiti dve stvari:
            // A) Pogrešna lozinka
            // B) Korisnik uopšte ne postoji u Auth sistemu
            
            console.log("Prijava nije uspela, proveravam da li korisnik postoji...");

            // Pokušavamo registraciju (SignUp)
            const { data: signUpData, error: signUpError } = await _supabase.auth.signUp({
                email: email,
                password: password,
            });

            if (signUpError) {
                // Ako SignUp kaže da korisnik već postoji, a Login nije prošao, znači da je LOZINKA LOŠA
                if (signUpError.message.includes("already registered") || signUpError.status === 422) {
                    throw new Error("Pogrešna lozinka za ovaj email!");
                } else {
                    throw signUpError;
                }
            }
            // Ako je SignUp prošao, koristimo te podatke
            authData = signUpData;
            console.log("Novi nalog kreiran!");
        } else {
            console.log("Prijava uspešna!");
        }

        // --- AKO SMO DO OVDE STIGLI, KORISNIK JE SIGURNO ULOGOVAN ---

        // 3. KORAK: Sabiranje poena (iz leaderboard tabele)
        const { data: scoreData } = await _supabase
            .from('leaderboard')
            .select('points')
            .eq('email', email)
            .maybeSingle();

        let totalPoints = currentScore + (scoreData ? scoreData.points : 0);

        // 4. KORAK: Upis u leaderboard
        const { error: lbError } = await _supabase
            .from('leaderboard')
            .upsert({ 
                email: email, 
                points: totalPoints, 
                last_scan_date: new Date().toISOString() 
            }, { onConflict: 'email' });

        if (lbError) throw lbError;

        // 5. KORAK: Veži račun
        await _supabase.from('scanned_receipts')
            .update({ scanned_by: email })
            .eq('receipt_id', scannedReceiptId);

        msg.innerText = "Uspešno sačuvano!";
        msg.style.color = "var(--green)";
        
        setTimeout(async () => {
            await showLeaderboard();
            navigate('page-leaderboard');
        }, 1500);

    } catch (err) {
        console.error("Auth Error:", err);
        msg.innerText = err.message; 
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










