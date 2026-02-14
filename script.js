// --- PROVERA KONEKCIJE ---
console.log("script.js je uspešno učitan!");

const supabaseUrl = 'https://zeqzrziiligsmrqxonhj.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InplcXpyemlpbGlnc21ycXhvbmhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyNzA5MDksImV4cCI6MjA4NDg0NjkwOX0.p8utaac5OVzLUjNkhl3tdwUda0zZW34kQjFvyZVOE0s'; 
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

let html5QrCode = null;
let currentScore = 0;
let scannedReceiptId = "";
let isProcessingScan = false; 
let unityInstance = null; // Globalna varijabla za Unity

// --- OSNOVNA NAVIGACIJA ---
function navigate(id) {
    console.log("Navigacija na:", id);
    const pages = document.querySelectorAll('.page');
    pages.forEach(p => p.classList.remove('active'));
    
    // FIKS ZA KOMPJUTER: Ako nismo na strani sa igrom, sakrij Unity kontejner
    // Ovo fizički oslobađa tastaturu od Unity-ja
    const unityCont = document.getElementById('unity-container');
    if (unityCont) {
        if (id === 'page-game') {
            unityCont.style.display = 'block';
        } else {
            unityCont.style.display = 'none';
        }
    }

    const target = document.getElementById(id);
    if (target) {
        target.classList.add('active');
    } else {
        console.error("Strana nije pronađena: " + id);
    }
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
    
    if (!decodedText.includes("102778428")) {
        alert("Nevažeći račun!");
        return;
    }

    isProcessingScan = true; 
    scannedReceiptId = new URLSearchParams(decodedText.split('?')[1]).get('vl') || decodedText.slice(-30);
    
    try {
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

        const { error: insertError } = await _supabase
            .from('scanned_receipts')
            .insert([{ receipt_id: scannedReceiptId, scanned_by: "IN_PROGRESS" }]);

        if (insertError) throw insertError;

        if (html5QrCode) {
            await html5QrCode.stop().catch(() => {});
        }
        
        navigate('page-game');
        loadUnityGame();

    } catch (err) {
        console.error("Greška:", err);
        alert("Problem sa bazom podataka. Pokušajte ponovo.");
        isProcessingScan = false;
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
        matchWebGLToCanvasSize: true, 
    };

    const loaderScript = document.createElement("script");
    loaderScript.src = "build/igra.loader.js"; 
    loaderScript.onload = () => {
        createUnityInstance(canvas, config, (progress) => {
            const bar = document.getElementById("unity-progress-bar-full");
            if (bar) bar.style.width = (100 * progress) + "%";
        }).then((instance) => {
            unityInstance = instance; // Čuvamo instancu
            console.log("Unity spreman!");
            
            // Dozvoli klikovima da prođu (važno za desktop)
            if (instance.setModuleCanvasClickThrough) {
                instance.setModuleCanvasClickThrough(true);
            }

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

// --- AUTH ---
async function handleAuth() {
    const emailField = document.getElementById('auth-email');
    const passwordField = document.getElementById('auth-password');
    const email = emailField.value.trim().toLowerCase();
    const password = passwordField.value;
    const msg = document.getElementById('auth-msg');

    // Skloni tastaturu na mobilnom
    emailField.blur();
    passwordField.blur();

    if (!email || password.length < 6) {
        alert("Email je obavezan, a lozinka mora imati bar 6 karaktera!");
        return;
    }

    msg.innerText = "Provera naloga...";
    msg.style.color = "var(--yellow)";

    try {
        const { data: signInData, error: signInError } = await _supabase.auth.signInWithPassword({
            email: email,
            password: password,
        });

        if (!signInError) {
            console.log("Prijava uspešna.");
            await saveScore(email, msg);
            return;
        }

        if (signInError.message.includes("Invalid login credentials") || signInError.status === 400) {
            const { data: userExists } = await _supabase
                .from('leaderboard')
                .select('email')
                .eq('email', email)
                .maybeSingle();

            if (userExists) {
                throw new Error("Pogrešna lozinka za ovaj nalog!");
            } else {
                const { error: signUpError } = await _supabase.auth.signUp({
                    email: email,
                    password: password,
                });

                if (signUpError) throw signUpError;
                console.log("Novi nalog kreiran!");
                await saveScore(email, msg);
            }
        } else {
            throw signInError;
        }

    } catch (err) {
        console.error("Auth Error:", err);
        msg.innerText = err.message;
        msg.style.color = "var(--red)";
    }
}

// Očišćena saveScore funkcija (samo jedna verzija!)
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
        }, { onConflict: 'email' });

        await _supabase.from('scanned_receipts')
            .update({ scanned_by: email })
            .eq('receipt_id', scannedReceiptId);

        msg.innerText = "Uspešno sačuvano!";
        msg.style.color = "var(--green)";
        
        setTimeout(async () => {
            await showLeaderboard();
            navigate('page-leaderboard');
        }, 1500);
    } catch (e) {
        console.error(e);
        msg.innerText = "Greška pri čuvanju.";
    }
}

// --- RANG LISTA ---
async function showLeaderboard() {
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

        lbBody.innerHTML = data.map((user, index) => `
            <tr>
                <td>${index + 1}.</td>
                <td>${user.email.split('@')[0]}</td>
                <td style="color: var(--yellow); font-weight: bold;">${user.points}</td>
            </tr>
        `).join('');
    } catch (err) {
        lbBody.innerHTML = '<tr><td colspan="3">Greška pri učitavanju.</td></tr>';
    }
}

