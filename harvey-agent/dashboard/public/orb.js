/* =============================================================================
   KASI ZENTRALE · Sprach-Kugel
   Three.js (r128): verformte Kugel mit Rauschen, Fresnel-Leuchten in Kupfer,
   Staubring. Reagiert auf window.HarveyOrb.pulse()/level()/mode().
   Ohne WebGL oder Three.js: 2D-Canvas mit gleicher Logik.
   ============================================================================= */
(function () {
    'use strict';

    const canvas = document.getElementById('orb');
    const stage = document.getElementById('orb-stage');
    if (!canvas || !stage) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const MODES = { idle: 0.16, thinking: 0.32, speaking: 0.42, listening: 0.3, waiting: 0.22 };
    const st = { mode: 'idle', target: MODES.idle, energy: MODES.idle, input: 0, kick: 0 };

    const api = {
        mode(m) { st.mode = MODES[m] !== undefined ? m : 'idle'; st.target = MODES[st.mode]; stage.dataset.mode = st.mode; },
        level(v) { st.input = Math.max(0, Math.min(1, v || 0)); },   // Mikrofonpegel 0..1
        pulse(v) { st.kick = Math.min(1, st.kick + (v || 0.45)); }    // Wort gesprochen, Klick …
    };
    window.HarveyOrb = api;
    api.mode('idle');

    function step(dt) {
        st.kick *= Math.pow(0.04, dt);            // klingt in ~1 s ab
        const goal = st.target + st.input * 0.9 + st.kick * 0.7;
        st.energy += (goal - st.energy) * Math.min(1, dt * 6);
        return st.energy;
    }

    let size = { w: 1, h: 1 };
    function measure() {
        const r = stage.getBoundingClientRect();
        size = { w: Math.max(1, r.width), h: Math.max(1, r.height) };
    }

    const hasGL = (() => {
        if (!window.THREE) return false;
        try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (err) { return false; }
    })();

    /* ---------- WebGL ---------- */
    function startGL() {
        const THREE = window.THREE;
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
        renderer.setClearColor(0x000000, 0);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
        camera.position.set(0, 0, 6.2);

        const NOISE = `
            vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
            vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
            vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
            vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
            float snoise(vec3 v){
                const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
                vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
                vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
                vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
                i=mod289(i);
                vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
                float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
                vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
                vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
                vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
                vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
                vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
                vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
                vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
                p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
                vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
                return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
            }`;

        const uniforms = {
            uTime: { value: 0 }, uEnergy: { value: 0.2 },
            uDeep: { value: new THREE.Color('#2C1810') }, uCopper: { value: new THREE.Color('#B56535') }, uHot: { value: new THREE.Color('#F0C9A6') }
        };

        const core = new THREE.Mesh(
            new THREE.IcosahedronGeometry(1.25, 48),
            new THREE.ShaderMaterial({
                uniforms,
                vertexShader: NOISE + `
                    uniform float uTime; uniform float uEnergy;
                    varying vec3 vN; varying vec3 vView; varying float vD; varying vec3 vObj;
                    void main(){
                        vec3 p = position;
                        float n = snoise(normal * 1.1 + vec3(uTime * 0.2));
                        float n2 = snoise(normal * 2.6 - vec3(uTime * 0.45));
                        float d = n * (0.035 + uEnergy * 0.16) + n2 * (0.008 + uEnergy * 0.05);
                        p += normal * d;
                        vD = d;
                        vObj = normal;
                        vec4 mv = modelViewMatrix * vec4(p, 1.0);
                        vN = normalize(normalMatrix * normal);
                        vView = normalize(-mv.xyz);
                        gl_Position = projectionMatrix * mv;
                    }`,
                fragmentShader: NOISE + `
                    uniform vec3 uDeep; uniform vec3 uCopper; uniform vec3 uHot; uniform float uEnergy; uniform float uTime;
                    varying vec3 vN; varying vec3 vView; varying float vD; varying vec3 vObj;
                    void main(){
                        float facing = max(dot(vN, vView), 0.0);
                        float fres = pow(1.0 - facing, 2.6);
                        // fließende Energieadern auf der Oberfläche
                        vec3 q = vObj * 1.6 + vec3(0.0, uTime * 0.18, uTime * 0.11);
                        float f1 = snoise(q + snoise(q * 0.7 + uTime * 0.1) * 0.6);
                        float veins = pow(1.0 - abs(f1), 7.0);
                        float f2 = snoise(vObj * 5.0 - vec3(uTime * 0.3));
                        float fine = pow(1.0 - abs(f2), 12.0);
                        float light = max(dot(vN, normalize(vec3(-0.45, 0.65, 0.6))), 0.0);
                        vec3 col = uDeep * (0.55 + light * 0.6);
                        col += uCopper * light * 0.18;
                        col += uCopper * veins * (0.75 + uEnergy * 0.9);
                        col += uHot * fine * (0.12 + uEnergy * 0.7);
                        col += uHot * smoothstep(0.04, 0.2, vD) * (0.15 + uEnergy * 0.4);
                        col = mix(col, uHot, fres * (0.5 + uEnergy * 0.4));
                        col += uHot * pow(fres, 5.0) * (0.7 + uEnergy);
                        gl_FragColor = vec4(col, 1.0);
                    }`
            })
        );
        scene.add(core);

        // Leuchthülle (Rückseite, additiv)
        const halo = new THREE.Mesh(
            new THREE.SphereGeometry(1.62, 48, 48),
            new THREE.ShaderMaterial({
                uniforms,
                vertexShader: `
                    varying vec3 vN; varying vec3 vView;
                    void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vView = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
                fragmentShader: `
                    uniform vec3 uCopper; uniform float uEnergy;
                    varying vec3 vN; varying vec3 vView;
                    void main(){ float i = pow(max(dot(vN, vView), 0.0), 3.0); gl_FragColor = vec4(uCopper, i * (0.32 + uEnergy * 0.5)); }`,
                side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false
            })
        );
        scene.add(halo);

        // Staubring
        const N = 900;
        const pos = new Float32Array(N * 3);
        const seed = new Float32Array(N);
        for (let i = 0; i < N; i++) {
            const a = Math.random() * Math.PI * 2;
            const r = 1.75 + Math.pow(Math.random(), 2.2) * 0.9;
            pos[i * 3] = Math.cos(a) * r;
            pos[i * 3 + 1] = (Math.random() - 0.5) * 0.16 * r;
            pos[i * 3 + 2] = Math.sin(a) * r;
            seed[i] = Math.random();
        }
        const pg = new THREE.BufferGeometry();
        pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        pg.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
        const dust = new THREE.Points(pg, new THREE.ShaderMaterial({
            uniforms,
            vertexShader: `
                attribute float seed; uniform float uTime; uniform float uEnergy; varying float vA;
                void main(){
                    vec4 mv = modelViewMatrix * vec4(position * (1.0 + uEnergy * 0.08 * sin(uTime * 2.0 + seed * 6.28)), 1.0);
                    vA = 0.25 + 0.75 * fract(seed * 7.0 + uTime * 0.05);
                    gl_PointSize = (1.2 + seed * 2.0) * (6.0 / -mv.z);
                    gl_Position = projectionMatrix * mv;
                }`,
            fragmentShader: `
                uniform vec3 uHot; varying float vA;
                void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard; gl_FragColor = vec4(uHot, (1.0 - d * 2.0) * vA * 0.55); }`,
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
        }));
        dust.rotation.x = 0.38;
        dust.rotation.z = -0.12;
        scene.add(dust);

        function resize() {
            measure();
            renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
            renderer.setSize(size.w, size.h, false);
            camera.aspect = size.w / size.h;
            // Kugel passt immer in die kürzere Seite
            camera.position.z = size.w < size.h ? 6.2 / (size.w / size.h) : 6.2;
            camera.updateProjectionMatrix();
        }
        new ResizeObserver(resize).observe(stage);
        resize();

        let last = performance.now();
        let t = 0;
        function frame(now) {
            requestAnimationFrame(frame);
            if (document.hidden) { last = now; return; }
            const dt = Math.min(0.05, (now - last) / 1000);
            last = now;
            const speed = reduced.matches ? 0.15 : 1;
            t += dt * speed * (0.6 + st.energy);
            const e = step(dt);
            uniforms.uTime.value = t;
            uniforms.uEnergy.value = e;
            core.rotation.y += dt * speed * 0.12;
            core.rotation.x = Math.sin(t * 0.3) * 0.12;
            const s = 1 + Math.sin(t * 1.6) * 0.012 + e * 0.05;
            core.scale.setScalar(s);
            halo.scale.setScalar(1 + e * 0.12);
            dust.rotation.y -= dt * speed * (0.05 + e * 0.25);
            renderer.render(scene, camera);
        }
        requestAnimationFrame(frame);
        stage.classList.add('is-gl');
    }

    /* ---------- 2D-Ersatz ---------- */
    function start2D() {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        function resize() {
            measure();
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = size.w * dpr; canvas.height = size.h * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        new ResizeObserver(resize).observe(stage);
        resize();
        let last = performance.now();
        let t = 0;
        function frame(now) {
            requestAnimationFrame(frame);
            if (document.hidden) { last = now; return; }
            const dt = Math.min(0.05, (now - last) / 1000);
            last = now;
            t += dt * (reduced.matches ? 0.15 : 1);
            const e = step(dt);
            const cx = size.w / 2; const cy = size.h / 2;
            const R = Math.min(size.w, size.h) * 0.28 * (1 + e * 0.06 + Math.sin(t * 1.6) * 0.012);
            ctx.clearRect(0, 0, size.w, size.h);
            const glow = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 2);
            glow.addColorStop(0, 'rgba(200,138,88,' + (0.25 + e * 0.3) + ')');
            glow.addColorStop(1, 'rgba(200,138,88,0)');
            ctx.fillStyle = glow;
            ctx.fillRect(0, 0, size.w, size.h);
            ctx.beginPath();
            for (let i = 0; i <= 96; i++) {
                const a = (i / 96) * Math.PI * 2;
                const wob = Math.sin(a * 3 + t * 1.3) * 0.03 + Math.sin(a * 5 - t * 2.1) * (0.015 + e * 0.04);
                const r = R * (1 + wob);
                i ? ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r) : ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
            }
            const body = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R * 1.05);
            body.addColorStop(0, '#F0C9A6'); body.addColorStop(0.45, '#B56535'); body.addColorStop(1, '#2C1810');
            ctx.fillStyle = body;
            ctx.fill();
        }
        requestAnimationFrame(frame);
    }

    try { if (hasGL) startGL(); else start2D(); } catch (err) { start2D(); }
}());
