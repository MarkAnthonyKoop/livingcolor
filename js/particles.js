// Floating magic particle effect (last-resort visual when video fails).

let magicAnimId = null;

export function startMagicEffect() {
  stopMagicEffect();
  const overlay = document.getElementById('sketch-overlay');
  const container = document.getElementById('morph-container');
  const rect = container.getBoundingClientRect();
  overlay.width = rect.width;
  overlay.height = rect.height;
  overlay.style.opacity = '1';
  const octx = overlay.getContext('2d');
  const w = overlay.width, h = overlay.height;

  const particles = [];
  for (let i = 0; i < 60; i++) {
    particles.push({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.8,
      vy: -Math.random() * 1.2 - 0.3,
      size: Math.random() * 4 + 1,
      life: Math.random(),
      hue: Math.random() * 60 + 30,
    });
  }

  let t = 0;
  function animate() {
    t++;
    octx.clearRect(0, 0, w, h);

    for (const p of particles) {
      p.x += p.vx + Math.sin(t * 0.02 + p.life * 10) * 0.3;
      p.y += p.vy;
      p.life -= 0.003;

      if (p.life <= 0 || p.y < -10) {
        p.x = Math.random() * w;
        p.y = h + 10;
        p.life = 1;
        p.hue = Math.random() * 60 + 30;
      }

      const alpha = p.life * 0.7;
      const glow = p.size * 3;
      octx.save();
      octx.globalAlpha = alpha * 0.3;
      octx.fillStyle = `hsl(${p.hue}, 100%, 70%)`;
      octx.beginPath();
      octx.arc(p.x, p.y, glow, 0, Math.PI * 2);
      octx.fill();
      octx.globalAlpha = alpha;
      octx.fillStyle = `hsl(${p.hue}, 100%, 90%)`;
      octx.beginPath();
      octx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      octx.fill();
      octx.restore();
    }

    magicAnimId = requestAnimationFrame(animate);
  }

  magicAnimId = requestAnimationFrame(animate);
}

export function stopMagicEffect() {
  if (magicAnimId) {
    cancelAnimationFrame(magicAnimId);
    magicAnimId = null;
  }
}
