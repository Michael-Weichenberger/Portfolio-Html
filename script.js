document.addEventListener("DOMContentLoaded", () => {
    const cursorDot = document.getElementById('cursor-dot');
    const cursorRing = document.getElementById('cursor-ring');

    let mouseX = 0, mouseY = 0;
    let ringX = 0, ringY = 0;
    let introActive = true;

    window.addEventListener('mousemove', (e) => {
        if (!introActive) return;
        mouseX = e.clientX;
        mouseY = e.clientY;
        cursorDot.style.transform = `translate(${mouseX}px, ${mouseY}px) translate(-50%, -50%)`;
    });

    function renderCursor() {
        if (introActive) {
            ringX += (mouseX - ringX) * 0.15;
            ringY += (mouseY - ringY) * 0.15;
            cursorRing.style.transform = `translate(${ringX}px, ${ringY}px) translate(-50%, -50%)`;
            requestAnimationFrame(renderCursor);
        }
    }
    renderCursor();

    const enterBtn = document.getElementById('enter-portfolio-btn');
    const splash = document.getElementById('intro-splash');
    const navBar = document.getElementById('fixed-nav-bar');

    if (enterBtn && splash) {
        enterBtn.addEventListener('click', () => {
            introActive = false;
            document.body.classList.remove('intro-active');
            cursorDot.classList.add('cursor-hidden');
            cursorRing.classList.add('cursor-hidden');

            splash.classList.add('fade-out');
            navBar.classList.add('visible');

            setTimeout(() => {
                splash.style.display = 'none';
            }, 800);
        });
    }

    // Scroll Observer für Animationen
    const observeElements = document.querySelectorAll('.reveal, .list-section');
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('active');
            }
        });
    }, { threshold: 0.1 });

    observeElements.forEach(el => observer.observe(el));
});

// Direkter E-Mail-Versand via EmailJS (ohne Mailto-Umweg)
function triggerCleanAutomation(event) {
    event.preventDefault();

    const company = document.getElementById('hr-company').value;
    const email = document.getElementById('hr-email').value;
    const role = document.getElementById('hr-role').value;

    const formElement = document.getElementById('auto-hire-form');
    const successState = document.getElementById('success-state');
    const successDesc = document.getElementById('success-desc');
    const submitBtn = formElement.querySelector('button[type="submit"]');

    // UI Feedback: Button auf "Wird gesendet..." setzen
    const originalBtnText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span>Wird gesendet...</span>';
    submitBtn.style.pointerEvents = 'none';

    // Parameter für das EmailJS Template (stimmt mit deinen Dashboard-Variablen überein)
    const templateParams = {
        from_name: company,
        from_email: email,
        message: `Gewünschte Position / Rolle: ${role}`
    };

    // Korrigierte Template-ID eingesetzt
    emailjs.send('service_cqvu0vn', 'template_fzcue9c', templateParams)
        .then(() => {
            if (formElement && successState && successDesc) {
                formElement.style.display = 'none';
                successState.style.display = 'block';

                successDesc.innerHTML = `Vielen Dank! Ihre Anfrage für die Rolle <strong>${role}</strong> von <strong>${company}</strong> wurde direkt an Michael Weichenberger übermittelt.`;
            }
        }, (error) => {
            console.error('FAILED...', error);
            alert('Beim Senden ist ein Fehler aufgetreten. Bitte versuchen Sie es direkt über die E-Mail-Adresse.');
            submitBtn.innerHTML = originalBtnText;
            submitBtn.style.pointerEvents = 'auto';
        });
}