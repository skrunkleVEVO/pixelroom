// A procedural landscape, so the editor can be tried without a photo. It holds
// every mixer hue, soft gradients for the tone tools and fine noise for detail.

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createSampleScene(width = 3000, height = 2000): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not allocate a canvas.');
  const rand = mulberry32(7);
  const horizon = height * 0.58;

  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#3f5f9e');
  sky.addColorStop(0.45, '#8d86b8');
  sky.addColorStop(0.75, '#e9a58a');
  sky.addColorStop(1, '#f7d08a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, horizon);

  const sunX = width * 0.68;
  const sunY = horizon * 0.82;
  const sun = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, height * 0.42);
  sun.addColorStop(0, 'rgba(255,246,214,1)');
  sun.addColorStop(0.09, 'rgba(255,232,170,0.95)');
  sun.addColorStop(0.3, 'rgba(255,190,120,0.35)');
  sun.addColorStop(1, 'rgba(255,170,110,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, width, horizon);

  for (let i = 0; i < 26; i++) {
    const x = rand() * width;
    const y = rand() * horizon * 0.6;
    const r = (0.05 + rand() * 0.1) * width;
    ctx.fillStyle = `rgba(255,${215 + rand() * 30},${205 + rand() * 30},${0.05 + rand() * 0.1})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const ridge = (base: number, amp: number, color: string, bottom: number) => {
    const phases = [rand() * 6, rand() * 6, rand() * 6, rand() * 6];
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, bottom);
    for (let x = 0; x <= width; x += 6) {
      const t = (x / width) * Math.PI * 2;
      const y =
        Math.sin(t * 1.3 + phases[0]) * 0.5 +
        Math.sin(t * 3.1 + phases[1]) * 0.28 +
        Math.sin(t * 7.3 + phases[2]) * 0.14 +
        Math.sin(t * 19 + phases[3]) * 0.06;
      ctx.lineTo(x, base - y * amp);
    }
    ctx.lineTo(width, bottom);
    ctx.closePath();
    ctx.fill();
  };
  ridge(horizon - height * 0.12, height * 0.11, '#7d7fb0', horizon);
  ridge(horizon - height * 0.07, height * 0.08, '#5c6b96', horizon);
  ridge(horizon - height * 0.025, height * 0.05, '#35574f', horizon);

  // Lake: mirrored sky fading to teal.
  const lake = ctx.createLinearGradient(0, horizon, 0, height * 0.76);
  lake.addColorStop(0, '#e6b48c');
  lake.addColorStop(0.35, '#6a9fb0');
  lake.addColorStop(1, '#1c6f86');
  ctx.fillStyle = lake;
  ctx.fillRect(0, horizon, width, height * 0.2);
  for (let i = 0; i < 900; i++) {
    const y = horizon + rand() * height * 0.18;
    ctx.fillStyle = `rgba(255,255,255,${0.02 + rand() * 0.07})`;
    ctx.fillRect(rand() * width, y, 20 + rand() * 180, 1 + rand() * 2);
  }

  // Meadow.
  const meadow = ctx.createLinearGradient(0, height * 0.74, 0, height);
  meadow.addColorStop(0, '#6d9a3a');
  meadow.addColorStop(0.5, '#3f7a2c');
  meadow.addColorStop(1, '#16391c');
  ctx.fillStyle = meadow;
  ctx.fillRect(0, height * 0.74, width, height * 0.26);
  ridge(height * 0.76, height * 0.022, '#5b8c33', height);
  const blades = Math.round(width * 7);
  for (let i = 0; i < blades; i++) {
    const depth = rand();
    const x = rand() * width;
    const y = height * (0.76 + depth * 0.24);
    const len = 8 + depth * 46;
    const shade = 34 + rand() * 90;
    ctx.strokeStyle = `rgb(${shade * 0.55},${shade + 30},${shade * 0.32})`;
    ctx.lineWidth = 1 + depth * 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 12, y - len);
    ctx.stroke();
  }

  // Wildflowers cover the remaining mixer hues.
  const flowers = ['#d7263d', '#f46036', '#f7c548', '#e43f9b', '#8e44c9', '#3a56d4', '#ffffff'];
  for (let i = 0; i < 1700; i++) {
    const depth = Math.pow(rand(), 0.7);
    const x = rand() * width;
    const y = height * (0.78 + depth * 0.22);
    const r = 2 + depth * 8;
    ctx.fillStyle = flowers[Math.floor(rand() * flowers.length)];
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Fine sensor-like noise, so texture and sharpening have something to work on.
  const image = ctx.getImageData(0, 0, width, height);
  const { data } = image;
  for (let i = 0; i < data.length; i += 4) {
    const n = (rand() - 0.5) * 7;
    data[i] += n;
    data[i + 1] += n;
    data[i + 2] += n;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
