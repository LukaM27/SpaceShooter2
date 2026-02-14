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
        matchWebGLToCanvasSize: true, 
    };

    const loaderScript = document.createElement("script");
    loaderScript.src = "build/igra.loader.js"; 
    
    loaderScript.onload = () => {
        createUnityInstance(canvas, config, (progress) => {
            const bar = document.getElementById("unity-progress-bar-full");
            if (bar) bar.style.width = (100 * progress) + "%";
        }).then((instance) => {
            // 1. Čuvamo instancu globalno da bi JS mogao da joj "komanduje"
            window.unityInstance = instance; 
            console.log("Unity spreman!");
            
            // 2. Dozvoljavamo klikovima da prođu kroz Unity "štit"
            // (Ako ova funkcija ne postoji u tvojoj verziji Unity-ja, neće baciti error)
            if (instance.setModuleCanvasClickThrough) {
                instance.setModuleCanvasClickThrough(true);
            }

            // 3. ISKLJUČUJEMO kradju tastature odmah po učitavanju
            // Ovo rešava problem da "neće ni da kuca" na kompu
            if (window.unityInstance.Module && window.unityInstance.Module.canvas) {
                window.unityInstance.Module.canvas.addEventListener('keydown', (e) => {
                    // Ako je fokus na input polju, ne dozvoli Unity-ju da uzme taster
                    if (e.target.nodeName === 'INPUT') {
                        e.stopPropagation();
                    }
                }, true);
            }

            if (loadingBar) loadingBar.style.display = "none";
        }).catch((message) => {
            alert("Greška pri učitavanju igre: " + message);
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
    const emailField = document.getElementById('auth-email');
    const passwordField = document.getElementById('auth-password');
    const email = emailField.value.trim().toLowerCase();
    const password = passwordField.value;
    const msg = document.getElementById('auth-msg');

    // Sprečavamo bagove tokom slanja
    emailField.blur(); 
    passwordField.blur();

    if (!email || password.length < 6) {
        alert("Email je obavezan, a lozinka mora imati bar 6 karaktera!");
        return;
    }

    msg.innerText = "Provera naloga...";
    msg.style.color = "var(--yellow)";

    try {
        // 1. KORAK: Prvo pokušavamo Login
        const { data: signInData, error: signInError } = await _supabase.auth.signInWithPassword({
            email: email,
            password: password,
        });

        // 2. Ako je Login uspeo, korisnik je uneo TAČNU šifru
        if (!signInError) {
            console.log("Prijava uspešna (stari korisnik).");
            await saveScore(email, msg);
            return;
        }

        // 3. Ako Login NIJE uspeo, proveravamo zašto
        // Ako je greška "Invalid login credentials", to može biti loša šifra ILI nov korisnik
        if (signInError.message.includes("Invalid login credentials") || signInError.status === 400) {
            
            // RUČNA PROVERA: Pitamo tabelu leaderboard da li ovaj mejl već postoji
            const { data: userExists } = await _supabase
                .from('leaderboard')
                .select('email')
                .eq('email', email)
                .maybeSingle();

            if (userExists) {
                // Korisnik postoji u tabeli, a Login je malopre odbijen -> ŠIFRA JE POGREŠNA
                throw new Error("Pogrešna lozinka za ovaj nalog!");
            } else {
                // Korisnika nema u tabeli -> Pokušavamo registraciju (SignUp)
                const { data: signUpData, error: signUpError } = await _supabase.auth.signUp({
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

// Pomoćna funkcija da ne dupliramo kod za čuvanje
async function saveScore(email, msg) {
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

// Rešenje za problem sa kucanjem (Unity Keyboard Focus fix)
const authInputs = document.querySelectorAll('#auth-email, #auth-password');

authInputs.forEach(input => {
    input.addEventListener('focus', () => {
        // Ako postoji Unity instanca, isključujemo njeno presretanje tastature
        if (typeof unityInstance !== "undefined") {
            unityInstance.SendMessage("Canvas", "SetKeyboardFocus", 0); // Opciono ako imaš skriptu u Unity
        }
        // Glavni fiks: dozvoli browseru da upravlja tastaturom
        window.addEventListener('keydown', stopPropagation, true);
    });

    input.addEventListener('blur', () => {
        window.removeEventListener('keydown', stopPropagation, true);
    });
});

function stopPropagation(e) {
    if (e.target.nodeName === 'INPUT') {
        e.stopPropagation();
    }
}

// Funkcija koja pali/gasi Unity tastaturu
function toggleUnityKeyboard(disable) {
    if (window.unityInstance) {
        // Ova komanda govori Unity-ju: "0" - ne kradi tastere, "1" - kradi tastere
        window.unityInstance.SendMessage("Canvas", "SetKeyboardFocus", disable ? 0 : 1); 
        
        // Dodatni fiks za novije verzije Unity-ja
        if (window.unityInstance.Module) {
            window.unityInstance.Module.canvas.style.pointerEvents = disable ? "none" : "auto";
        }
    }
}

// Dodajemo listenere na tvoja polja
const emailInp = document.getElementById('auth-email');
const passInp = document.getElementById('auth-password');

[emailInp, passInp].forEach(input => {
    // Kad uđeš u polje - ugasi Unity tastaturu
    input.addEventListener('focus', () => {
        if (window.unityInstance) {
            window.unityInstance.setModuleCanvasClickThrough(true);
            // Direktno gađamo Unity Module ako SetMessage ne radi
            if (window.unityInstance.Module && window.unityInstance.Module.canvas) {
                window.unityInstance.Module.canvas.blur();
            }
        }
        console.log("Tastatura prebačena na INPUT");
    });

    // Kad izađeš iz polja - vrati Unity tastaturu (ako treba za igru)
    input.addEventListener('blur', () => {
        console.log("Tastatura vraćena na UNITY");
    });
});

// Ovaj kod "hvata" tastere pre nego što Unity stigne da ih blokira
window.addEventListener('keydown', function(e) {
    if (document.activeElement.tagName === 'INPUT') {
        e.stopPropagation(); // Ne daj eventu da ode do Unity-ja
        return true;
    }
}, true); // Ovo 'true' na kraju je najbitnije!


// OVO REŠAVA PROBLEM NA KOMPJUTERU
window.addEventListener('keydown', function(e) {
    // Proveravamo da li je kursor trenutno u nekom input polju
    if (e.target.tagName === 'INPUT' || e.target.id === 'auth-email' || e.target.id === 'auth-password') {
        
        // e.stopImmediatePropagation() je "nuklearna" opcija - 
        // ona kaže browseru: "Izvrši kucanje slova i nemoj nikome drugom (Unity-ju) javiti da se taster desio"
        e.stopImmediatePropagation();
        
        return true; 
    }
}, true); // 'true' ovde znači da hvatamo taster u "capture" fazi (pre svih ostalih)

// Dodatno: Kada korisnik uđe u polje, privremeno reci Unity-ju da ignoriše tastaturu
const inputs = [document.getElementById('auth-email'), document.getElementById('auth-password')];
inputs.forEach(inp => {
    if(inp) {
        inp.addEventListener('focus', () => {
            if (window.unityInstance) {
                // Isključuje kradju fokusa (ako Unity verzija podržava)
                window.unityInstance.SendMessage("Canvas", "SetKeyboardFocus", 0);
            }
        });
    }
});









