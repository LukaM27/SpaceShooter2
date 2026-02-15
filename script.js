console.log("script.js je uspešno učitan!");

const supabaseUrl = 'https://zeqzrziiligsmrqxonhj.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InplcXpyemlpbGlnc21ycXhvbmhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyNzA5MDksImV4cCI6MjA4NDg0NjkwOX0.p8utaac5OVzLUjNkhl3tdwUda0zZW34kQjFvyZVOE0s'; 
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

let html5QrCode = null;
let currentScore = 0;
let scannedReceiptId = "";
let isProcessingScan = false; 
let unityInstance = null;

function navigate(id) {
    console.log("Navigacija na:", id);
    const pages = document.querySelectorAll('.page');
    pages.forEach(p => p.classList.remove('active'));
    

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

async function handleAuth() {
    const emailField = document.getElementById('auth-email');
    const passwordField = document.getElementById('auth-password');
    const email = emailField.value.trim().toLowerCase();
    const password = passwordField.value;
    const msg = document.getElementById('auth-msg');

    emailField.blur();
    passwordField.blur();

    if (!email || password.length < 6) {
        alert("Email je obavezan, a lozinka mora imati bar 6 karaktera!");
        return;
    }

    msg.innerText = "Provera naloga...";
    msg.style.color = "var(--yellow)";

    try {
        // 1. Pokušaj prijave (Logika: Ako se uloguje, znači da je POTVRĐEN)
        const { data: signInData, error: signInError } = await _supabase.auth.signInWithPassword({
            email: email,
            password: password,
        });

        if (!signInError) {
            console.log("Prijava uspešna.");
            await saveScore(email, msg);
            return;
        }

        // POSEBAN FIX: Ako nalog postoji ali MEJL NIJE POTVRĐEN
        if (signInError.message.includes("Email not confirmed")) {
            msg.innerText = "Nalog postoji, ali mejl nije potvrđen! Proverite inbox.";
            msg.style.color = "orange";
            return;
        }

        // 2. Ako nalog ne postoji (Invalid credentials), kreiraj ga
        if (signInError.message.includes("Invalid login credentials") || signInError.status === 400) {
            
            const { data: userExists } = await _supabase
                .from('leaderboard')
                .select('email')
                .eq('email', email)
                .maybeSingle();

            if (userExists) {
                throw new Error("Pogrešna lozinka za ovaj nalog!");
            } else {
                // REGISTRACIJA NOVOG KORISNIKA
                const { data: signUpData, error: signUpError } = await _supabase.auth.signUp({
                    email: email,
                    password: password,
                });

                if (signUpError) throw signUpError;

                // KLJUČNA PROMENA: 
                // Ako je Supabase vratio sesiju (session), znači da je auto-confirm uključen
                if (signUpData.session) {
                    console.log("Nalog kreiran i automatski potvrđen!");
                    await saveScore(email, msg);
                } else {
                    // Ako nema sesije, znači da MORA na mejl. 
                    // NE zovemo saveScore ovde! Samo "parkiramo" podatke.
                    localStorage.setItem('pending_points', currentScore);
                    localStorage.setItem('pending_receipt', scannedReceiptId);
                    
                    msg.innerText = "POTVRDA: Poslat vam je mejl. Kliknite na link u njemu da se vaši bodovi upišu na rang listu!";
                    msg.style.color = "var(--yellow)";
                    
                    console.log("Novi nalog čeka verifikaciju. Poeni sačuvani u localStorage.");
                }
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

const { data: receiptCheck } = await _supabase
    .from('scanned_receipts')
    .select('scanned_by')
    .eq('receipt_id', scannedReceiptId)
    .single();

if (receiptCheck && receiptCheck.scanned_by !== "IN_PROGRESS") {
    msg.innerText = "Ovaj račun je već iskorišćen!";
    return;
}
    } catch (e) {
        console.error(e);
        msg.innerText = "Greška pri čuvanju.";
    }
}


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


window.addEventListener('keydown', function(e) {
    const activeInput = document.activeElement;
    

    if (activeInput && (activeInput.id === 'auth-email' || activeInput.id === 'auth-password')) {
        

        if (e.key === 'Backspace') {
            activeInput.value = activeInput.value.slice(0, -1);
        } 

        else if (e.key.length === 1) {
            activeInput.value += e.key;
        }

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        return false;
    }
}, true);

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


async function toggleUserInfo() {
    const modal = document.getElementById('infoModal');
    const userSection = document.getElementById('userAccountInfo');
    const guestMessage = document.getElementById('guestMessage');
    const emailSpan = document.getElementById('infoEmail');
    const pointsSpan = document.getElementById('infoPoints');


    modal.style.display = 'block';

    try {
        const { data: { session } } = await _supabase.auth.getSession();
        const user = session?.user;

        if (user) {
            guestMessage.style.display = 'none';
            userSection.style.display = 'block';
            emailSpan.innerText = user.email;

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

document.querySelector('.close-button').onclick = function() {
    document.getElementById('infoModal').style.display = "none";
};

window.addEventListener('click', function(event) {
    const modal = document.getElementById('infoModal');
    if (event.target == modal) {
        modal.style.display = "none";
    }
});



_supabase.auth.onAuthStateChange(async (event, session) => {
    console.log("Auth Event:", event);

    if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && window.location.hash.includes("type=recovery"))) {
        console.log("Korisnik potvrđen preko mejla. Otvaram prozor za novu šifru.");
        document.getElementById('resetPasswordModal').style.display = 'block';
    }
});


async function forgotPassword() {
    const emailField = document.getElementById('auth-email');
    const email = emailField.value.trim().toLowerCase();
    const msg = document.getElementById('auth-msg');

    if (!email) {
        alert("Molimo unesite email!");
        return;
    }

    localStorage.setItem('pending_points', currentScore);
    localStorage.setItem('pending_receipt', scannedReceiptId);
    console.log("Poeni privremeno sačuvani:", currentScore);

    const { error } = await _supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname, 
    });

    if (error) {
        msg.innerText = "Greška: " + error.message;
        msg.style.color = "red";
    } else {
        msg.innerText = "Mejl je poslat! Možete zatvoriti ovaj prozor i proveriti sanduče.";
        msg.style.color = "var(--yellow)";
    }
}

window.addEventListener('load', async () => {
    const url = window.location.href;
    
    if (url.includes("access_token")) {
        const hash = window.location.hash.substring(1);
        const params = new URLSearchParams(hash);
        const type = params.get("type");
        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");

        console.log("Detektovan token tipa:", type);

        // OBAVEZNO: Odmah očisti URL da se ne bi vrteli u krug
        history.replaceState(null, null, window.location.pathname);

        // DIREKTNO POSTAVLJANJE SESIJE (Ovo gazi starog korisnika novim bez logout-a)
        if (accessToken && refreshToken) {
            await _supabase.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken
            });
        }

        // 1. RECOVERY (Promena šifre)
        if (type === "recovery" || url.includes("type=recovery")) {
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            const modal = document.getElementById('expressResetModal');
            if (modal) modal.style.display = 'block';
        } 
        
        // 2. SIGNUP (Potvrda naloga)
        else if (type === "signup" || type === "invite") {
            const savedPoints = localStorage.getItem('pending_points');
            const savedReceipt = localStorage.getItem('pending_receipt');

            // Uzimamo korisnika iz tek postavljene sesije
            const { data: { user } } = await _supabase.auth.getUser();
            
            if (user) {
                console.log("Novi korisnik identifikovan:", user.email);
                
                if (savedPoints && savedPoints !== "0") {
                    currentScore = parseInt(savedPoints);
                    scannedReceiptId = savedReceipt;
                    
                    const msg = document.getElementById('auth-msg'); 
                    if (msg) msg.innerText = "Bodovi se upisuju...";

                    // Upisujemo bodove na NOVOG korisnika
                    await saveScore(user.email, msg);
                    
                    localStorage.removeItem('pending_points');
                    localStorage.removeItem('pending_receipt');
                }

                // Forsirana navigacija na rang listu
                await showLeaderboard();
                navigate('page-leaderboard');
            }
        }
    }
});