// FORSIRANO KUCANJE - POSLEDNJA NADA
window.addEventListener('keydown', function(e) {
    const activeInput = document.activeElement;
    
    // Proveravamo da li je kursor u Email ili Password polju
    if (activeInput && (activeInput.id === 'auth-email' || activeInput.id === 'auth-password')) {
        
        // 1. Ako je taster Backspace - obriši poslednji karakter
        if (e.key === 'Backspace') {
            activeInput.value = activeInput.value.slice(0, -1);
        } 
        // 2. Ako je običan karakter (slovo, broj, simbol)
        else if (e.key.length === 1) {
            activeInput.value += e.key;
        }

        // OVO JE KLJUČNO:
        e.preventDefault(); // Ne daj Unity-ju da vidi taster
        e.stopPropagation(); // Zaustavi dalje širenje
        e.stopImmediatePropagation(); // Zaustavi apsolutno sve druge skripte (Unity)
        
        return false;
    }
}, true); // 'true' znači da hvatamo taster pre nego što Unity uopšte trepne

const container = document.getElementById("unity-container");
const canvas = document.getElementById("unity-canvas");
function resizeUnityCanvas() {
    if(!container || !canvas) return;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
}
window.addEventListener("resize", resizeUnityCanvas);
resizeUnityCanvas();

// --- MODAL LOGIKA (FIXED) ---

async function toggleUserInfo() {
    const modal = document.getElementById('infoModal');
    const userSection = document.getElementById('userAccountInfo');
    const guestMessage = document.getElementById('guestMessage');
    const emailSpan = document.getElementById('infoEmail');
    const pointsSpan = document.getElementById('infoPoints');

    // Otvori modal
    modal.style.display = 'block';

    try {
        // Koristimo tvoju varijablu _supabase
        const { data: { session } } = await _supabase.auth.getSession();
        const user = session?.user;

        if (user) {
            guestMessage.style.display = 'none';
            userSection.style.display = 'block';
            emailSpan.innerText = user.email;

            // Izvlačimo bodove iz tvoje tabele 'leaderboard' (pošto nju koristiš u saveScore)
            const { data: scoreData } = await _supabase
                .from('leaderboard')
                .select('points')
                .eq('email', user.email)
                .maybeSingle();

            pointsSpan.innerText = scoreData ? scoreData.points : "0";
        } else {
            userSection.style.display = 'none';
            guestMessage.style.display = 'block';
        }
    } catch (err) {
        console.error("Greška kod modala:", err);
    }
}

// Zatvaranje na X
document.querySelector('.close-button').onclick = function() {
    document.getElementById('infoModal').style.display = "none";
};

// Zatvaranje na klik van prozora
window.addEventListener('click', function(event) {
    const modal = document.getElementById('infoModal');
    if (event.target == modal) {
        modal.style.display = "none";
    }
});

// Funkcija za Logout


// Čim se skripta učita, slušaj promene u logovanju
_supabase.auth.onAuthStateChange(async (event, session) => {
    console.log("Auth Event:", event); // Ovo će ti ispisati šta se dešava u konzoli

    // Ako je event 'PASSWORD_RECOVERY', to znači da je korisnik kliknuo link u mejlu
    if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && window.location.hash.includes("type=recovery"))) {
        console.log("Korisnik potvrđen preko mejla. Otvaram prozor za novu šifru.");
        document.getElementById('resetPasswordModal').style.display = 'block';
    }
});


// --- EXPRESS PASSWORD RESET SISTEM ---

// 1. Funkcija koja šalje mejl (Zameni staru forgotPassword ovim)
async function forgotPassword() {
    const emailField = document.getElementById('auth-email');
    const email = emailField.value.trim().toLowerCase();
    const msg = document.getElementById('auth-msg');

    if (!email) {
        alert("Molimo unesite email!");
        return;
    }

    // Šaljemo mejl sa linkom koji vraća na tvoj sajt
    const { error } = await _supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname, 
    });

    if (error) {
        msg.innerText = "Greška: " + error.message;
        msg.style.color = "red";
    } else {
        msg.innerText = "Mejl je poslat! Kliknite na link u mejlu.";
        msg.style.color = "#00ff00";
    }
}

// 2. Automatska provera čim se stranica učita
window.addEventListener('load', () => {
    const url = window.location.href;
    
    // Provera da li se korisnik vratio sa mejla
    if (url.includes("type=recovery") || url.includes("access_token")) {
        console.log("Express Reset detektovan!");

        // Sakrij skener i sve ostale stranice
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        
        // Prikaži onaj crni prozor za novu šifru
        const modal = document.getElementById('expressResetModal');
        if (modal) {
            modal.style.display = 'block';
            modal.style.zIndex = "10001";
        }
    }
});

// 3. Funkcija za upisivanje nove šifre preko stare
async function executeExpressReset() {
    const newPass = document.getElementById('express-new-password').value;
    const msg = document.getElementById('express-reset-msg');

    if (newPass.length < 6) {
        alert("Lozinka mora imati barem 6 karaktera!");
        return;
    }

    const { error } = await _supabase.auth.updateUser({ password: newPass });

    if (error) {
        msg.innerText = "Greška: " + error.message;
    } else {
        msg.innerText = "Uspešno! Šifra je promenjena.";
        msg.style.color = "#00ff00";

        setTimeout(() => {
            // Čisti URL i osvežava sajt da se vratiš na početak
            window.location.href = window.location.origin + window.location.pathname;
        }, 2000);
    }
}