async function executeExpressReset() {
    const newPass = document.getElementById('express-new-password').value;
    const msg = document.getElementById('express-reset-msg');

    if (newPass.length < 6) {
        alert("Lozinka mora imati barem 6 karaktera!");
        return;
    }

    const savedPoints = localStorage.getItem('pending_points');
    const savedReceipt = localStorage.getItem('pending_receipt');
    
    localStorage.removeItem('pending_points');
    localStorage.removeItem('pending_receipt');

    if (!savedPoints || savedPoints === "0") {
        msg.innerText = "Bodovi su već obrađeni ili ne postoje.";
        msg.style.color = "orange";
        setTimeout(() => window.location.reload(), 2000);
        return;
    }

    msg.innerText = "Čuvam lozinku i bodove...";
    
    const { error: updateError } = await _supabase.auth.updateUser({ password: newPass });

    if (updateError) {
        msg.innerText = "Greška: " + updateError.message;
        msg.style.color = "red";
    } else {
        currentScore = parseInt(savedPoints);
        scannedReceiptId = savedReceipt;

        const { data: { user } } = await _supabase.auth.getUser();
        if (user) {
            await saveScore(user.email, msg);

            setTimeout(() => {
                document.getElementById('expressResetModal').style.display = 'none';
            }, 1000);
        }
    }
}


async function handleLogout() {
    await _supabase.auth.signOut();
    window.location.reload();
}


window.addEventListener('storage', (event) => {
    if (event.key === 'pending_points' && event.newValue === null) {
        console.log("Poeni sačuvani u drugom tabu. Uništavam ovaj tab...");
        
        document.body.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; background:#111; color:#ffd700; text-align:center; font-family:'Orbitron', sans-serif; padding:20px;">
                <h2 style="font-size:1.8rem; margin-bottom:20px;">GIGATRON SCAN2WIN</h2>
                <div style="font-size:5rem; margin-bottom:20px;">✅</div>
                <p style="font-size:1.2rem; color:white;">Bodovi su uspešno sačuvani u novom prozoru!</p>
                <p style="color:#888; margin-top:10px;">Ovaj prozor više nije potreban.</p>
                <button onclick="window.location.href='index.html'" style="margin-top:30px; padding:12px 25px; background:#ffd700; border:none; border-radius:5px; cursor:pointer; font-weight:bold; font-family:'Orbitron';">NAZAD NA POČETNU</button>
            </div>
        `;
        setTimeout(() => { window.close(); }, 5000);
    }
});













